# Checklist Cloudflare Tunnel, DNS, TLS Strict & WAF Gratuit — MDL Connect

> **À qui s'adresse ce guide ?** Aux lycéens du bureau MDL et au professeur référent, même sans aucune connaissance en réseau ou informatique.
>
> **Vocabulaire simple (zéro jargon caché) :**
> - **Cloudflare Tunnel (`cloudflared`)** : un câble virtuel sécurisé entre l'ordinateur de la MDL (à la maison ou au lycée) et Internet. Avantage géant : **vous n'avez rien à ouvrir sur la box internet** et personne ne peut voir votre adresse IP personnelle.
> - **DNS** : l'annuaire qui relie votre adresse web (ex. `mdl.monlycee.fr`) à votre Tunnel Cloudflare.
> - **TLS Strict (HTTPS)** : le cadenas vert dans le navigateur qui chiffre tous les mots de passe, votes et données des élèves de bout en bout.
> - **WAF (Web Application Firewall)** : un vigile automatique devant votre site qui bloque les robots pirates et les tentatives de piratage de mots de passe ou de bourrage d'urnes.

---

## Prérequis (100 % gratuit côté Cloudflare)

1. Un **nom de domaine** (ex. `mdl-jeanmoulin.fr`, environ 8 €/an chez OVH/Cloudflare Registrar, ou un sous-domaine géré sur Cloudflare).
2. Un compte **Cloudflare gratuit** avec ce domaine ajouté dessus.
3. MDL Connect déjà démarré en local (via `bash scripts/install.sh`).

---

## Étape 1 — Créer le Tunnel dans Cloudflare Zero Trust

1. Connectez-vous sur [https://dash.cloudflare.com](https://dash.cloudflare.com).
2. Dans le menu de gauche, cliquez sur **Zero Trust**.

```text
+---------------------------------------------------------------+
| Cloudflare Dashboard                                          |
|---------------------------------------------------------------|
| [Accueil]                                                     |
| [Sites Web]                                                   |
| [Zero Trust]  <-- 1. Cliquez ici                              |
|                                                               |
| Dans Zero Trust :                                             |
|  > Gateway                                                    |
|  > Access                                                     |
|  > Networks                                                   |
|      > Tunnels  <-- 2. Puis cliquez sur "Tunnels"             |
+---------------------------------------------------------------+
```

3. Cliquez sur **Create a tunnel** (bouton bleu).
4. Choisissez le connecteur **Cloudflared** (et non WARP Connector) puis cliquez sur **Next**.
5. Donnez un nom simple au tunnel, par exemple : `mdl-connect-prod`, puis cliquez sur **Save tunnel**.

```text
+---------------------------------------------------------------+
| Choose your environment                                       |
|  [ Debian ]  [ Ubuntu ]  [ Docker ] <-- Cliquez sur Docker    |
|                                                               |
| Copy and run command:                                         |
|  docker run cloudflare/cloudflared:latest tunnel              |
|    --no-autoupdate run --token eyJhIjoiN...VOTRE_TOKEN_ICI... |
|                                ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^ |
|        Copiez UNIQUEMENT la longue suite après "--token "     |
+---------------------------------------------------------------+
```

6. **Copiez le token** (la très longue chaîne de lettres/chiffres après `--token `, commençant souvent par `eyJ...`). Ne fermez pas encore la page, cliquez sur **Next**.

---

## Étape 2 — Relier le nom de domaine au conteneur `app:3000`

Sur l'écran suivant (**Route tunnel / Public Hostname**), remplissez exactement ces champs :

```text
+---------------------------------------------------------------+
| Public Hostname                                               |
|---------------------------------------------------------------|
| Subdomain : [ mdl            ]   Domain : [ monlycee.fr v ]   |
| Path      : (laisser vide)                                    |
|                                                               |
| Service :                                                     |
| Type : [ HTTP v ]   URL : [ app:3000                       ]  |
|                                                               |
| [ Save tunnel ]  <-- Cliquez ici                              |
+---------------------------------------------------------------+
```

> **Pourquoi `app:3000` et pas `localhost:3000` ?**
> Parce que `cloudflared` tourne dans Docker à côté du service nommé `app` (dans `docker-compose.yml`). Sur le réseau interne Docker, ils se parlent directement via le nom `app:3000`.
> **Ne mettez PAS HTTPS ici** : la connexion entre Cloudflare et Internet est en HTTPS, puis le tunnel chiffré transporte le trafic jusqu'à `app:3000` en interne.

---

## Étape 3 — Activer le tunnel dans MDL Connect

Sur la machine qui héberge MDL Connect, ouvrez le fichier `.env` et mettez à jour ces 3 lignes :

```env
PUBLIC_APP_URL=https://mdl.monlycee.fr
COMPOSE_PROFILES=tunnel
CLOUDFLARE_TUNNEL_TOKEN=COLLER_VOTRE_TRES_LONG_TOKEN_ICI
```

Puis relancez la stack avec cette commande copier-coller :

```bash
docker compose up -d
```

Vérifiez que le tunnel est connecté (**Status: HEALTHY** dans Cloudflare Zero Trust -> Networks -> Tunnels) :

```bash
docker compose logs --tail=20 cloudflared
```

Vous devez voir des lignes contenant `Registered tunnel connection`.

---

## Étape 4 — Vérifier le DNS et forcer le TLS Strict (HTTPS)

Retournez dans le tableau de bord Cloudflare principal (**Websites** -> cliquez sur votre domaine `monlycee.fr`) :

### 4.1 Vérification DNS
Allez dans **DNS** -> **Records**.
Cloudflare a créé automatiquement une ligne :
- **Type** : `CNAME`
- **Name** : `mdl`
- **Target** : `<identifiant-tunnel>.cfargotunnel.com`
- **Proxy status** : **Proxied** (nuage orange allumé — OBLIGATOIRE pour que le WAF et le HTTPS fonctionnent).

### 4.2 Réglages SSL / TLS Strict
Allez dans **SSL/TLS** :

```text
+---------------------------------------------------------------+
| SSL/TLS -> Overview                                           |
|  Mode de chiffrement :                                        |
|   ( ) Off                                                     |
|   ( ) Flexible       <-- INTERDIT (non sécurisé)              |
|   ( ) Full                                                    |
|   (*) Full (strict)  <-- COCHEZ CELUI-CI                      |
+---------------------------------------------------------------+
```

Puis allez dans **SSL/TLS** -> **Edge Certificates** :
- **Always Use HTTPS** : **Activé (ON)** — redirige automatiquement `http://` vers `https://`.
- **Minimum TLS Version** : **TLS 1.2** (ou **TLS 1.3**).
- **Automatic HTTPS Rewrites** : **Activé (ON)**.

---

## Étape 5 — Règles WAF gratuites (Anti-piratage & Anti-spam)

Le plan gratuit Cloudflare inclut **1 règle de Rate Limiting** (limitation de vitesse) et **5 règles Custom WAF**. Voici comment les configurer en 3 minutes.

### 5.1 Règle de Rate Limiting (protection connexion & votes)

Menu : **Security** -> **WAF** -> onglet **Rate limiting rules** -> **Create rule**.

- **Rule name** : `MDL Protection Auth et Votes`
- Cliquez sur **Edit expression** (en bas du constructeur) et collez exactement :
  ```text
  (http.request.uri.path starts_with "/api/auth/") or (http.request.uri.path contains "/vote")
  ```
- **Characteristics** : `IP` (par adresse IP)
- **Requests** : `15`
- **Period** : `10 seconds`
- **Action** : `Block` (pendant `10 seconds`) ou `Managed Challenge`
- Cliquez sur **Deploy**.

> **Pourquoi cette règle ?** Elle empêche un robot d'essayer 1 000 mots de passe par minute sur `/api/auth/login` ou de spammer l'urne d'une Assemblée Générale (`/api/assemblies/.../vote`).

### 5.2 Règle WAF Custom #1 — Bloquer les robots sans navigateur sur l'API

Menu : **Security** -> **WAF** -> onglet **Custom rules** -> **Create rule**.

- **Rule name** : `MDL Bloquer User-Agent vide sur API`
- **Edit expression** :
  ```text
  (http.request.uri.path starts_with "/api/") and (http.user_agent eq "")
  ```
- **Action** : `Block`
- Cliquez sur **Deploy**.

### 5.3 Règle WAF Custom #2 — Challenge hors de France (Optionnel)

Si tous vos lycéens se connectent depuis la France, vous pouvez demander une vérification anti-robot aux connexions venant de l'étranger :

- **Rule name** : `MDL Challenge hors France`
- **Edit expression** :
  ```text
  (ip.geoip.country ne "FR") and (not http.request.uri.path eq "/api/health")
  ```
- **Action** : **Managed Challenge** (NE METTEZ PAS `Block`, comme ça un élève en voyage scolaire pourra simplement cocher la case Cloudflare pour accéder au site, tout en bloquant 99 % des robots étrangers !).
- Note : l'exception `/api/health` permet à Uptime Kuma ou aux sondes externes de vérifier si le site est en ligne sans être bloqués.
- Cliquez sur **Deploy**.

---

## Étape 6 — Configurer Uptime Kuma (alerte si le site tombe)

1. Ouvrez `http://localhost:3001` depuis la machine hébergeant MDL Connect (ou exposez-le uniquement via Cloudflare Access si besoin, **ne le rendez jamais public sans mot de passe**).
2. Créez votre compte administrateur Uptime Kuma.
3. Cliquez sur **+ Add New Monitor** :
   - **Monitor Type** : `HTTP(s)`
   - **Friendly Name** : `MDL Connect`
   - **URL** : `http://app:3000/api/health` (pour surveillance interne Docker) **et/ou** `https://mdl.monlycee.fr/api/health` (pour tester aussi Cloudflare !).
   - **Heartbeat Interval** : `60` secondes.
   - **Notification** : ajoutez un Webhook Discord (salon `#tech-mdl` du bureau) ou votre email.

---

## Étape 7 — Checklist finale avant ouverture aux élèves

- [ ] `https://mdl.monlycee.fr` affiche bien le cadenas HTTPS (aucun avertissement navigateur).
- [ ] `http://mdl.monlycee.fr` redirige automatiquement vers `https://...`.
- [ ] `https://mdl.monlycee.fr/api/health` renvoie HTTP `200` (`{"status":"ok"...}`).
- [ ] Connexion au compte Président fonctionne et le mot de passe initial a été changé.
- [ ] La variable `PUBLIC_APP_URL` dans `.env` est bien `https://mdl.monlycee.fr` (sans `/` à la fin).
- [ ] Les 2 règles WAF (Rate Limit + User-Agent) sont **Active** dans Cloudflare.
- [ ] Le fichier `.env` et la clé `BACKUP_ENCRYPTION_KEY` sont sauvegardés hors du serveur (coffre-fort papier / gestionnaire de mots de passe du bureau MDL).

### Dépannage rapide

| Symptôme | Cause fréquente | Solution immédiate |
|---|---|---|
| Erreur **502 Bad Gateway** | Le conteneur `app` est arrêté ou pas encore prêt | `docker compose ps` puis `docker compose logs -f app` |
| Erreur **CSRF / Cross-site POST form submissions are forbidden** | `PUBLIC_APP_URL` dans `.env` ne correspond pas au domaine `https://...` | Mettre `PUBLIC_APP_URL=https://mdl.monlycee.fr` dans `.env` puis `docker compose up -d --force-recreate app` |
| Le tunnel affiche **DOWN** dans Cloudflare | Token erroné ou `COMPOSE_PROFILES` vide | Vérifier `.env` (`COMPOSE_PROFILES=tunnel`) et lancer `docker compose up -d` |
