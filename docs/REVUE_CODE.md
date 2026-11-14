# Revue de code & Audit pré-E2E — MDL Connect

Date : 2026-11-13  
Portée : `apps/web/src`, `crates/`, `docs/`

## 1. Placeholders & Règles verrouillées (WebGPU)

Commande exécutée :
`rg -n "TODO|FIXME|placeholder|à compléter|WebGPU|GPUCanvasContext|requestAdapter" apps/web/src crates/ docs/`

- **Code WebGPU / `GPUCanvasContext` / `requestAdapter` dans `apps/web/src/`** : **0 occurrence**. Seule la documentation d'architecture (`docs/PHASE_0_CADRAGE_ARCHITECTURE.md:15`) mentionne l'exclusion de WebGPU/WebGL2 au profit de CSS `transform`/`opacity`, View Transitions et SVG.
- **`FIXME` / `à compléter`** : **0 occurrence**.
- **`TODO` / `placeholder`** : uniquement des attributs HTML `placeholder="..."` dans les formulaires `.svelte` et un commentaire généré par `wasm-bindgen` dans `apps/web/src/lib/wasm-pkg/mdl_wasm.js:422`.

## 2. Audit Contrat Frontend ↔ Backend & Navigation

Toutes les pages (`connexion`, `inscription`, `dashboard`, `projets`, `projets/[id]`, `budget`, `ag`, `sondages`, `billetterie`, `billetterie/scanner`, `passation`, `parcoursup`, `membres`, `profil`, `admin/parametres`) ont été vérifiées face aux endpoints `+server.ts`.

### Corrections appliquées

1. **Lien d'invitation membre vers route inexistante (`/register` → `/inscription`)**
   - `apps/web/src/routes/api/members/+server.ts` : l'URL d'invitation générée pointait vers `/register?invite=...` (404) au lieu de `/inscription?invite=...` (lu par `apps/web/src/routes/inscription/+page.svelte`). Corrigé vers `/inscription?invite=...`.
2. **Lien de navigation Admin cassé (`/admin` → `/admin/parametres`) + accès `/membres` et `/profil`**
   - `apps/web/src/routes/+layout.svelte` :
     - `Admin` pointait vers `/admin` (route inexistante). Redirigé vers `/admin/parametres` pour les rôles ayant `admin:settings` ou `audit:read`.
     - Ajout du lien `Membres` (`/membres`) dans la navigation pour les rôles ayant `members:read`.
     - Ajout du lien `Mon profil & 2FA` (`/profil`) dans le menu utilisateur.
3. **Extraction uniforme des messages d'erreur API (`error` vs `message`)**
   - Les endpoints SvelteKit utilisant `throw error(...)` renvoient `{ message }`, tandis que les réponses `json({ error })` (dont `enforceRateLimit` 429) renvoient `{ error }`.
   - Plusieurs pages ne lisaient que `payload.error` (masquant les erreurs `401`/`403`/`404` de `requireAuth` ou `parsePositiveIntId` sous un message générique) : corrigé pour lire `payload.error || payload.message` dans :
     - `apps/web/src/routes/passation/+page.svelte`
     - `apps/web/src/routes/parcoursup/+page.svelte`
     - `apps/web/src/routes/membres/+page.svelte` (y compris `DELETE /api/members/[id]?type=invitation`)
     - `apps/web/src/routes/profil/+page.svelte`
     - `apps/web/src/routes/billetterie/scanner/+page.svelte`

### Contrats critiques vérifiés conformes
- `inscription` → `POST /api/auth/register` : valide `rgpdConsent: true`, `schoolCode` (si mode `code`), `legalGuardianEmail` (si `isMinor`), `inviteToken`.
- `membres` → `PATCH /api/members/[id]` : validation adhésion (`isAdherent`, `adhesionMethod`) et changement de rôle/titre (`admin:roles`, anti-auto-rétrogradation du dernier admin).
- `ag` → `POST /api/assemblies/[id]/vote` & `PATCH /api/assemblies/[id]` : quorum, double vote bloqué par contrainte DB, transaction d'anonymisation (`voterId: null, anonymized: true`) à la clôture (`cloturee`).
- `projets` & `projets/[id]` → `POST /api/projects`, `POST/PATCH/DELETE /api/projects/[id]/tasks`.
- `budget` → `POST /api/budget` : support JSON et `multipart/form-data` avec chiffrement AES-256-GCM des justificatifs.
- `billetterie` & `billetterie/scanner` → `POST /api/tickets` (verrou transactionnel `for('update')`), `GET /api/health` (`ticketPublicKeyHex`), `verifyTicketOfflineWasm` + `POST /api/tickets/scan` (unitaire et lot `{ scans }`).
- `passation` → `GET/PATCH/POST /api/passation` et `GET/POST/DELETE /api/vault`.

## 3. Audit Sécurité OWASP ASVS L1

### Corrections appliquées

1. **Contournement de la 2FA TOTP via lien magique (`magic` login bypass)**
   - `apps/web/src/routes/api/auth/magic/+server.ts` créait une session avec `twoFactorVerified = false` pour les comptes `totpEnabled = true` et redirigeait directement vers `/dashboard`, tandis que `loadSessionContext` et `requireAuth` (`apps/web/src/lib/server/auth.ts`) n'exploitaient pas `twoFactorVerified`.
   - Correctif complet :
     - `loadSessionContext` ne peuple plus `locals.user` tant que `row.totpEnabled && !row.twoFactorVerified`.
     - `requireAuth` vérifie également `!event.locals.session.twoFactorVerified` si `user.totpEnabled` (réponse `403`).
     - `GET /api/auth/magic` redirige désormais les comptes 2FA vers `/connexion?totp=1`.
     - Ajout de `PATCH /api/auth/magic` (rate-limité + vérification TOTP sur la session en attente, puis `twoFactorVerified = true`) et du formulaire dédié dans `apps/web/src/routes/connexion/+page.svelte`.
2. **Secret JWT billet avec valeur codée en dur (`tickets.ts`)**
   - `apps/web/src/lib/server/tickets.ts` utilisait `'dev-ticket-jwt-secret-change-me-in-production'` si `JWT_TICKET_SECRET` n'était pas défini, y compris en production.
   - Remplacé par une dérivation HMAC-SHA256 depuis `getSessionSecret()` (qui échoue en production si ni `SESSION_SECRET` ni `ENCRYPTION_KEY` n'est configuré).

### Contrôles vérifiés conformes
- **Contrôle d'accès / Anti-IDOR** : tous les endpoints protégés appellent `requireAuth(event, permission)` ; portée restreinte sur `parcoursup` (`?userId=`), `tickets` (`?scope=all` réservé à `tickets:read_admin`), `assemblies/[id]` (pointage d'un autre membre réservé à `ag:manage`), `notifications/push` (`DELETE` filtré sur `userId`), `uploads.ts` (validation MIME par magic bytes + chiffrement AES-256-GCM + garde anti-path-traversal).
- **CSP & En-têtes HTTP** : `apps/web/svelte.config.js` configure `csrf.trustedOrigins: []` et une CSP stricte (`mode: 'auto'`, `script-src: ['self', 'wasm-unsafe-eval']`, `object-src: ['none']`, `frame-ancestors: ['none']`, `form-action: ['self']`). `apps/web/src/hooks.server.ts` exécute `await ensureMigrated()` et injecte `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Permissions-Policy`, et `Cache-Control: no-store` sur `/api/*`.

## 4. Preuves de vérification (après dernières modifications)

1. `pnpm --filter @mdl/web check` : `svelte-check found 0 errors and 0 warnings` (exit `0`).
2. `pnpm --filter @mdl/web test:unit` : `Test Files 7 passed (7)`, `Tests 25 passed (25)` (exit `0`).
3. `pnpm --filter @mdl/web build` : build SSR + client + `@sveltejs/adapter-node` terminé sans erreur (`✓ built in 3.54s`, exit `0`).
4. Démarrage serveur production (`NODE_ENV=production node apps/web/build/index.js` avec PGlite temporaire) :
   - `GET /api/health` → `HTTP/1.1 200 OK`, `cache-control: no-store`, JSON `{"ok":true,"status":"healthy","timestamp":"2026-11-13T16:52:11.220Z","ticketPublicKeyHex":"e28c1994e43995eaadee875aee294c7ec48df494b184a1b796ea54464d97daa0"}` (aucune fuite de secret).
   - `HEAD /` → `HTTP/1.1 200 OK` avec en-têtes `Content-Security-Policy` (nonce + `wasm-unsafe-eval`), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Permissions-Policy`.
