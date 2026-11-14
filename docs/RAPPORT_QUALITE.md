# Rapport Qualité Final & Plan de Maintenance — MDL Connect

Date : 2026-11-13  
Périmètre vérifié : Workspace complet (`crates/mdl-wasm`, `apps/web`, `scripts/`, `docker-compose.yml`, `docs/`)

---

## 1. Résultats des tests & vérifications automatisées

| Suite / Outil | Commande exécutée | Résultat exact observé |
|---|---|---|
| **Rust / WASM** (`crates/mdl-wasm`) | `cargo test --manifest-path crates/mdl-wasm/Cargo.toml` | **10 passed, 0 failed** (compression JPEG/resize, Ed25519 `MDL1` valide/tampered/mauvaise clé, résumé budget, export CSV RFC 4180 BOM + `;`) |
| **Typage SvelteKit + TS strict** | `pnpm --filter @mdl/web check` | **`svelte-check found 0 errors and 0 warnings`** (exit `0`) |
| **Tests unitaires & BDD Vitest** | `pnpm --filter @mdl/web test:unit` | **7 fichiers passés (7), 25 tests passés (25)** (`permissions`, `format`, `crypto`, `tickets`, `pdf`, `audit-rate`, `db` PGlite in-memory) |
| **Couverture cœur métier (`v8`)** | `vitest run --coverage` (`src/lib/shared/**`, `src/lib/server/{crypto,tickets,pdf,audit,rate-limit}.ts`) | **84,6 % Stmts**, **88,67 % Funcs**, **84,6 % Lines** (`audit.ts` 94,79 %, `crypto.ts` 81,59 %, `pdf.ts` 97,15 %, `rate-limit.ts` 100 %, `tickets.ts` 94,87 %, `permissions.ts` 100 %, `project-templates.ts` 100 %) |
| **Build Production** | `pnpm --filter @mdl/web build` | **Build SSR + client + `@sveltejs/adapter-node` réussi en 3,64 s** (exit `0`) |
| **E2E Playwright (Desktop + Android)** | `pnpm --filter @mdl/web test:e2e -- --reporter=list` contre `node apps/web/build/index.js` + PGlite migrée & seedée | **2 passed (36,7 s)** : `chromium` (`10,7 s`) et `mobile-android` Pixel 5 (`25,2 s`), couvrant `/`, `/confidentialite`, `/inscription` (mineur + consentement RGPD), `/membres` (validation adhésion), `/ag` (création, émargement, candidature, vote, clôture/anonymisation, PV `%PDF-`), `/projets` + Kanban, `/budget` (upload justificatif PNG chiffré AES-256-GCM + export CSV/PDF), `/sondages`, `/billetterie` (événement, achat QR `MDL1` Ed25519, encaissement), `/billetterie/scanner` (vérification Ed25519 **hors-ligne** WASM, anti-double-scan local IndexedDB, auto-synchronisation serveur au retour en ligne), `/passation`, `/parcoursup` (PUT + PDF), `/profil` (export RGPD JSON), `/admin/parametres` (audit SHA-256) et absence de débordement horizontal mobile |
| **Infra & Scripts Bash** | `bash -n scripts/*.sh` + `yaml.safe_load('docker-compose.yml')` | **Exit `0`** (`docker-compose.yml YAML OK`) |
| **Zéro WebGPU / FIXME** | `rg -n "FIXME\|WebGPU\|GPUCanvasContext\|requestAdapter" apps/web/src crates/` | **0 occurrence** |

---

## 2. Audits Lighthouse & Budget Bundle (Serveur Node Production)

Mesures réalisées avec `lighthouse` (Chrome headless mobile émulé) sur `node apps/web/build/index.js` :

| Route auditée | Performance | Accessibilité | Bonnes pratiques | SEO | JS transféré (réseau) | Objectifs |
|---|---|---|---|---|---|---|
| `/` (Accueil public) | **99** | **100** | **100** | **100** | **58 248 octets (~56,9 Ko)** (`149 435 B` non compressés / 21 scripts) | Perf ≥ 95, A11y ≥ 95, BP ≥ 95, SEO ≥ 90, JS < 250 Ko |
| `/connexion` | **99** | **100** | **100** | **100** | **68 733 octets (~67,1 Ko)** | Tous seuils dépassés |
| `/billetterie` | **99** | **96** | **100** | **100** | **68 163 octets (~66,6 Ko)** | Tous seuils dépassés |

Total des **48 chunks JS clients** de toute l’application (toutes pages confondues) : **260 126 octets gzippés**, chunk maximal : **48 367 octets gzippés (~47,2 Ko)**.

---

## 3. Correctifs critiques découverts durant la QA & l’E2E

En plus des 5 correctifs sécurité/contrats documentés dans `docs/REVUE_CODE.md` (lien `/inscription`, nav `/admin/parametres`, fermeture contournement 2FA lien magique, dérivation secret JWT billet, parsing uniforme `error || message`), les tests E2E Playwright ont révélé et permis de corriger un bug runtime Svelte 5 :
- **Coercition `<input type="number">` (`bind:value`)** : dans `projets/+page.svelte`, `projets/[id]/+page.svelte`, `budget/+page.svelte`, `admin/parametres/+page.svelte` et `billetterie/+page.svelte`, l’appel `.replace(',', '.')` sur une valeur liée à un champ numérique échouait au runtime (`TypeError`) dès la saisie d’un nombre. Corrigé partout par `String(... ?? '').replace(',', '.')`.

---

## 4. Limites connues sur la machine d’exécution

1. **Docker & démon PostgreSQL absents sur l’hôte de build** : les tests de migration, seed, API, Vitest et Playwright ont été exécutés contre **PostgreSQL in-process (`@electric-sql/pglite`)** exécutant les migrations Drizzle PostgreSQL (`drizzle/0000_init.sql`). En production (`docker-compose.yml`), le driver bascule automatiquement sur `pg.Pool` + `postgres:17-alpine` dès que `DATABASE_URL=postgresql://...` est défini.
2. **Envoi d’emails SMTP & Stripe** : vérifiés en mode sans serveur mail (liens de secours affichés dans l’interface, billetterie gratuite/espèces/virement). Les options SMTP (`SMTP_HOST`) et Stripe (`STRIPE_SECRET_KEY`) sont prêtes dans `.env.example` mais non appelées contre des API tierces externes en test local.

---

## 5. Plan de maintenance sur 12 mois (pour bureau MDL non-développeur)

| Fréquence | Action recommandée | Outil / Commande |
|---|---|---|
| **Quotidien (auto)** | Sauvegarde PostgreSQL 17 + uploads chiffrés + rotation 30 jours | Conteneur `backup` (`scripts/backup.sh`) |
| **Hebdomadaire** | Vérification Uptime Kuma + santé `/api/health` + intégrité chaîne audit SHA-256 | Interface `/admin/parametres` & Uptime Kuma |
| **Mensuel** | Mise à jour images Docker & reconstruction propre + test de restauration sur dossier temporaire | `bash scripts/update.sh` & `bash scripts/restore.sh` |
| **Trimestriel** | Vérification des comptes membres inactifs & revue des journaux RGPD | Page `/membres` & `/admin/parametres` |
| **Annuel (Mai–Juin)** | Procédure complète de passation : changement `SESSION_SECRET` / accès admin, nouvel exercice comptable, archivage bureau sortant, export bilan Parcoursup | Module `/passation` & `docs/PASSATION.md` |
