# Sécurité & Conformité RGPD — MDL Connect

> Ce document explique, en termes simples mais exacts, comment **MDL Connect** protège les données des lycéens (notamment les mineurs de 15 à 18 ans), sécurise les votes et respecte les bonnes pratiques de sécurité (**OWASP ASVS Niveau 1** et **RGPD**).

---

## 1. Vocabulaire simple (zéro jargon non expliqué)

- **Chiffrement au repos (AES-256-GCM)** : même si quelqu'un volait le disque dur ou copiait la base de données, les données sensibles (adresses email, fichiers du coffre-fort, tickets de caisse, secrets de double authentification) sont transformées en texte illisible. Sans la clé `ENCRYPTION_KEY`, personne ne peut les lire.
- **Hachage irréversible (Argon2id)** : votre mot de passe n'est **jamais** stocké en clair dans la base de données. Il est transformé par une empreinte mathématique très lente à deviner pour un pirate (Argon2id, le standard recommandé aujourd'hui). Même l'administrateur du site ne connaît pas votre mot de passe.
- **Signature cryptographique (Ed25519)** : un tampon mathématique infalsifiable apposé sur chaque billet QR. N'importe quel téléphone du bureau peut vérifier que le billet est authentique grâce à la clé publique, **même sans connexion Internet**.
- **Cookie `httpOnly` + `SameSite=Strict`** : le badge numérique qui prouve que vous êtes connecté est protégé dans le navigateur pour qu'aucun script malveillant ni site extérieur ne puisse le voler.

---

## 2. Conformité OWASP ASVS Niveau 1 (Sécurité Web)

L'application applique les protections essentielles du standard international **OWASP ASVS L1** :

| Protection | Comment c'est fait dans MDL Connect |
|---|---|
| **Mots de passe solides** | Hachage **Argon2id** (`memoryCost: 19456`, `timeCost: 2`, `parallelism: 1`) via `@node-rs/argon2`. |
| **Double authentification (2FA TOTP)** | Support natif d'applications comme FreeOTP, Aegis ou Google Authenticator (codes à 6 chiffres toutes les 30 s, secret chiffré en AES-256-GCM). |
| **Sessions sécurisées** | Jetons aléatoires de 32 octets, stockés hachés en SHA-256 côté base PostgreSQL, avec durée limitée (14 jours), cookie `httpOnly`, `SameSite=Strict` et `Secure` en HTTPS. |
| **Contrôle d'accès strict (RBAC)** | Chaque action serveur vérifie les droits selon les 7 rôles et 30 permissions (voir [MATRICE_PERMISSIONS.md](MATRICE_PERMISSIONS.md)). |
| **Protection anti-force brute** | Limitation du nombre de requêtes (*rate limiting* stocké dans la table `rate_limits`) + règles WAF Cloudflare recommandées sur `/api/auth/login`. |
| **Validation stricte des saisies** | Toutes les données envoyées par les formulaires et API sont vérifiées par **Zod** ; les requêtes base de données utilisent **Drizzle ORM** (requêtes paramétrées contre les injections SQL). |
| **En-têtes HTTP de sécurité** | `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY` (anti-clickjacking), `Referrer-Policy: no-referrer`, `Permissions-Policy`, et `Cache-Control: no-store` sur toutes les routes `/api/*`. |
| **Upload de fichiers sécurisé** | Vérification des *magic bytes* (signature réelle du fichier, pas juste l'extension `.jpg`), formats limités à **JPEG, PNG, WebP et PDF** (max 8 Mo), renommage aléatoire UUID et chiffrement immédiat sur disque. |
| **Journal d'audit infalsifiable** | Les actions critiques (changements de rôles, budget, AG, passation) sont enregistrées dans `audit_logs` et chaînées par empreinte **SHA-256** (`prevHash` -> `entryHash`) pour détecter toute falsification rétroactive. |

---

## 3. Chiffrement au repos (AES-256-GCM) & Hors-ligne (Ed25519)

### A. Données chiffrées en AES-256-GCM (avec `ENCRYPTION_KEY`)
Toutes ces informations sont chiffrées avant écriture dans PostgreSQL 17 ou sur le disque :
- **Adresses email des utilisateurs** (`users.email_encrypted`) — la recherche à la connexion utilise un index aveugle HMAC-SHA256 (`users.email_hash`).
- **Emails des responsables légaux** (`users.legal_guardian_email_encrypted`).
- **Secrets 2FA TOTP** (`users.totp_secret_encrypted`).
- **Emails des acheteurs de billets** (`tickets.buyer_email_encrypted`).
- **Justificatifs de dépenses** (`data/uploads/receipts/*.enc`) après compression JPEG locale côté client par le module Rust/WASM (`compress_receipt_image`).
- **Documents du coffre-fort** (`data/uploads/vault/*.enc`) : statuts, RIB, contrats, récépissés.

### B. Sauvegardes chiffrées (`.tar.gz.enc`)
Chaque nuit à 03h00, `scripts/backup.sh` exporte la base PostgreSQL 17 (`pg_dump -Fc`) et les fichiers chiffrés `data/uploads/`, puis chiffre l'archive avec **OpenSSL AES-256-CBC + PBKDF2 (100 000 itérations, SHA-256)** et la clé `BACKUP_ENCRYPTION_KEY` avant envoi sur Cloudflare R2.

### C. Billets QR vérifiables hors-ligne (Ed25519 + Rust/WASM)
Chaque billet contient un jeton signé avec la clé privée **Ed25519** (`TICKET_ED25519_PRIVATE_KEY_HEX`) au format `MDL1.<payload_b64url>.<sig_b64url>`.
Lors du contrôle à l'entrée d'un bal ou tournoi (sous-sol ou gymnase sans Wi-Fi) :
- Le navigateur du téléphone du membre du bureau utilise le module **Rust/WASM (`mdl-wasm`)** déjà mis en cache par la PWA.
- La fonction `parse_and_verify_ticket_qr` vérifie localement la signature Ed25519 grâce à la **clé publique** (exposée sans danger sur `/api/health`).
- Même si le serveur est coupé ou qu'il n'y a pas de 4G, il est **impossible** de fabriquer un faux QR code valide.

---

## 4. Anonymisation des votes d'Assemblée Générale (secret du scrutin)

Comment garantir à la fois qu'**un adhérent ne peut voter qu'une seule fois** et que **son vote reste secret** ?

1. **Pendant que le vote est ouvert (`anonymized = false`)** :
   - La table `ag_votes` enregistre le vote avec un verrou technique unique (`UNIQUE (assembly_id, voter_id) WHERE voter_id IS NOT NULL AND anonymized = false`). Cela empêche mathématiquement tout double vote.
   - L'émargement (`ag_attendances`) note qui a participé à l'AG, séparément du choix de candidat.
2. **Après la clôture et proclamation des résultats** :
   - Les bulletins sont **anonymisés** (`voter_id` est dissocié et `anonymized` passe à `true`).
   - Il devient alors **impossible** de savoir qui a voté pour quel candidat, même en ouvrant la base de données PostgreSQL.
   - Le Procès-Verbal PDF généré mentionne explicitement : *« Les votes ont été anonymisés après proclamation conformément au RGPD. »*

---

## 5. RGPD & Droits spécifiques des mineurs (15–18 ans)

### Base légale et majorité numérique à 15 ans
- En France (**article 45 de la loi Informatique et Libertés**, en lien avec l'article 8 du RGPD), un jeune âgé d'**au moins 15 ans** (la grande majorité des lycéens en Seconde, Première et Terminale) peut consentir seul à la création d'un compte sur un service en ligne associatif.
- Pour les élèves de **moins de 15 ans** (ex. élève de Seconde né en fin d'année) ou par transparence familiale, un champ optionnel permet d'indiquer l'adresse email d'un **responsable légal** (stockée chiffrée en AES-256-GCM).
- Lors de l'inscription, un texte en français clair explique à quoi servent les données (gestion des adhésions, projets, billetterie, votes — **aucune revente, aucune publicité, aucun traceur Google/Meta**).

### Les 5 droits garantis aux élèves et parents
1. **Droit d'information** : savoir exactement quelles données sont collectées (nom, prénom, classe, email, statut d'adhésion).
2. **Droit d'accès et de rectification** : corriger une erreur de classe ou d'orthographe depuis son profil ou via le Secrétaire.
3. **Droit à l'effacement (« droit à l'oubli »)** : tout élève quittant le lycée ou ne souhaitant plus apparaître peut demander la suppression de son compte (`deletionRequestedAt` -> `deletedAt`).
4. **Minimisation des données** : aucune donnée médicale, aucune note scolaire, aucun numéro de téléphone obligatoire, aucune géolocalisation.
5. **Durée de conservation limitée** : les comptes des élèves ayant quitté l'établissement doivent être supprimés ou anonymisés lors de la passation annuelle (seules les pièces comptables légales sont conservées dans les archives associatives selon la durée légale).

---

## 6. Checklist sécurité pré-mise-en-ligne (à cocher avant d'ouvrir aux élèves)

Cochez chaque case avant d'annoncer l'adresse du site au lycée :

### Secrets & Base de données
- [ ] Les secrets par défaut du fichier `.env.example` ont tous été remplacés (fait automatiquement si installé via `bash scripts/install.sh`).
- [ ] Les clés `SESSION_SECRET`, `ENCRYPTION_KEY`, `JWT_TICKET_SECRET`, `TICKET_ED25519_PRIVATE_KEY_HEX` et `BACKUP_ENCRYPTION_KEY` ont au moins 64 caractères hexadécimaux aléatoires.
- [ ] Le fichier `.env` n'est **jamais** envoyé sur GitHub / GitLab (il est ignoré par `.gitignore`).
- [ ] La clé `BACKUP_ENCRYPTION_KEY` (et le fichier `.env`) a été recopiée dans un gestionnaire de mots de passe ou imprimée et rangée dans le coffre physique du lycée.
- [ ] Les comptes de test `*-demo.fr` (`MdlDemo2026!`) n'existent pas en production (ou ont été supprimés).
- [ ] Le mot de passe initial `ADMIN_PASSWORD` du Président a été changé dès la première connexion.

### Comptes & Double Authentification (2FA)
- [ ] La double authentification (**2FA TOTP**) est activée sur les comptes **Président**, **Trésorier** et **Secrétaire**.
- [ ] Le compte du **Professeur référent** est créé avec le rôle `prof_referent` et vérifié.
- [ ] Le mode d'inscription est choisi selon le besoin (`school_code` avec code secret donné à la rentrée, ou `open`, ou `invite_only`).

### Réseau, HTTPS & Pare-feu (Cloudflare)
- [ ] `PUBLIC_APP_URL` dans `.env` commence bien par `https://` (ex. `https://mdl.monlycee.fr`).
- [ ] Aucun port de base de données (`5432`) ni de l'application (`3000`) n'est ouvert sur la box Internet (`127.0.0.1` uniquement, accès public via `cloudflared`).
- [ ] Sur Cloudflare : mode SSL/TLS réglé sur **Strict** et **Always Use HTTPS** activé (voir [infra/cloudflared-waf-checklist.md](../infra/cloudflared-waf-checklist.md)).
- [ ] Sur Cloudflare : règle WAF / Rate Limiting activée sur `/api/auth/login` pour bloquer les attaques par mots de passe.

### Sauvegardes & Vérification finale
- [ ] Le conteneur `mdl-backup` tourne (`docker compose ps`) et un premier test `bash scripts/backup.sh` a réussi.
- [ ] La sauvegarde chiffrée est bien visible dans **Cloudflare R2** (ou sur une clé USB hors-site).
- [ ] Un exercice de restauration (`bash scripts/restore.sh --latest`) a été testé avec succès au moins une fois.
- [ ] La page `https://votre-domaine.fr/api/health` renvoie `{"ok":true,"status":"healthy",...}`.
