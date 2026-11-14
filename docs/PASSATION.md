# Passation Annuelle & Récupération d'Urgence — MDL Connect

> La plus grande cause de perte d'une application de MDL est le départ des élèves de Terminale en juin sans passation organisée.
> Ce document contient la **checklist de passation annuelle complète** et la **procédure de secours** si les anciens administrateurs ont déjà quitté le lycée.

---

## 1. Checklist de passation annuelle complète (mai – septembre)

Utilisez cette checklist en complément du module **Passation** intégré à MDL Connect (`passationChecklists`).

### Phase A — Avant l'Assemblée Générale (mai / début juin)
- [ ] **Clôturer l'exercice comptable** (`budget:close_year`) : le Trésorier sortant vérifie toutes les recettes, dépenses et justificatifs photo avec le Professeur référent.
- [ ] **Exporter les archives de l'année** : télécharger le bilan budgétaire PDF, l'export CSV comptable et les attestations Parcoursup des Terminales.
- [ ] **Faire un exercice de restauration** sur un dossier de test ou vérifier la dernière sauvegarde chiffrée dans Cloudflare R2 (`bash scripts/backup.sh`).
- [ ] **Préparer l'AG de renouvellement du bureau** : ouvrir les candidatures dans MDL Connect pour les futurs membres (Secondes / Premières).

### Phase B — Pendant et juste après l'AG (juin)
- [ ] **Tenir l'AG et proclamer les résultats** : les votes sont automatiquement anonymisés après proclamation.
- [ ] **Générer et imprimer le PV d'AG officiel en PDF** (`ag:generate_pv`), puis le faire signer par le Président sortant, le Secrétaire sortant et le Professeur référent.
- [ ] **Mettre à jour les statuts / bureau en préfecture (loi 1901)** : déposer le PV d'AG et la liste des nouveaux dirigeants sur le téléservice officiel (Service-Public.fr / e-modification).
- [ ] **Mettre à jour les mandataires bancaires** : prendre rendez-vous à la banque de la MDL avec le PV d'AG et les pièces d'identité pour retirer les anciens signatures et ajouter le nouveau Président / Trésorier.

### Phase C — Transfert physique, documentaire et numérique (juin – septembre)
- [ ] **Transmettre les clés physiques** : clés du foyer, du local MDL, du coffre/armoire et registre d'inventaire du matériel.
- [ ] **Mettre à jour le Coffre-fort numérique (`vault`)** : vérifier que les statuts loi 1901, récépissé de préfecture, contrat d'assurance, RIB et dernier bilan financier y sont bien classés.
- [ ] **Promouvoir le nouveau bureau dans MDL Connect** :
  1. Le nouveau Président, le nouveau Trésorier et le nouveau Secrétaire créent chacun leur compte personnel.
  2. Le Président sortant leur attribue leurs nouveaux rôles (`president`, `tresorier`, `secretaire`, `bureau`).
  3. Les nouveaux dirigeants activent immédiatement la **2FA TOTP** sur leurs comptes.
  4. Les anciens membres sortants sont repassés en `adherent` ou supprimés s'ils quittent le lycée (**conformité RGPD**).
- [ ] **Transmettre l'hébergement et les secrets techniques** (au nouveau responsable technique + **une copie papier scellée dans le coffre du lycée** avec le Professeur référent) :
  - Accès physique / SSH à l'ordinateur qui héberge MDL Connect (ou migration sur le PC du nouveau responsable via `bash scripts/restore.sh --latest`).
  - Copie sécurisée du fichier **`.env`** et notamment de **`BACKUP_ENCRYPTION_KEY`** et **`ENCRYPTION_KEY`**.
  - Accès au compte **Cloudflare** (Tunnel + R2) et au registrar du nom de domaine.
  - Accès au compte **Brevo** (emails) et éventuellement **Stripe** (si activé).
- [ ] **Supprimer / anonymiser les comptes des anciens élèves diplômés** qui ont quitté l'établissement (hors traces comptables légales conservées au bilan).
- [ ] **Changer l'année scolaire active** dans **Administration** (ex. `2026-2027` -> `2027-2028`) et réinitialiser les statuts de cotisation pour la rentrée.

---

## 2. Procédure de récupération de compte d'urgence (si les anciens ont quitté le lycée)

Pas de panique ! Tant que le lycée (Professeur référent, CPE ou nouvel hébergeur) a accès **à l'ordinateur serveur** (ou à une **sauvegarde `.tar.gz.enc` + sa clé `BACKUP_ENCRYPTION_KEY`**), vous pouvez reprendre le contrôle à 100 % en moins de 10 minutes, sans rien effacer.

### Scénario A — Vous avez accès à l'ordinateur qui héberge MDL Connect (Docker tourne)

#### Option 1 : Promouvoir un compte existant (ex. le Professeur référent ou un nouvel élève déjà inscrit) au rang de `president`

Ouvrez un terminal dans le dossier `mdl-app` et exécutez ces commandes en remplaçant `nouveau.president@lycee.fr` par l'email du compte déjà inscrit :

```bash
cd /chemin/vers/mdl-app

# 1. Calculer le hash de recherche exact (HMAC-SHA256) correspondant à l'email
EMAIL_HASH=$(docker compose exec -T -e TARGET_EMAIL="nouveau.president@lycee.fr" app node -e '
const crypto = require("crypto");
const raw = (process.env.ENCRYPTION_KEY || "").trim();
const master = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, "hex") : crypto.createHash("sha256").update(raw).digest();
const hmacKey = process.env.LOOKUP_HMAC_KEY
  ? Buffer.from(process.env.LOOKUP_HMAC_KEY.trim(), "hex")
  : crypto.createHmac("sha256", master).update("mdl-lookup-hmac-v1", "utf8").digest();
console.log(crypto.createHmac("sha256", hmacKey).update(process.env.TARGET_EMAIL.trim().toLowerCase(), "utf8").digest("hex"));
')

# 2. Promouvoir ce compte en Président et désactiver un éventuel 2FA bloqué
docker compose exec -T postgres psql -U mdl -d mdl -c \
  "UPDATE users SET role = 'president', totp_enabled = false, totp_secret_encrypted = NULL, deleted_at = NULL WHERE email_hash = '${EMAIL_HASH}';"
```

Vérifiez que la commande affiche `UPDATE 1`. L'utilisateur peut maintenant se connecter et gérer toute la MDL !

#### Option 2 : Réinitialiser le mot de passe et débloquer le 2FA de l'ancien compte Président (ou créer un nouveau compte Président de secours)

Si **personne** n'a de compte existant, créez ou réinitialisez un compte `president` directement en ligne de commande :

```bash
cd /chemin/vers/mdl-app

# Choisissez l'email cible et un mot de passe temporaire solide :
TARGET_EMAIL="secours@monlycee.fr"
NEW_PASS="MdlSecours2027!ChangeMe"

# Générer les valeurs chiffrées + hash Argon2id avec les vraies fonctions du conteneur app
SQL_CMD=$(docker compose exec -T -e TARGET_EMAIL="$TARGET_EMAIL" -e NEW_PASS="$NEW_PASS" app node -e '
const crypto = require("crypto");
const { hashSync } = require("./apps/web/node_modules/@node-rs/argon2");

const email = process.env.TARGET_EMAIL.trim().toLowerCase();
const pass = process.env.NEW_PASS;
const rawKey = (process.env.ENCRYPTION_KEY || "").trim();
const master = Buffer.from(rawKey, "hex");
const hmacKey = process.env.LOOKUP_HMAC_KEY
  ? Buffer.from(process.env.LOOKUP_HMAC_KEY.trim(), "hex")
  : crypto.createHmac("sha256", master).update("mdl-lookup-hmac-v1", "utf8").digest();

const emailHash = crypto.createHmac("sha256", hmacKey).update(email, "utf8").digest("hex");
const iv = crypto.randomBytes(12);
const cipher = crypto.createCipheriv("aes-256-gcm", master, iv, { authTagLength: 16 });
const enc = Buffer.concat([cipher.update(email, "utf8"), cipher.final()]);
const tag = cipher.getAuthTag();
const emailEncrypted = `v1:${iv.toString("hex")}:${tag.toString("hex")}:${enc.toString("hex")}`;

const passHash = hashSync(pass, { algorithm: 2, memoryCost: 19456, timeCost: 2, parallelism: 1 });

console.log(`INSERT INTO users (email_encrypted, email_hash, password_hash, first_name, last_name, role, is_adherent, totp_enabled, created_at, updated_at) VALUES (\x27${emailEncrypted}\x27, \x27${emailHash}\x27, \x27${passHash}\x27, \x27Admin\x27, \x27Secours\x27, \x27president\x27, true, false, NOW(), NOW()) ON CONFLICT (email_hash) DO UPDATE SET password_hash = EXCLUDED.password_hash, role = \x27president\x27, totp_enabled = false, totp_secret_encrypted = NULL, deleted_at = NULL, updated_at = NOW();`);
')

# Appliquer dans PostgreSQL 17
echo "$SQL_CMD" | docker compose exec -T postgres psql -U mdl -d mdl
```

Connectez-vous ensuite sur le site avec `secours@monlycee.fr` et `MdlSecours2027!ChangeMe`, puis **changez immédiatement ce mot de passe** et activez le 2FA.

---

### Scénario B — L'ancien ordinateur a disparu ou est cassé

1. Suivez d'abord la **Procédure « Serveur en feu » (Restaurer en 30 minutes)** dans [DEPLOIEMENT_DEBUTANT.md](DEPLOIEMENT_DEBUTANT.md) sur un nouvel ordinateur avec votre sauvegarde `.tar.gz.enc` (depuis Cloudflare R2 ou clé USB) et votre fichier `.env` (`BACKUP_ENCRYPTION_KEY` + `ENCRYPTION_KEY`).
2. Une fois `bash scripts/restore.sh --latest` terminé, appliquez l'**Option 1** ou l'**Option 2** ci-dessus pour récupérer un compte `president` fonctionnel.

---

### Scénario C — Comment éviter cette situation à l'avenir (Règle des « 2 clés »)

1. **Un adulte référent permanent (`prof_referent`)** a toujours un compte actif sur MDL Connect : même s'il ne gère pas la caisse, il garde la continuité d'une année sur l'autre.
2. **Une fiche papier « Trousseau d'urgence MDL »** est imprimée après chaque passation, mise sous enveloppe fermée et rangée dans le **coffre du lycée** (intendance ou bureau CPE) avec :
   - Le nom de domaine et l'identifiant du compte Cloudflare / registrar.
   - L'emplacement physique du PC serveur (ou l'accès Cloudflare R2).
   - Une copie du fichier `.env` (contenant `ENCRYPTION_KEY` et `BACKUP_ENCRYPTION_KEY`).
