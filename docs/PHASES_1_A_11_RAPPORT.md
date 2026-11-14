# Bilan d’exécution Phases 0 à 11 — MDL Connect

Application PWA complète et auto-hébergeable de gestion de la **Maison des Lycéens (MDL)**, conforme au cahier des charges et aux verrous techniques fixés en Phase 0.

## Synthèse par phase

| Phase | Périmètre | Statut | Preuves & livrables clés |
|---|---|---|---|
| **0 — Cadrage & Architecture** | Choix stack, schémas, matrice permissions, ergonomie Android bas de gamme | Validée | `docs/PHASE_0_CADRAGE_ARCHITECTURE.md` |
| **1 — Monorepo, Rust/WASM & Design System** | Workspace `pnpm`, crate `crates/mdl-wasm` (`compress_receipt_image`, `verify_ticket_ed25519`, `parse_and_verify_ticket_qr`, `compute_budget_summary`, `export_rows_to_csv`), Tailwind v4 + UI Svelte 5 + graphiques SVG 60fps | Validée | `cargo test` (`10 passed`), `scripts/build-wasm.sh`, `src/lib/components/` |
| **2 — BDD PostgreSQL 17 & Crypto** | Schéma Drizzle 22 tables / 13 enums, migration SQL stricte, double driver `pg.Pool` / `PGlite`, seed idempotent 7 rôles, Argon2id, AES-256-GCM, TOTP RFC 6238, Ed25519 | Validée | `drizzle/0000_init.sql`, `src/lib/server/{db,crypto,tickets}.ts` |
| **3 — API Auth, Membres, RGPD & Admin** | Inscription mineurs/école, connexion + TOTP, lien magique (avec vérification 2FA), membres/cotisations, export/suppression RGPD, paramètres & push | Validée | `src/routes/api/{auth,members,rgpd,admin,notifications,health}/` |
| **4 — API Projets, Budget, AG, Sondages, Billetterie, Passation** | Endpoints REST/SSE typés Zod, transactions atomiques (`FOR UPDATE` places), anonymisation vote AG, PDF (`pdf-lib`), audit SHA-256 chaîné | Validée | `src/routes/api/{projects,budget,assemblies,polls,events,tickets,passation,vault,parcoursup,audit}/` |
| **5 — Shell PWA, Auth & Pages publiques** | Service Worker (`service-worker.ts`), manifest PWA, View Transitions GPU (`transform`/`opacity`), `/`, `/connexion`, `/inscription`, `/confidentialite` | Validée | `src/routes/+layout.svelte`, `src/service-worker.ts`, `static/manifest.webmanifest` |
| **6 — Modules Bureau & Vie Lycéenne** | Dashboard KPI, Projets + Kanban + templates, Budget + compression WASM + SVG 60fps + exports CSV/PDF, Assemblées Générales + PDF + vote | Validée | `src/routes/{dashboard,projets,budget,ag}/` |
| **7 — Sondages SSE, Billetterie/Scanner Ed25519, Passation, Parcoursup, Admin** | Temps réel SSE, billetterie QR Ed25519, scanner hors-ligne IndexedDB + WASM, coffre AES-256-GCM, attestations Parcoursup PDF, profil 2FA/RGPD | Validée | `src/routes/{sondages,billetterie,passation,parcoursup,membres,profil,admin}/` |
| **8 — Infra Docker & Scripts Non-Dev** | Multi-stage `Dockerfile`, `docker-compose.yml` (`postgres:17-alpine`, `app`, `backup`, `cloudflared`, `uptime-kuma`), `install.sh`, `backup.sh`, `restore.sh`, `update.sh` | Validée | `docker-compose.yml`, `Dockerfile`, `scripts/*.sh`, `infra/cloudflared-waf-checklist.md` |
| **9 — Documentation complète FR** | Guides déploiement débutant, utilisation, administration, passation annuelle, matrice permissions, sécurité/RGPD | Validée | `README.md`, `docs/{DEPLOIEMENT_DEBUTANT,UTILISATION,ADMIN,PASSATION,MATRICE_PERMISSIONS,SECURITE_RGPD}.md` |
| **10 — Revue code, Sécurité & Tests unitaires** | Audit OWASP/contrats (`REVUE_CODE.md`), 5 correctifs sécurité/UI appliqués, couverture cœur métier > 84 %, `svelte-check` 0 erreur | Validée | `docs/REVUE_CODE.md`, `src/lib/**/*.test.ts` (`25 passed`) |
| **11 — E2E Playwright & Audit Lighthouse** | Parcours complet Desktop Chrome & Mobile Pixel 5 (y compris scanner Ed25519 hors-ligne), Lighthouse Perf 99 / A11y 100 / BP 100 / SEO 100 | Validée | `tests/e2e/mdl-full-journey.spec.ts`, `docs/RAPPORT_QUALITE.md` |
