# Guide de Déploiement Auto-Hébergé — MDL Connect (Spécial Débutant)

> Ce guide explique **pas à pas** comment installer, sauvegarder et restaurer **MDL Connect** (avec sa base de données **PostgreSQL 17**) sur n'importe quel ordinateur (Windows 11, Mac ou Linux), avec des **commandes exactes à copier-coller**. Aucune expérience de développeur n'est nécessaire.

---

## 1. Quel matériel faut-il ?

Un simple ordinateur ou mini-PC laissé allumé (ex. vieux PC portable dans un placard sécurisé, Raspberry Pi 4/5 4 Go, mini-PC N100 à 120 €, ou PC d'un membre du bureau pour tester) :
- **Mémoire (RAM)** : 2 Go minimum (4 Go recommandés pour PostgreSQL 17 + l'application).
- **Disque** : 10 Go d'espace libre.
- **Connexion** : Wi-Fi ou câble Ethernet (câble recommandé).

---

## 2. Installer Docker selon votre ordinateur

### Option A — Windows 11 (avec WSL2)

1. Ouvrez **PowerShell** en administrateur (clic droit sur le bouton Démarrer -> *Terminal (Admin)*) et tapez :
   ```powershell
   wsl --install
   ```
   Redémarrez l'ordinateur si Windows vous le demande. Au redémarrage, une fenêtre Ubuntu s'ouvre pour choisir un nom d'utilisateur et un mot de passe (notez-les).
2. Installez **Docker Desktop pour Windows** depuis [https://www.docker.com/products/docker-desktop/](https://www.docker.com/products/docker-desktop/).
3. Ouvrez **Docker Desktop** -> roue dentée **Settings** -> **Resources** -> **WSL Integration** -> cochez **Ubuntu** -> cliquez sur **Apply & restart**.
4. Ouvrez le menu Démarrer -> tapez **Ubuntu** -> c'est dans ce terminal noir que vous collerez toutes les commandes ci-dessous.

### Option B — macOS (Mac Intel ou Apple Silicon M1/M2/M3/M4)

1. Téléchargez et installez **Docker Desktop for Mac** depuis [https://www.docker.com/products/docker-desktop/](https://www.docker.com/products/docker-desktop/).
2. Lancez **Docker Desktop** depuis Applications (attendez que la petite baleine en haut de l'écran arrête de bouger).
3. Ouvrez l'application **Terminal** (`Cmd + Espace`, tapez `Terminal`).

### Option C — Linux (Ubuntu / Debian)

Ouvrez un terminal et copiez-collez :

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker "$USER"
```

Déconnectez-vous puis reconnectez-vous pour que les permissions Docker s'appliquent.

---

## 3. Installer et démarrer MDL Connect (5 minutes)

Dans votre terminal (Ubuntu sous Windows, Terminal sur Mac/Linux), placez-vous dans le dossier du projet `mdl-app` puis lancez l'installateur guidé :

```bash
cd ~/Projets/mdl-app
bash scripts/install.sh
```

L'installateur s'occupe de tout automatiquement :
1. Vérifie que Docker fonctionne.
2. Crée les dossiers `data/postgres/`, `data/uploads/`, `backups/` et `uptime-kuma/`.
3. Génère de vraies clés cryptographiques aléatoires dans `.env` (`POSTGRES_PASSWORD`, `DATABASE_URL`, `SESSION_SECRET`, `ENCRYPTION_KEY`, `TICKET_ED25519_PRIVATE_KEY_HEX`, `BACKUP_ENCRYPTION_KEY`, etc.).
4. Vous pose 4 questions simples (nom du lycée, URL, email Président, token Cloudflare optionnel).
5. Construit l'application (Rust/WASM + SvelteKit) et démarre PostgreSQL 17 ainsi que tous les services.

À la fin, il affiche :
- L'adresse locale : `http://localhost:3000`
- L'adresse de surveillance Uptime Kuma : `http://localhost:3001`
- L'email et le mot de passe du compte **Président** initial (à changer dès la première connexion !).
- Votre clé **`BACKUP_ENCRYPTION_KEY`** : **recopiez-la sur papier ou dans un coffre-fort de mots de passe**, car sans cette clé personne ne peut déchiffrer vos sauvegardes !

> Pour publier le site sur Internet en HTTPS gratuitement sans ouvrir la box : suivez ensuite [infra/cloudflared-waf-checklist.md](../infra/cloudflared-waf-checklist.md).

---

## 4. Sauvegardes automatiques chiffrées + Cloudflare R2 (10 Go gratuits)

Chaque nuit à **03h00 (heure de Paris)**, le conteneur `mdl-backup` :
1. Effectue un export complet cohérent à chaud de la base PostgreSQL 17 (`pg_dump -Fc`) et copie les justificatifs (`data/uploads/`).
2. Vérifie que le dump PostgreSQL est lisible (`pg_restore -l`).
3. Chiffre le tout en **AES-256-PBKDF2** (`.tar.gz.enc`) avec une empreinte `.sha256`.
4. Garde les **14 dernières sauvegardes** dans le dossier `./backups/`.
5. Envoie automatiquement la copie chiffrée sur **Cloudflare R2** si vous l'avez configuré.

### Configurer Cloudflare R2 (recommandé en cas d'incendie/vol du PC)

1. Connectez-vous à [https://dash.cloudflare.com](https://dash.cloudflare.com) -> **R2 Object Storage**.
2. Cliquez sur **Create bucket**, nommez-le `mdl-backups`, région `EEUR` (Europe) -> **Create bucket**.
3. Retournez sur **R2** -> **Manage R2 API Tokens** -> **Create API token** :
   - Permissions : **Object Read & Write**
   - Specify bucket(s) : **Apply to specific buckets only** -> `mdl-backups`
   - Cliquez sur **Create API Token**.
4. Notez l'**Access Key ID**, le **Secret Access Key** et le **Jurisdiction-specific / S3 Endpoint** (ex. `https://123456789abcdef.r2.cloudflarestorage.com`).
5. Ajoutez ces valeurs dans votre fichier `.env` :
   ```env
   R2_BUCKET=mdl-backups
   R2_ENDPOINT=https://VOTRE_COMPTE_ID.r2.cloudflarestorage.com
   R2_ACCESS_KEY_ID=VOTRE_ACCESS_KEY
   R2_SECRET_ACCESS_KEY=VOTRE_SECRET_KEY
   R2_PREFIX=mdl-backups
   ```
6. Redémarrez le service de sauvegarde et testez immédiatement :
   ```bash
   docker compose up -d backup
   bash scripts/backup.sh
   ```

---

## 5. Procédure « Serveur en feu » : Restaurer en 30 minutes

Si l'ordinateur qui hébergeait MDL Connect tombe en panne, est volé ou effacé par erreur, voici comment tout remettre en ligne sur un nouvel ordinateur en moins de 30 minutes :

| Étape | Action | Temps estimé |
|---|---|---|
| **1** | Installer Docker sur le nouvel ordinateur (voir Section 2) | 10 min |
| **2** | Récupérer le code : `git clone <url-du-depot> mdl-app && cd mdl-app` | 1 min |
| **3** | Récupérer le dernier fichier `mdl-backup-*.tar.gz.enc` (et son `.sha256`) depuis **Cloudflare R2** (ou clé USB) et le placer dans `./backups/` | 3 min |
| **4** | Recréer `.env` (ou copier votre ancien `.env` sauvegardé) avec votre **`POSTGRES_PASSWORD`**, **`BACKUP_ENCRYPTION_KEY`**, `ENCRYPTION_KEY` et `TICKET_ED25519_PRIVATE_KEY_HEX` | 2 min |
| **5** | Démarrer PostgreSQL 17 et l'application : `docker compose up -d --build` | 8 min |
| **6** | Restaurer la base et les justificatifs (utilise `pg_restore` dans PostgreSQL 17) : `bash scripts/restore.sh --latest` | 2 min |
| **7** | Vérifier sur `https://votre-domaine.fr/api/health` et connecter un compte | 2 min |

> **Règle d'or :** Faites un exercice de restauration **1 fois par trimestre** (par exemple avant l'Assemblée Générale ou la passation de juin) pour être 100 % certains que vos sauvegardes fonctionnent.

---

## 6. Mettre à jour MDL Connect sans risque

Pour installer une nouvelle version de MDL Connect :

```bash
bash scripts/update.sh
```

Ce script fait automatiquement :
1. Une sauvegarde chiffrée préventive de PostgreSQL 17 (`pg_dump -Fc`) avant de toucher quoi que ce soit.
2. `git pull --ff-only` pour récupérer la mise à jour.
3. Reconstruction et redémarrage Docker.
4. Test automatique de `/api/health` pendant 60 secondes.
5. **Rollback automatique** : si la mise à jour plante, il revient tout seul à la version précédente et restaure la base PostgreSQL 17 !

---

## 7. Commandes utiles du quotidien

| Besoin | Commande à copier-coller |
|---|---|
| Voir si tout tourne bien | `docker compose ps` |
| Voir les journaux de l'application | `docker compose logs -f app` |
| Voir les journaux de PostgreSQL 17 | `docker compose logs -f postgres` |
| Faire une sauvegarde immédiate | `bash scripts/backup.sh` |
| Restaurer une sauvegarde | `bash scripts/restore.sh` |
| Redémarrer l'application | `docker compose restart app` |
| Tout arrêter proprement | `docker compose down` |
