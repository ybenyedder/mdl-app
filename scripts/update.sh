#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# MDL Connect — Mise à jour sécurisée avec backup préventif & rollback auto
# ==============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

HEALTH_URL="${MDL_HEALTH_URL:-http://127.0.0.1:3000/api/health}"
WAIT_SECONDS=60

log() { printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }
err() { printf '[%s] ERREUR : %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >&2; }

for cmd in git docker curl; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    err "Outil requis manquant : $cmd"
    exit 1
  fi
done

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  err "Ce dossier n'est pas un dépôt Git : $ROOT_DIR"
  exit 1
fi

PREV_COMMIT="$(git rev-parse HEAD)"
BACKUP_TAKEN=0

rollback() {
  local reason="$1"
  err "Échec de la mise à jour ($reason). Lancement du ROLLBACK automatique..."

  log "Rollback Git vers le commit précédent ($PREV_COMMIT)..."
  git reset --hard "$PREV_COMMIT"

  log "Reconstruction de la version précédente..."
  docker compose build

  if [ "$BACKUP_TAKEN" -eq 1 ]; then
    log "Restauration de la base PostgreSQL 17 depuis la sauvegarde préventive..."
    docker compose stop app >/dev/null 2>&1 || true
    docker compose up -d postgres
    bash "$SCRIPT_DIR/restore.sh" --latest --yes || err "Attention : la restauration automatique de la DB a échoué."
  fi

  log "Redémarrage complet de la version précédente..."
  docker compose up -d

  err "Rollback terminé sur $PREV_COMMIT. L'ancienne version a été rétablie."
  exit 1
}

log "Commit actuel enregistré pour rollback éventuel : $PREV_COMMIT"

# 1. Backup préventif PostgreSQL 17 avant toute modification
if docker compose ps --status running --services 2>/dev/null | grep -qx "postgres"; then
  log "1/5 Sauvegarde préventive PostgreSQL 17 avant mise à jour..."
  bash "$SCRIPT_DIR/backup.sh" --quiet
  BACKUP_TAKEN=1
  log "Sauvegarde préventive créée avec succès."
else
  log "1/5 Service 'postgres' non démarré, sauvegarde préventive ignorée."
fi

# 2. Récupération du code
log "2/5 Téléchargement de la nouvelle version (git pull --ff-only)..."
if ! git pull --ff-only; then
  err "git pull --ff-only a échoué (modifications locales ou conflit). Aucun changement appliqué."
  exit 1
fi

NEW_COMMIT="$(git rev-parse HEAD)"
if [ "$NEW_COMMIT" = "$PREV_COMMIT" ]; then
  log "Déjà à jour ($NEW_COMMIT). Aucune reconstruction nécessaire."
  exit 0
fi

# 3. Build Docker
log "3/5 Construction de la nouvelle image Docker..."
if ! docker compose build; then
  rollback "docker compose build a échoué"
fi

# 4. Déploiement
log "4/5 Redémarrage des conteneurs..."
if ! docker compose up -d; then
  rollback "docker compose up -d a échoué"
fi

# 5. Vérification /api/health
log "5/5 Vérification de santé sur $HEALTH_URL (max ${WAIT_SECONDS}s)..."
HEALTHY=0
ATTEMPTS=$((WAIT_SECONDS / 2))
for _ in $(seq 1 "$ATTEMPTS"); do
  if curl -fsS "$HEALTH_URL" >/dev/null 2>&1; then
    HEALTHY=1
    break
  fi
  sleep 2
done

if [ "$HEALTHY" -ne 1 ]; then
  rollback "le test /api/health n'a pas répondu 200 OK dans les ${WAIT_SECONDS}s"
fi

log "Mise à jour réussie : $PREV_COMMIT -> $NEW_COMMIT (healthcheck OK)."
