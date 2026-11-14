#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# MDL Connect — Restauration vérifiée PostgreSQL 17 (pg_restore) + uploads
# Compatible : Linux, Windows 11 WSL2, macOS
# ==============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

DATA_DIR="$ROOT_DIR/data"
BACKUP_DIR="$ROOT_DIR/backups"
ENV_FILE="$ROOT_DIR/.env"
DATABASE_URL_OVERRIDE=""
PG_USER="${PGUSER:-mdl}"
PG_DB="${PGDATABASE:-mdl}"
BACKUP_FILE=""
USE_LATEST=0
AUTO_YES=0
NO_DOCKER=0

usage() {
  cat <<'EOF'
Usage: bash scripts/restore.sh [fichier.tar.gz.enc | --latest] [options]

Options:
  --latest                 Restaurer la sauvegarde la plus récente dans --backup-dir
  --data-dir <chemin>      Dossier cible pour uploads/ (défaut: ./data)
  --backup-dir <chemin>    Dossier contenant les sauvegardes (défaut: ./backups)
  --database-url <url>     URL PostgreSQL explicite (utile avec --no-docker)
  --env-file <chemin>      Fichier .env à charger (défaut: ./.env)
  --no-docker              Ne pas manipuler Docker (utilise pg_restore/psql locaux)
  -y, --yes                Ne pas demander de confirmation interactive
  -h, --help               Afficher cette aide
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --latest)       USE_LATEST=1; shift ;;
    --data-dir)     DATA_DIR="$2"; shift 2 ;;
    --backup-dir)   BACKUP_DIR="$2"; shift 2 ;;
    --database-url) DATABASE_URL_OVERRIDE="$2"; shift 2 ;;
    --env-file)     ENV_FILE="$2"; shift 2 ;;
    --no-docker)    NO_DOCKER=1; shift ;;
    -y|--yes)       AUTO_YES=1; shift ;;
    -h|--help)      usage; exit 0 ;;
    -*)
      echo "Option inconnue : $1" >&2
      usage >&2
      exit 1
      ;;
    *)
      if [ -z "$BACKUP_FILE" ]; then
        BACKUP_FILE="$1"
        shift
      else
        echo "Argument inattendu : $1" >&2
        exit 1
      fi
      ;;
  esac
done

log() {
  printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"
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

verify_sha256() {
  local file="$1"
  local sha_file="${file}.sha256"
  if [ ! -f "$sha_file" ]; then
    log "Aucun fichier .sha256 trouvé, vérification empreinte ignorée."
    return 0
  fi
  local dir
  dir="$(dirname "$file")"
  local sha_base
  sha_base="$(basename "$sha_file")"
  if command -v sha256sum >/dev/null 2>&1; then
    (cd "$dir" && sha256sum -c "$sha_base" >/dev/null)
  elif command -v shasum >/dev/null 2>&1; then
    (cd "$dir" && shasum -a 256 -c "$sha_base" >/dev/null)
  else
    err "Aucun outil sha256sum ou shasum trouvé pour vérifier l'empreinte."
    return 1
  fi
  log "Empreinte SHA-256 vérifiée avec succès."
}

load_env_file "$ENV_FILE"

for cmd in openssl tar; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    err "Outil requis manquant : $cmd"
    exit 1
  fi
done

if [ "$USE_LATEST" -eq 1 ]; then
  BACKUP_FILE="$(ls -1t "$BACKUP_DIR"/mdl-backup-*.tar.gz.enc 2>/dev/null | head -n 1 || true)"
  if [ -z "$BACKUP_FILE" ]; then
    err "Aucune sauvegarde trouvée dans $BACKUP_DIR"
    exit 1
  fi
elif [ -z "$BACKUP_FILE" ]; then
  echo "Sauvegardes disponibles dans $BACKUP_DIR :"
  FILES_FOUND=()
  while IFS= read -r f; do
    [ -n "$f" ] && FILES_FOUND+=("$f")
  done <<EOF
$(ls -1t "$BACKUP_DIR"/mdl-backup-*.tar.gz.enc 2>/dev/null || true)
EOF
  if [ "${#FILES_FOUND[@]}" -eq 0 ]; then
    err "Aucune sauvegarde trouvée dans $BACKUP_DIR"
    exit 1
  fi
  idx=1
  for f in "${FILES_FOUND[@]}"; do
    printf '  [%d] %s (%s)\n' "$idx" "$(basename "$f")" "$(ls -lh "$f" | awk '{print $5}')"
    idx=$((idx + 1))
  done
  printf 'Choisissez un numéro [1-%d] : ' "${#FILES_FOUND[@]}"
  read -r choice
  if ! printf '%s' "$choice" | grep -Eq '^[0-9]+$' || [ "$choice" -lt 1 ] || [ "$choice" -gt "${#FILES_FOUND[@]}" ]; then
    err "Choix invalide."
    exit 1
  fi
  BACKUP_FILE="${FILES_FOUND[$((choice - 1))]}"
fi

if [ ! -f "$BACKUP_FILE" ]; then
  err "Fichier de sauvegarde introuvable : $BACKUP_FILE"
  exit 1
fi

ENC_PASS="${BACKUP_ENCRYPTION_KEY:-${ENCRYPTION_KEY:-}}"
if [ -z "$ENC_PASS" ]; then
  if [ "$AUTO_YES" -eq 1 ]; then
    err "BACKUP_ENCRYPTION_KEY ou ENCRYPTION_KEY manquant."
    exit 1
  fi
  printf 'Entrez la clé de chiffrement de la sauvegarde : '
  read -rs ENC_PASS
  printf '\n'
fi

log "1/5 Vérification de l'empreinte de $BACKUP_FILE..."
verify_sha256 "$BACKUP_FILE"

TMP_DIR="$(mktemp -d)"
APP_WAS_RUNNING=0
cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT INT TERM

log "2/5 Déchiffrement et extraction dans un dossier temporaire sécurisé..."
export MDL_ENC_PASS="$ENC_PASS"
if ! openssl enc -d -aes-256-cbc -pbkdf2 -iter 100000 -md sha256 \
  -in "$BACKUP_FILE" \
  -out "$TMP_DIR/backup.tar.gz" \
  -pass env:MDL_ENC_PASS 2>/dev/null; then
  unset MDL_ENC_PASS
  err "Impossible de déchiffrer la sauvegarde (clé incorrecte ou fichier corrompu)."
  exit 1
fi
unset MDL_ENC_PASS

mkdir -p "$TMP_DIR/extracted"
tar -xzf "$TMP_DIR/backup.tar.gz" -C "$TMP_DIR/extracted"

EXTRACTED_DUMP="$TMP_DIR/extracted/mdl-backup.pgdump"
if [ ! -s "$EXTRACTED_DUMP" ]; then
  err "Archive invalide : mdl-backup.pgdump absent ou vide."
  exit 1
fi

# Détermination du mode de restauration (Docker Compose vs pg_restore local)
RESTORE_METHOD=""
if [ "$NO_DOCKER" -eq 0 ] && command -v docker >/dev/null 2>&1 && [ -f "$ROOT_DIR/docker-compose.yml" ]; then
  RESTORE_METHOD="docker"
elif command -v pg_restore >/dev/null 2>&1 && command -v psql >/dev/null 2>&1; then
  RESTORE_METHOD="direct"
else
  err "Docker Compose indisponible et outils pg_restore/psql absents."
  exit 1
fi

if [ "$AUTO_YES" -eq 0 ]; then
  printf '\nATTENTION : Cette opération va remplacer la base PostgreSQL (%s) et %s/uploads.\n' "$PG_DB" "$DATA_DIR"
  printf 'Une copie de sécurité de la base actuelle sera créée avant restauration.\n'
  printf 'Continuer ? [o/N] : '
  read -r confirm
  case "$confirm" in
    o|O|oui|OUI|y|Y|yes|YES) ;;
    *)
      log "Restauration annulée par l'utilisateur."
      exit 0
      ;;
  esac
fi

if [ "$RESTORE_METHOD" = "docker" ]; then
  if docker compose -f "$ROOT_DIR/docker-compose.yml" ps --status running --services 2>/dev/null | grep -qx "app"; then
    log "3/5 Arrêt temporaire du service Docker 'app'..."
    docker compose -f "$ROOT_DIR/docker-compose.yml" stop app
    APP_WAS_RUNNING=1
  else
    log "3/5 Service 'app' déjà arrêté."
  fi

  if ! docker compose -f "$ROOT_DIR/docker-compose.yml" ps --status running --services 2>/dev/null | grep -qx "postgres"; then
    log "Démarrage du service 'postgres' pour la restauration..."
    docker compose -f "$ROOT_DIR/docker-compose.yml" up -d postgres
  fi

  PG_READY=0
  for _ in $(seq 1 30); do
    if docker compose -f "$ROOT_DIR/docker-compose.yml" exec -T postgres pg_isready -U "$PG_USER" -d "$PG_DB" >/dev/null 2>&1; then
      PG_READY=1
      break
    fi
    sleep 1
  done
  if [ "$PG_READY" -ne 1 ]; then
    err "PostgreSQL 17 ne répond pas dans le conteneur."
    exit 1
  fi

  if ! docker compose -f "$ROOT_DIR/docker-compose.yml" exec -T postgres pg_restore -l < "$EXTRACTED_DUMP" >/dev/null; then
    err "Le fichier mdl-backup.pgdump est corrompu (échec pg_restore -l)."
    exit 1
  fi
  log "Dump PostgreSQL 17 validé (pg_restore -l ok)."

  mkdir -p "$BACKUP_DIR"
  SAFETY_DUMP="$BACKUP_DIR/safety-before-restore-$(date '+%Y%m%d-%H%M%S').pgdump"
  log "4/5 Sauvegarde de sûreté ($SAFETY_DUMP) et restauration PostgreSQL 17..."
  docker compose -f "$ROOT_DIR/docker-compose.yml" exec -T postgres \
    pg_dump -U "$PG_USER" -d "$PG_DB" -Fc > "$SAFETY_DUMP" || true

  docker compose -f "$ROOT_DIR/docker-compose.yml" exec -T postgres \
    psql -v ON_ERROR_STOP=1 -U "$PG_USER" -d "$PG_DB" <<SQL
SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$PG_DB' AND pid <> pg_backend_pid();
DROP SCHEMA IF EXISTS public CASCADE;
DROP SCHEMA IF EXISTS drizzle CASCADE;
CREATE SCHEMA public AUTHORIZATION "$PG_USER";
SQL

  docker compose -f "$ROOT_DIR/docker-compose.yml" exec -T postgres \
    pg_restore --no-owner --no-privileges -U "$PG_USER" -d "$PG_DB" < "$EXTRACTED_DUMP"
else
  TARGET_DB_URL="${DATABASE_URL_OVERRIDE:-${DATABASE_URL:-}}"
  if [ -z "$TARGET_DB_URL" ]; then
    err "DATABASE_URL requis en mode --no-docker."
    exit 1
  fi

  pg_restore -l "$EXTRACTED_DUMP" >/dev/null
  log "Dump PostgreSQL 17 validé (pg_restore -l ok)."

  mkdir -p "$BACKUP_DIR"
  SAFETY_DUMP="$BACKUP_DIR/safety-before-restore-$(date '+%Y%m%d-%H%M%S').pgdump"
  log "4/5 Sauvegarde de sûreté ($SAFETY_DUMP) et restauration PostgreSQL 17..."
  if command -v pg_dump >/dev/null 2>&1; then
    pg_dump "$TARGET_DB_URL" -Fc -f "$SAFETY_DUMP" || true
  fi

  psql "$TARGET_DB_URL" -v ON_ERROR_STOP=1 <<'SQL'
DROP SCHEMA IF EXISTS public CASCADE;
DROP SCHEMA IF EXISTS drizzle CASCADE;
CREATE SCHEMA public;
SQL

  pg_restore --no-owner --no-privileges -d "$TARGET_DB_URL" "$EXTRACTED_DUMP"
fi

mkdir -p "$DATA_DIR/uploads"
if [ -d "$TMP_DIR/extracted/uploads" ]; then
  rm -rf "$DATA_DIR/uploads"
  cp -R "$TMP_DIR/extracted/uploads" "$DATA_DIR/uploads"
fi

if [ "$APP_WAS_RUNNING" -eq 1 ]; then
  log "5/5 Redémarrage du service Docker 'app'..."
  docker compose -f "$ROOT_DIR/docker-compose.yml" start app
else
  log "5/5 Restauration terminée."
fi

log "Restauration PostgreSQL 17 + uploads terminée avec succès."
