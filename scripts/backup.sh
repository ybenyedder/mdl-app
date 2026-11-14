#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# MDL Connect — Sauvegarde PostgreSQL 17 (pg_dump -Fc) + uploads, chiffrée AES-256
# Compatible : Linux, Windows 11 WSL2, macOS, et conteneur postgres:17-alpine
# ==============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Détection automatique conteneur (/data, /backups) vs hôte (./data, ./backups)
if [ -n "${MDL_DATA_DIR:-}" ]; then
  DATA_DIR="$MDL_DATA_DIR"
elif [ -d "/data/uploads" ] && [ "${MDL_IN_CONTAINER:-0}" = "1" ]; then
  DATA_DIR="/data"
else
  DATA_DIR="$ROOT_DIR/data"
fi

if [ -n "${MDL_BACKUP_DIR:-}" ]; then
  BACKUP_DIR="$MDL_BACKUP_DIR"
elif [ -d "/backups" ] && [ -w "/backups" ] && [ "${MDL_IN_CONTAINER:-0}" = "1" ]; then
  BACKUP_DIR="/backups"
else
  BACKUP_DIR="$ROOT_DIR/backups"
fi

ENV_FILE="${MDL_ENV_FILE:-$ROOT_DIR/.env}"
DATABASE_URL_OVERRIDE=""
PG_USER="${PGUSER:-mdl}"
PG_DB="${PGDATABASE:-mdl}"
NO_R2=0
NO_DOCKER=0
QUIET=0
RETENTION_OVERRIDE=""

usage() {
  cat <<'EOF'
Usage: bash scripts/backup.sh [options]

Options:
  --data-dir <chemin>      Dossier contenant uploads/ (défaut: ./data)
  --backup-dir <chemin>    Dossier de destination des sauvegardes (défaut: ./backups)
  --database-url <url>     URL PostgreSQL explicite (sinon .env ou conteneur postgres)
  --env-file <chemin>      Fichier .env à charger (défaut: ./.env)
  --retention <N>          Nombre de sauvegardes locales à garder (défaut: 14)
  --no-docker              Force l'utilisation de pg_dump local sans docker compose
  --no-r2                  Ne pas envoyer vers Cloudflare R2
  -q, --quiet              Sortie minimale
  -h, --help               Afficher cette aide
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --data-dir)     DATA_DIR="$2"; shift 2 ;;
    --backup-dir)   BACKUP_DIR="$2"; shift 2 ;;
    --database-url) DATABASE_URL_OVERRIDE="$2"; shift 2 ;;
    --env-file)     ENV_FILE="$2"; shift 2 ;;
    --retention)    RETENTION_OVERRIDE="$2"; shift 2 ;;
    --no-docker)    NO_DOCKER=1; shift ;;
    --no-r2)        NO_R2=1; shift ;;
    -q|--quiet)     QUIET=1; shift ;;
    -h|--help)      usage; exit 0 ;;
    *)
      echo "Option inconnue : $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

log() {
  if [ "$QUIET" -eq 0 ]; then
    printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"
  fi
}

err() {
  printf '[%s] ERREUR : %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >&2
}

load_env_file() {
  local file="$1"
  [ -f "$file" ] || return 0
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      ''|'#'*) continue ;;
      *=*) ;;
      *) continue ;;
    esac
    local key="${line%%=*}"
    local val="${line#*=}"
    key="$(printf '%s' "$key" | tr -d '[:space:]')"
    val="${val%$'\r'}"
    case "$val" in
      \"*\") val="${val#\"}"; val="${val%\"}" ;;
      \'*\') val="${val#\'}"; val="${val%\'}" ;;
    esac
    if [ -n "$key" ] && [ -z "${!key+x}" ]; then
      export "$key=$val"
    fi
  done < "$file"
}

compute_sha256() {
  local target="$1"
  local dir
  local base
  dir="$(dirname "$target")"
  base="$(basename "$target")"
  if command -v sha256sum >/dev/null 2>&1; then
    (cd "$dir" && sha256sum "$base" > "${base}.sha256")
  elif command -v shasum >/dev/null 2>&1; then
    (cd "$dir" && shasum -a 256 "$base" > "${base}.sha256")
  else
    err "Aucun outil sha256sum ou shasum trouvé."
    return 1
  fi
}

load_env_file "$ENV_FILE"

RETENTION="${RETENTION_OVERRIDE:-${BACKUP_RETENTION_COUNT:-14}}"
ENC_PASS="${BACKUP_ENCRYPTION_KEY:-${ENCRYPTION_KEY:-}}"
TARGET_DB_URL="${DATABASE_URL_OVERRIDE:-${DATABASE_URL:-}}"

for cmd in openssl tar; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    err "Outil requis manquant : $cmd"
    exit 1
  fi
done

if [ -z "$ENC_PASS" ]; then
  err "Aucune clé de chiffrement définie (BACKUP_ENCRYPTION_KEY ou ENCRYPTION_KEY)."
  exit 1
fi

mkdir -p "$BACKUP_DIR"

TMP_DIR="$(mktemp -d)"
cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT INT TERM

TIMESTAMP="$(date '+%Y%m%d-%H%M%S')"
ARCHIVE_NAME="mdl-backup-${TIMESTAMP}.tar.gz.enc"
OUT_FILE="$BACKUP_DIR/$ARCHIVE_NAME"
DUMP_FILE="$TMP_DIR/mdl-backup.pgdump"

# Choix du mode de dump PostgreSQL 17 :
# 1) Dans le conteneur backup (ou --no-docker / URL explicite), pg_dump local
# 2) Sur l'hôte avec Docker Compose actif, exec dans le conteneur postgres
DUMP_METHOD=""
if [ "${MDL_IN_CONTAINER:-0}" = "1" ] || [ -f "/.dockerenv" ] || [ "$NO_DOCKER" -eq 1 ] || [ -n "$DATABASE_URL_OVERRIDE" ]; then
  if ! command -v pg_dump >/dev/null 2>&1 || ! command -v pg_restore >/dev/null 2>&1; then
    err "pg_dump / pg_restore introuvable pour le mode direct."
    exit 1
  fi
  DUMP_METHOD="direct"
elif command -v docker >/dev/null 2>&1 && [ -f "$ROOT_DIR/docker-compose.yml" ] \
  && docker compose -f "$ROOT_DIR/docker-compose.yml" ps --status running --services 2>/dev/null | grep -qx "postgres"; then
  DUMP_METHOD="docker"
elif command -v pg_dump >/dev/null 2>&1 && command -v pg_restore >/dev/null 2>&1 && [ -n "$TARGET_DB_URL" ]; then
  DUMP_METHOD="direct"
else
  err "Impossible de joindre PostgreSQL 17 : démarrez 'docker compose up -d postgres' ou installez postgresql-client avec DATABASE_URL."
  exit 1
fi

log "1/5 Sauvegarde PostgreSQL 17 (pg_dump -Fc, mode=$DUMP_METHOD)..."
if [ "$DUMP_METHOD" = "docker" ]; then
  docker compose -f "$ROOT_DIR/docker-compose.yml" exec -T postgres \
    pg_dump -U "$PG_USER" -d "$PG_DB" -Fc > "$DUMP_FILE"
  if [ ! -s "$DUMP_FILE" ]; then
    err "Le dump PostgreSQL est vide."
    exit 1
  fi
  docker compose -f "$ROOT_DIR/docker-compose.yml" exec -T postgres \
    pg_restore -l < "$DUMP_FILE" >/dev/null
else
  if [ -n "$TARGET_DB_URL" ]; then
    pg_dump "$TARGET_DB_URL" -Fc -f "$DUMP_FILE"
  else
    pg_dump -Fc -f "$DUMP_FILE"
  fi
  if [ ! -s "$DUMP_FILE" ]; then
    err "Le dump PostgreSQL est vide."
    exit 1
  fi
  pg_restore -l "$DUMP_FILE" >/dev/null
fi

log "2/5 Préparation de l'archive (dump PostgreSQL 17 + uploads + métadonnées)..."
mkdir -p "$TMP_DIR/payload"
mv "$DUMP_FILE" "$TMP_DIR/payload/mdl-backup.pgdump"

if [ -d "$DATA_DIR/uploads" ]; then
  cp -R "$DATA_DIR/uploads" "$TMP_DIR/payload/uploads"
else
  mkdir -p "$TMP_DIR/payload/uploads"
fi

{
  printf 'created_utc=%s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  printf 'hostname=%s\n' "$(hostname 2>/dev/null || echo unknown)"
  printf 'db_engine=postgresql-17\n'
  printf 'db_format=pg_dump_custom\n'
  printf 'pg_restore_toc=ok\n'
  printf 'pg_database=%s\n' "$PG_DB"
} > "$TMP_DIR/payload/metadata.txt"

tar -czf "$TMP_DIR/backup.tar.gz" -C "$TMP_DIR/payload" .

log "3/5 Chiffrement AES-256-CBC (PBKDF2 100 000 itérations)..."
export MDL_ENC_PASS="$ENC_PASS"
openssl enc -aes-256-cbc -pbkdf2 -iter 100000 -md sha256 -salt \
  -in "$TMP_DIR/backup.tar.gz" \
  -out "${OUT_FILE}.tmp" \
  -pass env:MDL_ENC_PASS
unset MDL_ENC_PASS

mv "${OUT_FILE}.tmp" "$OUT_FILE"
chmod 600 "$OUT_FILE"
compute_sha256 "$OUT_FILE"
chmod 600 "${OUT_FILE}.sha256"

SIZE_HUMAN="$(ls -lh "$OUT_FILE" | awk '{print $5}')"
log "Sauvegarde locale créée : $OUT_FILE ($SIZE_HUMAN)"

# Upload optionnel vers Cloudflare R2
if [ "$NO_R2" -eq 0 ] \
   && [ -n "${R2_BUCKET:-}" ] \
   && [ -n "${R2_ENDPOINT:-}" ] \
   && [ -n "${R2_ACCESS_KEY_ID:-}" ] \
   && [ -n "${R2_SECRET_ACCESS_KEY:-}" ]; then
  if command -v rclone >/dev/null 2>&1; then
    log "4/5 Envoi chiffré vers Cloudflare R2 (bucket: $R2_BUCKET)..."
    export RCLONE_CONFIG_R2_TYPE="s3"
    export RCLONE_CONFIG_R2_PROVIDER="Cloudflare"
    export RCLONE_CONFIG_R2_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID"
    export RCLONE_CONFIG_R2_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY"
    export RCLONE_CONFIG_R2_ENDPOINT="$R2_ENDPOINT"
    export RCLONE_CONFIG_R2_ACL="private"

    R2_DEST="r2:${R2_BUCKET}/${R2_PREFIX:-mdl-backups}"
    rclone copy "$OUT_FILE" "$R2_DEST"
    rclone copy "${OUT_FILE}.sha256" "$R2_DEST"
    log "Envoi vers Cloudflare R2 terminé."
  else
    log "4/5 R2 configuré mais 'rclone' est absent sur cette machine (upload ignoré)."
  fi
else
  log "4/5 Envoi Cloudflare R2 non configuré (mode local uniquement)."
fi

# Rotation locale (conserve les N sauvegardes les plus récentes)
log "5/5 Rotation locale (conservation des $RETENTION dernières sauvegardes)..."
if [ "$RETENTION" -gt 0 ] 2>/dev/null; then
  TAIL_START=$((RETENTION + 1))
  COUNT_REMOVED=0
  while IFS= read -r old_file; do
    [ -n "$old_file" ] || continue
    rm -f "$old_file" "${old_file}.sha256"
    COUNT_REMOVED=$((COUNT_REMOVED + 1))
  done <<EOF
$(ls -1t "$BACKUP_DIR"/mdl-backup-*.tar.gz.enc 2>/dev/null | tail -n +"$TAIL_START" || true)
EOF
  if [ "$COUNT_REMOVED" -gt 0 ]; then
    log "Rotation : $COUNT_REMOVED ancienne(s) sauvegarde(s) supprimée(s)."
  fi
fi

log "Sauvegarde terminée avec succès : $OUT_FILE"
