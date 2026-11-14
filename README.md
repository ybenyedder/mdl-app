# MDL Connect

Application web PWA auto-hébergeable pour la gestion d'une Maison des Lycéens (association loi 1901) : adhésions, trésorerie, projets, assemblées générales, billetterie QR hors-ligne, boutique de précommandes et passation.

## Pile technique

- **Frontend / Backend** : SvelteKit 2, Svelte 5, TypeScript, Tailwind CSS v4 (`apps/web`)
- **Base de données** : PostgreSQL 17 et Drizzle ORM (PGlite en mémoire pour le développement et les tests)
- **Cryptographie client / QR** : Rust compilé en WebAssembly (`crates/mdl-wasm`) pour la vérification Ed25519 hors-ligne
- **Déploiement** : Docker Compose (`postgres`, `app`, `backup`, `cloudflared`, `uptime-kuma`)

## Déploiement Docker

```bash
git clone https://github.com/ybenyedder/mdl-app.git
cd mdl-app
cp .env.example .env
# Renseigner POSTGRES_PASSWORD, SESSION_SECRET, ENCRYPTION_KEY, JWT_TICKET_SECRET, TICKET_ED25519_PRIVATE_KEY_HEX
docker compose up -d --build
```

Un script d'installation automatisé est également disponible :

```bash
chmod +x scripts/install.sh
./scripts/install.sh
```

Au premier lancement sur une base vierge, ouvrir `/setup` pour créer le compte Président et initialiser l'établissement.

### Exposition HTTPS (Cloudflare Tunnel)

Définir `PUBLIC_APP_URL` et `ORIGIN` sur votre domaine HTTPS dans `.env`, puis lancer le profil tunnel avec un `CLOUDFLARE_TUNNEL_TOKEN` :

```bash
docker compose --profile tunnel up -d
```

Le point d'entrée [apps/web/server.mjs](apps/web/server.mjs) désactive le cache navigateur et CDN sur `/sw.js`, `/service-worker.js`, `/manifest.webmanifest` et `/_app/version.json` afin que les mises à jour PWA soient servies immédiatement.

## Développement local

Prérequis : Node.js >= 22, pnpm >= 9, Rust (`wasm32-unknown-unknown`) et `wasm-bindgen-cli` pour recompiler le module WASM.

```bash
pnpm install --frozen-lockfile
pnpm build:wasm
DATABASE_URL="pglite://memory" pnpm dev
```

Commandes principales :

```bash
pnpm check       # svelte-check et vérification TypeScript
pnpm test:unit   # tests unitaires Vitest (PGlite en mémoire)
pnpm test:e2e    # tests Playwright
pnpm build       # compilation WASM + build production SvelteKit
```

## Variables d'environnement notables

Voir [.env.example](.env.example) pour la liste complète :

- `POSTGRES_PASSWORD`, `DATABASE_URL` : connexion PostgreSQL 17
- `ENCRYPTION_KEY`, `SESSION_SECRET`, `JWT_TICKET_SECRET`, `TICKET_ED25519_PRIVATE_KEY_HEX` : clés cryptographiques (`openssl rand -hex 32`)
- `PUBLIC_APP_URL`, `ORIGIN` : URL publique (obligatoire en HTTPS pour les cookies de session et la protection CSRF)
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` : paiement en ligne optionnel
- `GELATO_API_KEY`, `GELATO_ORDER_TYPE`, `GELATO_SHIP_*` : impression textile optionnelle via Gelato API v4
- `SMTP_*`, `VAPID_*` : envoi d'emails et notifications Web Push optionnels

## Structure du dépôt

```text
apps/web/          Application SvelteKit et API
crates/mdl-wasm/   Module Rust WebAssembly (Ed25519, utilitaires client)
docs/              Guides d'installation, administration et sécurité
scripts/           install.sh, backup.sh, restore.sh, update.sh, build-wasm.sh
```

## Documentation

- [Déploiement](./docs/DEPLOIEMENT_DEBUTANT.md)
- [Administration](./docs/ADMIN.md)
- [Utilisation](./docs/UTILISATION.md)
- [Sécurité et RGPD](./docs/SECURITE_RGPD.md)
- [Permissions RBAC](./docs/MATRICE_PERMISSIONS.md)
- [Passation](./docs/PASSATION.md)
