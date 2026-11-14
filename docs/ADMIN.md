# Guide d'Administration — MDL Connect

> Ce guide est destiné au **Président / Admin** et à la personne (élève ou professeur référent) qui gère l'hébergement du serveur. Toutes les commandes ci-dessous sont prêtes à copier-coller.

---

## 1. Paramétrage du lycée (dans l'interface web)

Connectez-vous avec un compte ayant le rôle **`president`**, puis ouvrez la page **Administration** :

| Paramètre | Description simple | Exemple |
|---|---|---|
| **Nom de l'établissement** | Affiché dans l'en-tête, les bilans Parcoursup et les PV d'AG | `Lycée Polyvalent Jean Moulin` |
| **Nom de la MDL** | Nom de votre association | `MDL Jean Moulin` |
| **Couleurs & Logo** | Couleur principale, couleur d'accent et logo du mini-site public | `#1d4ed8` / `#f59e0b` |
| **Montant de la cotisation** | Tarif annuel d'adhésion (stocké en centimes : `1000` = 10,00 €) | `10,00 €` |
| **Année scolaire active** | Exercice comptable et de passation en cours | `2026-2027` |
| **Représentant légal** | Nom du chef d'établissement (mentionné sur les documents officiels) | `Mme Claire Moreau (Proviseure)` |
| **Mode d'inscription** | Qui peut créer un compte (voir détail ci-dessous) | `school_code` (recommandé) |

### Choisir le mode d'inscription (`registrationMode`)
- **`open` (Ouvert)** : n'importe quel élève avec l'adresse du site peut créer un compte *Invité*. Pratique pour tester, moins recommandé si l'adresse circule hors du lycée.
- **`school_code` (Code lycée — recommandé)** : tout élève du lycée peut s'inscrire en saisissant un **code secret d'établissement** (ex. affiché au foyer ou donné à la rentrée sur l'ENT).
- **`invite_only` (Sur invitation uniquement)** : seul un membre autorisé (`president`, `tresorier` ou `secretaire`) peut créer un lien d'invitation personnel.

---

## 2. Gestion des rôles et sécurité des comptes

Dans **Administration -> Rôles & Membres** (permission `admin:roles`, réservée au `president`) :

1. Sélectionnez l'utilisateur inscrit et attribuez-lui son rôle (`tresorier`, `secretaire`, `bureau`, `prof_referent`, `adherent` ou `invite`).
2. Vous pouvez aussi ajouter un **titre personnalisé** affiché sur sa fiche (ex. *Responsable événementiel*, *CPE & Référente MDL*).
3. **Règle d'or :** ne retirez jamais le rôle `president` au dernier administrateur actif avant d'avoir promu son successeur !
4. **Activez impérativement le 2FA (TOTP)** sur les comptes **Président**, **Trésorier** et **Secrétaire** depuis la page **Profil / Sécurité** (avec une application gratuite comme *Aegis*, *FreeOTP* ou *Google Authenticator*).

*(Pour le détail complet des droits de chaque rôle, consultez [MATRICE_PERMISSIONS.md](MATRICE_PERMISSIONS.md).)*

---

## 3. Configuration des emails SMTP avec Brevo (gratuit, 300 mails/jour)

> **Bon à savoir :** MDL Connect fonctionne **à 100 % même sans SMTP** (les billets QR et PV PDF sont téléchargeables directement dans l'application). Activer Brevo permet en plus d'envoyer les convocations AG, billets et liens par email automatiquement.

1. Créez un compte gratuit sur [https://www.brevo.com](https://www.brevo.com) (offre Gratuite : **300 emails/jour**, sans carte bancaire).
2. Allez dans votre profil Brevo (en haut à droite) -> **SMTP & API** -> onglet **SMTP**.
3. Notez votre **Serveur SMTP**, **Port**, **Identifiant** et générez une **Clé SMTP** (mot de passe).
4. Ouvrez le fichier `.env` sur la machine qui héberge MDL Connect et remplissez ces 5 lignes :

```env
SMTP_HOST=smtp-relay.brevo.com
SMTP_PORT=587
SMTP_USER=votre-identifiant-brevo@smtp-brevo.com
SMTP_PASS=xsmtpsib-VOTRE_CLE_SMTP_BREVO
SMTP_FROM=MDL Connect <mdl@monlycee.fr>
```

5. Redémarrez l'application pour prendre en compte les changements :

```bash
docker compose up -d app
```

> **Conseil :** Dans Brevo -> *Expéditeurs et domaines*, vérifiez l'adresse email d'expéditeur (`mdl@monlycee.fr` ou l'adresse Gmail/Outlook de la MDL) pour éviter que les messages arrivent dans les spams.

---

## 4. Configuration Stripe (optionnelle — paiement par carte bancaire)

Par défaut, **Stripe est désactivé** : les élèves paient en **espèces, chèque ou virement** (0 € de frais bancaires).

Si votre MDL dispose déjà d'un compte associatif vérifié sur [https://dashboard.stripe.com](https://dashboard.stripe.com) et souhaite proposer le paiement en ligne par CB :

1. Dans le tableau de bord Stripe -> **Développeurs -> Clés API**, copiez la **Clé secrète** (`sk_live_...` pour la production, ou `sk_test_...` pour tester).
2. Dans **Développeurs -> Webhooks**, créez un endpoint pointant vers `https://votre-domaine.fr/api/webhooks/stripe` et copiez le **Secret de signature** (`whsec_...`).
3. Renseignez ces deux variables dans `.env` :

```env
STRIPE_SECRET_KEY=sk_live_VOTRE_CLE_SECRETE
STRIPE_WEBHOOK_SECRET=whsec_VOTRE_SECRET_WEBHOOK
```

4. Redémarrez le conteneur :

```bash
docker compose up -d app
```

Pour revenir au mode **100 % gratuit (espèces & virement uniquement)**, videz simplement ces deux lignes dans `.env` et redémarrez `docker compose up -d app`.

---

## 5. Clés VAPID Web Push (notifications sur téléphone)

Les notifications push permettent d'alerter les adhérents quand un vote d'AG ou un sondage s'ouvre, sans installer d'application depuis le Play Store / App Store.

Lors de l'installation via `bash scripts/install.sh`, **les clés VAPID sont générées automatiquement** si Node.js est présent sur le PC.

Si les lignes `VAPID_PUBLIC_KEY` et `VAPID_PRIVATE_KEY` sont encore vides dans votre `.env`, générez-les en une seule commande directement via le conteneur Docker :

```bash
docker compose exec app node -e '
const c = require("crypto");
const { publicKey, privateKey } = c.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const pub = publicKey.export({ format: "jwk" });
const priv = privateKey.export({ format: "jwk" });
const rawPub = Buffer.concat([Buffer.from([0x04]), Buffer.from(pub.x, "base64url"), Buffer.from(pub.y, "base64url")]).toString("base64url");
console.log("VAPID_PUBLIC_KEY=" + rawPub);
console.log("VAPID_PRIVATE_KEY=" + priv.d);
'
```

Copiez les deux lignes affichées dans votre `.env`, vérifiez que `VAPID_SUBJECT=mailto:mdl@monlycee.fr` contient votre vrai email de contact, puis redémarrez :

```bash
docker compose up -d app
```

---

## 6. Mises à jour et Rollback (retour en arrière sans risque)

### Mise à jour automatique sécurisée (recommandé)

Exécutez simplement :

```bash
bash scripts/update.sh
```

Ce script effectue dans l'ordre :
1. Une **sauvegarde chiffrée préventive** de PostgreSQL 17 (`scripts/backup.sh`).
2. Le téléchargement de la nouvelle version (`git pull --ff-only`).
3. La reconstruction de l'image Docker (`docker compose build`).
4. Le redémarrage (`docker compose up -d`).
5. Un test automatique de `/api/health` pendant 60 secondes.
6. **Rollback automatique** : si la construction échoue ou que `/api/health` ne répond pas, le script revient automatiquement à la version précédente et restaure la base de données !

### Rollback manuel (si vous repérez un problème plus tard)

Si la mise à jour a démarré mais que vous voulez revenir à une version précédente précise :

```bash
# 1. Voir les dernières versions (notez l'identifiant du commit voulu, ex: a1b2c3d)
git log --oneline -n 5

# 2. Revenir à cette version du code
git reset --hard a1b2c3d

# 3. Reconstruire l'application
docker compose build app

# 4. (Optionnel) Si la mise à jour avait modifié la base de données, restaurer la sauvegarde d'avant :
docker compose stop app
bash scripts/restore.sh --latest --yes

# 5. Tout redémarrer
docker compose up -d
```

---

## 7. Surveillance & Diagnostic rapide

- **Tableau de bord Uptime Kuma** : ouvrez `http://localhost:3001` sur le PC serveur et ajoutez un moniteur HTTP vers `http://app:3000/api/health` (intervalle 60 s) pour être alerté si le site tombe.
- **Vérifier l'état de tous les services** :
  ```bash
  docker compose ps
  ```
- **Lire les journaux en cas d'erreur** :
  ```bash
  docker compose logs --tail=100 app
  docker compose logs --tail=100 postgres
  ```
