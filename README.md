<div align="center">
  <img src="./docs/assets/logo.png" alt="MDL Connect Logo" width="96" height="96" />
  <h1>MDL Connect</h1>
  <p>
    <strong>Plateforme tout-en-un auto-hébergeable pour les Maisons des Lycéens (Loi 1901)</strong><br />
    Didacticiel d'installation <code>/setup</code>, boutique zéro-avance avec vrais fournisseurs, billetterie QR Ed25519 hors-ligne, réunions, AG, Stripe & coffre-fort RGPD.
  </p>
  <p>
    <img src="https://img.shields.io/badge/SvelteKit-2%20%2F%20Svelte%205-ff3e00?style=flat-square&logo=svelte&logoColor=white" alt="SvelteKit 2 / Svelte 5" />
    <img src="https://img.shields.io/badge/Rust-WASM%20%2B%20Ed25519-000000?style=flat-square&logo=rust&logoColor=white" alt="Rust WASM" />
    <img src="https://img.shields.io/badge/PostgreSQL-17%20%2B%20Drizzle-336791?style=flat-square&logo=postgresql&logoColor=white" alt="PostgreSQL 17" />
    <img src="https://img.shields.io/badge/Stripe-Checkout%20%26%20Webhook-635bff?style=flat-square&logo=stripe&logoColor=white" alt="Stripe" />
    <img src="https://img.shields.io/badge/Docker-Compose-2496ed?style=flat-square&logo=docker&logoColor=white" alt="Docker" />
  </p>
</div>

<p align="center">
  <img src="./docs/screenshots/dashboard-dark.png" alt="Tableau de bord Administrateur MDL Connect (Dark Mode)" width="100%" />
</p>

| Didacticiel 1re installation (`/setup`) | Boutique zéro-avance & précommandes |
| :---: | :---: |
| ![Didacticiel /setup Dark Mode](./docs/screenshots/setup-dark.png) | ![Boutique précommandes Dark Mode](./docs/screenshots/boutique-dark.png) |

---

## Points clés

- **Didacticiel `/setup` (auto-hébergement guidé)** : dès le premier démarrage sur une base vierge (ou dès la 1re connexion Admin), création du compte Administrateur/Président, recherche directe du lycée dans l'**annuaire officiel de l'Éducation nationale (`data.education.gouv.fr`)**, choix des couleurs/logo, cotisation, clés **Stripe CB** et **QR Code d'adhésion `/adhesion`**.
- **Boutique zéro-avance & bons de commande fournisseur** : précommandes `XS→XXL` sans avance de trésorerie, export CSV par taille et génération du **bon de commande consolidé** (`mailto:` configurable côté serveur via `MERCH_SUPPLIER_NAME`, `MERCH_SUPPLIER_EMAIL` et `MERCH_SUPPLIER_URL` dans `.env` ou par article).
- **Billetterie QR signée Ed25519 hors-ligne** : scan caméra temps réel via WebAssembly Rust (`crates/mdl-wasm`) sans connexion requise à l'entrée.
- **Vie associative complète** : Projets & Kanban, Trésorerie & justificatifs chiffrés, Réunions (ordre du jour, émargement, PV PDF), Assemblées Générales (quorum + votes), Sondages temps réel, Passation & Accord établissement PDF, Attestation Parcoursup PDF, Rôles RBAC dynamiques.
- **Sécurité & RGPD** : chiffrement **AES-256-GCM** au repos, clés Stripe chiffrées en base, journal d'audit chaîné **SHA-256**, PWA installable iOS/Android.

---

## Démarrage rapide (Docker + `/setup`)

```bash
git clone https://github.com/ybenyedder/mdl-app.git
cd mdl-app
chmod +x scripts/install.sh
./scripts/install.sh
```

Ouvrez ensuite **`http://<ip-serveur>:3400/setup`** pour créer votre compte Président, localiser votre lycée (ex. *Lycée Auguste Renoir, Cagnes-sur-Mer*) et configurer l'ensemble de la plateforme en 5 étapes.

---

## Architecture & développement local

```text
mdl-app/
├── apps/web/                 # SvelteKit 2 + Svelte 5 + Tailwind v4 + Drizzle PostgreSQL 17
├── crates/mdl-wasm/          # Module Rust WebAssembly (Ed25519 QR offline, graphiques SVG)
├── docs/                     # Logo, captures Dark Mode & guides d'exploitation / RGPD
├── scripts/                  # install.sh, sauvegarde GPG chiffrée, restore & update
└── docker-compose.yml        # PostgreSQL 17 + App + Backups + Uptime Kuma
```

```bash
cd apps/web
pnpm install --frozen-lockfile
npm run check        # svelte-check + TypeScript
npm run test:unit    # Vitest + PostgreSQL PGlite en mémoire
DATABASE_URL="pglite://memory" npm run dev
```

## Impression textile & boutique (optionnel)

- **Mode local (par défaut)** : précommandes zéro avance de trésorerie + génération de bon de commande CSV/email prêt pour votre atelier local.
- **Impression à la demande automatique (Gelato API v4)** : renseignez `GELATO_API_KEY` et `GELATO_SHIP_*` dans `.env` (compte gratuit **0 €/mois**, impression locale France/Europe, `GELATO_ORDER_TYPE=draft` ou `order`), puis indiquez le `productUid` Gelato dans la référence SKU de l'article et l'URL `https://` du visuel d'impression.

## Documentation

- [Guide de déploiement débutant](./docs/DEPLOIEMENT_DEBUTANT.md) · [Administration](./docs/ADMIN.md) · [Utilisation](./docs/UTILISATION.md)
- [Sécurité & RGPD](./docs/SECURITE_RGPD.md) · [Matrice RBAC](./docs/MATRICE_PERMISSIONS.md) · [Passation](./docs/PASSATION.md)
