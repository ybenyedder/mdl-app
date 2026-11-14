#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# MDL Connect — Installation guidée (Windows 11 WSL2, macOS, Linux) — PostgreSQL 17
# ==============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

ENV_FILE="$ROOT_DIR/.env"
EXAMPLE_FILE="$ROOT_DIR/.env.example"
NON_INTERACTIVE=0
NO_START=0

usage() {
  cat <<'EOF'
Usage: bash scripts/install.sh [options]

Options:
  --non-interactive   Utilise les valeurs par défaut sans poser de questions
  --no-start          Génère .env et les dossiers sans lancer Docker
  -h, --help          Afficher cette aide
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --non-interactive) NON_INTERACTIVE=1; shift ;;
    --no-start)        NO_START=1; shift ;;
    -h|--help)         usage; exit 0 ;;
    *)
      echo "Option inconnue : $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

info() { printf '\n[MDL] %s\n' "$*"; }
ok()   { printf '  [OK] %s\n' "$*"; }
warn() { printf '  [!]  %s\n' "$*"; }
err()  { printf '  [ERREUR] %s\n' "$*" >&2; }

# Lecture/écriture sûre dans .env (compatible Linux, WSL2, macOS BSD)
get_env_val() {
  local key="$1"
  local file="$2"
  [ -f "$file" ] || return 0
  awk -F= -v k="$key" '$1 == k { sub(/^[^=]*=/, ""); gsub(/\r$/, ""); print; exit }' "$file"
}

set_env_val() {
  local key="$1"
  local val="$2"
  local file="$3"
  local tmp="${file}.tmp.$$"
  if grep -q "^${key}=" "$file" 2>/dev/null; then
    awk -v k="$key" -v v="$val" '
      BEGIN { FS="="; OFS="=" }
      $1 == k { print k, v; next }
      { print }
    ' "$file" > "$tmp"
    mv "$tmp" "$file"
  else
    printf '%s=%s\n' "$key" "$val" >> "$file"
  fi
}

generate_vapid_keys() {
  if ! command -v node >/dev/null 2>&1; then
    return 1
  fi
  node -e '
    const crypto = require("crypto");
    const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const pubJwk = publicKey.export({ format: "jwk" });
    const privJwk = privateKey.export({ format: "jwk" });
    const rawPub = Buffer.concat([
      Buffer.from([0x04]),
      Buffer.from(pubJwk.x, "base64url"),
      Buffer.from(pubJwk.y, "base64url")
    ]).toString("base64url");
    console.log(rawPub + " " + privJwk.d);
  ' 2>/dev/null
}

info "1/5 Vérification des prérequis..."

if ! command -v openssl >/dev/null 2>&1; then
  err "OpenSSL est requis pour générer les clés secrètes."
  exit 1
fi
ok "OpenSSL détecté."

if [ "$NO_START" -eq 0 ]; then
  if ! command -v docker >/dev/null 2>&1; then
    err "Docker n'est pas installé."
    echo "  -> Windows 11 : Installez Docker Desktop et activez l'intégration WSL2."
    echo "  -> macOS      : Installez Docker Desktop pour Mac."
    echo "  -> Linux      : curl -fsSL https://get.docker.com | sh"
    exit 1
  fi
  if ! docker info >/dev/null 2>&1; then
    err "Docker est installé mais le moteur Docker ne répond pas (lancez Docker Desktop ou 'sudo systemctl start docker')."
    exit 1
  fi
  if ! docker compose version >/dev/null 2>&1; then
    err "Docker Compose v2 ('docker compose') est requis."
    exit 1
  fi
  ok "Docker et Docker Compose v2 prêts."
fi

info "2/5 Création des dossiers persistants..."
mkdir -p "$ROOT_DIR/data/postgres" "$ROOT_DIR/data/uploads" "$ROOT_DIR/backups" "$ROOT_DIR/uptime-kuma"
ok "Dossiers data/postgres/, data/uploads/, backups/ et uptime-kuma/ prêts."

info "3/5 Configuration du fichier .env et génération des secrets..."
if [ ! -f "$ENV_FILE" ]; then
  if [ ! -f "$EXAMPLE_FILE" ]; then
    err "Fichier .env.example introuvable dans $ROOT_DIR."
    exit 1
  fi
  cp "$EXAMPLE_FILE" "$ENV_FILE"
  ok "Fichier .env créé depuis .env.example."
else
  ok "Fichier .env existant conservé (seules les valeurs par défaut non sécurisées seront remplacées)."
fi

# Mot de passe PostgreSQL 17 et DATABASE_URL cohérents
CUR_PG_PASS="$(get_env_val POSTGRES_PASSWORD "$ENV_FILE")"
if [ -z "$CUR_PG_PASS" ] || [ "$CUR_PG_PASS" = "change-me-postgres-password-in-production" ]; then
  CUR_PG_PASS="$(openssl rand -hex 24)"
  set_env_val POSTGRES_PASSWORD "$CUR_PG_PASS" "$ENV_FILE"
fi

CUR_DB_URL="$(get_env_val DATABASE_URL "$ENV_FILE")"
if [ -z "$CUR_DB_URL" ] || printf '%s' "$CUR_DB_URL" | grep -q "change-me-postgres-password-in-production"; then
  set_env_val DATABASE_URL "postgresql://mdl:${CUR_PG_PASS}@postgres:5432/mdl" "$ENV_FILE"
fi

# Remplacer les secrets par défaut par de vraies clés aléatoires
CUR_SESSION="$(get_env_val SESSION_SECRET "$ENV_FILE")"
if [ -z "$CUR_SESSION" ] || [ "$CUR_SESSION" = "dev-session-secret-change-me-in-production-32bytes" ]; then
  set_env_val SESSION_SECRET "$(openssl rand -hex 32)" "$ENV_FILE"
fi

CUR_ENC="$(get_env_val ENCRYPTION_KEY "$ENV_FILE")"
if [ -z "$CUR_ENC" ] || [ "$CUR_ENC" = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef" ]; then
  set_env_val ENCRYPTION_KEY "$(openssl rand -hex 32)" "$ENV_FILE"
fi

CUR_JWT="$(get_env_val JWT_TICKET_SECRET "$ENV_FILE")"
if [ -z "$CUR_JWT" ] || [ "$CUR_JWT" = "dev-ticket-jwt-secret-change-me-in-production" ]; then
  set_env_val JWT_TICKET_SECRET "$(openssl rand -hex 32)" "$ENV_FILE"
fi

CUR_ED25519="$(get_env_val TICKET_ED25519_PRIVATE_KEY_HEX "$ENV_FILE")"
if [ -z "$CUR_ED25519" ] || [ "$CUR_ED25519" = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef" ]; then
  set_env_val TICKET_ED25519_PRIVATE_KEY_HEX "$(openssl rand -hex 32)" "$ENV_FILE"
fi

CUR_BKP_KEY="$(get_env_val BACKUP_ENCRYPTION_KEY "$ENV_FILE")"
if [ -z "$CUR_BKP_KEY" ]; then
  set_env_val BACKUP_ENCRYPTION_KEY "$(openssl rand -hex 32)" "$ENV_FILE"
fi

CUR_ADMIN_PASS="$(get_env_val ADMIN_PASSWORD "$ENV_FILE")"
if [ -z "$CUR_ADMIN_PASS" ] || [ "$CUR_ADMIN_PASS" = "MdlAdmin2026!ChangeMe" ]; then
  NEW_ADMIN_PASS="Mdl-$(openssl rand -hex 6)!"
  set_env_val ADMIN_PASSWORD "$NEW_ADMIN_PASS" "$ENV_FILE"
fi

# Génération VAPID si vide et Node disponible
CUR_VAPID_PUB="$(get_env_val VAPID_PUBLIC_KEY "$ENV_FILE")"
CUR_VAPID_PRIV="$(get_env_val VAPID_PRIVATE_KEY "$ENV_FILE")"
if [ -z "$CUR_VAPID_PUB" ] || [ -z "$CUR_VAPID_PRIV" ]; then
  if VAPID_PAIR="$(generate_vapid_keys)"; then
    VAPID_PUB="${VAPID_PAIR%% *}"
    VAPID_PRIV="${VAPID_PAIR##* }"
    set_env_val VAPID_PUBLIC_KEY "$VAPID_PUB" "$ENV_FILE"
    set_env_val VAPID_PRIVATE_KEY "$VAPID_PRIV" "$ENV_FILE"
    ok "Clés Web Push VAPID générées automatiquement via Node.js."
  else
    warn "Node.js absent sur la machine hôte : clés VAPID générables plus tard ou dans le conteneur."
  fi
fi

# Ajuster PUBLIC_APP_URL par défaut pour Docker si resté sur Vite 5173
CUR_URL="$(get_env_val PUBLIC_APP_URL "$ENV_FILE")"
if [ "$CUR_URL" = "http://localhost:5173" ] || [ -z "$CUR_URL" ]; then
  set_env_val PUBLIC_APP_URL "http://localhost:3000" "$ENV_FILE"
fi

if [ "$NON_INTERACTIVE" -eq 0 ]; then
  CUR_SCHOOL="$(get_env_val PUBLIC_SCHOOL_NAME "$ENV_FILE")"
  printf '\nNom de votre lycée [%s] : ' "${CUR_SCHOOL:-Lycée Jean Moulin}"
  read -r INPUT_SCHOOL
  if [ -n "$INPUT_SCHOOL" ]; then
    set_env_val PUBLIC_SCHOOL_NAME "$INPUT_SCHOOL" "$ENV_FILE"
  fi

  CUR_URL="$(get_env_val PUBLIC_APP_URL "$ENV_FILE")"
  printf 'URL publique du site (laissez vide pour %s) : ' "$CUR_URL"
  read -r INPUT_URL
  if [ -n "$INPUT_URL" ]; then
    set_env_val PUBLIC_APP_URL "$INPUT_URL" "$ENV_FILE"
  fi

  CUR_ADMIN_EMAIL="$(get_env_val ADMIN_EMAIL "$ENV_FILE")"
  printf 'Email du compte Président initial [%s] : ' "${CUR_ADMIN_EMAIL:-president@mdl.local}"
  read -r INPUT_EMAIL
  if [ -n "$INPUT_EMAIL" ]; then
    set_env_val ADMIN_EMAIL "$INPUT_EMAIL" "$ENV_FILE"
  fi

  printf 'Token Cloudflare Tunnel (laissez vide pour démarrer en local d'\''abord) : '
  read -r INPUT_TOKEN
  if [ -n "$INPUT_TOKEN" ]; then
    set_env_val CLOUDFLARE_TUNNEL_TOKEN "$INPUT_TOKEN" "$ENV_FILE"
    set_env_val COMPOSE_PROFILES "tunnel" "$ENV_FILE"
  fi
fi

# S'assurer que COMPOSE_PROFILES correspond au token
FINAL_TOKEN="$(get_env_val CLOUDFLARE_TUNNEL_TOKEN "$ENV_FILE")"
if [ -n "$FINAL_TOKEN" ]; then
  set_env_val COMPOSE_PROFILES "tunnel" "$ENV_FILE"
else
  set_env_val COMPOSE_PROFILES "" "$ENV_FILE"
fi

chmod 600 "$ENV_FILE"
ok "Fichier .env sécurisé (permissions 600)."

if [ "$NO_START" -eq 1 ]; then
  info "Option --no-start activée : installation terminée sans lancer Docker."
  exit 0
fi

info "4/5 Construction et démarrage des conteneurs Docker (peut prendre 5 à 10 min la 1ère fois)..."
docker compose up -d --build

info "5/5 Attente du démarrage de MDL Connect (/api/health)..."
HEALTHY=0
for i in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:3000/api/health" >/dev/null 2>&1; then
    HEALTHY=1
    break
  fi
  sleep 2
done

FINAL_URL="$(get_env_val PUBLIC_APP_URL "$ENV_FILE")"
FINAL_EMAIL="$(get_env_val ADMIN_EMAIL "$ENV_FILE")"
FINAL_PASS="$(get_env_val ADMIN_PASSWORD "$ENV_FILE")"
FINAL_BKP="$(get_env_val BACKUP_ENCRYPTION_KEY "$ENV_FILE")"

echo ""
echo "======================================================================"
if [ "$HEALTHY" -eq 1 ]; then
  echo "  MDL Connect (PostgreSQL 17) est EN LIGNE et prêt !"
else
  echo "  Conteneurs démarrés (vérifiez les logs avec : docker compose logs -f app)"
fi
echo "======================================================================"
echo "  Application locale : http://localhost:3000"
echo "  URL configurée     : $FINAL_URL"
echo "  Surveillance Uptime: http://localhost:3001"
echo "----------------------------------------------------------------------"
echo "  Compte Président initial :"
echo "    Email        : $FINAL_EMAIL"
echo "    Mot de passe : $FINAL_PASS"
echo "  (Changez ce mot de passe dès votre première connexion !)"
echo "----------------------------------------------------------------------"
echo "  IMPORTANT : Sauvegardez votre clé de chiffrement des backups"
echo "  (dans un gestionnaire de mots de passe / papier dans le coffre MDL) :"
echo "    BACKUP_ENCRYPTION_KEY=$FINAL_BKP"
echo "======================================================================"
