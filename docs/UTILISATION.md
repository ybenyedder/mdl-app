# Guide d'Utilisation Quotidienne — MDL Connect

> Ce guide explique **pas à pas** comment utiliser MDL Connect selon votre rôle au lycée, sans aucun jargon informatique.
> Pour installer l'application sur votre téléphone : ouvrez l'adresse du site dans **Chrome (Android)** ou **Safari (iPhone)** puis appuyez sur **« Ajouter à l'écran d'accueil »** (ou l'icône d'installation dans la barre d'adresse).

---

## 1. Pour les Adhérents (et Invités)

### S'inscrire et activer sa carte d'adhérent
1. Ouvrez l'adresse de votre MDL (ex. `https://mdl.monlycee.fr`) et cliquez sur **Créer un compte**.
2. Renseignez votre **prénom, nom, classe, email** et choisissez un **mot de passe solide** (au moins 10 caractères).
   - *Si le lycée utilise un code d'accès* : entrez le code donné par la vie scolaire ou le bureau MDL.
   - *Si vous avez moins de 15 ans (ou si vous souhaitez informer vos parents)* : vous pouvez renseigner l'email d'un **responsable légal** dans le champ prévu.
3. Cochez la case de consentement RGPD (vos données servent uniquement à la MDL, jamais à de la publicité).
4. **Devenir adhérent** : tant que votre cotisation annuelle n'est pas réglée auprès du bureau (en espèces, chèque, virement ou carte si activée), votre compte reste au statut **Invité**. Dès que le Trésorier ou Secrétaire valide votre paiement, votre statut passe à **Adhérent** et vous débloquez les votes en AG, les tarifs réduits billetterie et le bilan Parcoursup.

### Consulter les projets et voter aux sondages
- **Projets** : voyez les prochains événements (Bal de promo, Tournoi, Pull de promo…) et le compte à rebours `J-x`.
- **Sondages** : votez sur les choix du lycée (thème du bal, couleurs du pull…). Les résultats se mettent à jour en direct sans recharger la page.

### Voter en Assemblée Générale (AG)
1. Lorsqu'une AG est ouverte (en amphithéâtre ou en ligne), rendez-vous dans **Assemblées Générales**.
2. Lisez la profession de foi de chaque candidat.
3. Cliquez sur votre choix (ou **Vote blanc**) et validez.
   - Un seul vote est possible par adhérent.
   - Une fois les résultats proclamés, votre vote est **anonymisé** : personne ne peut savoir ce que vous avez voté.

### Acheter / réserver un billet et montrer son QR code
1. Ouvrez **Billetterie**, choisissez l'événement et votre tarif (*Prévente*, *Tarif réduit adhérent* ou *Plein tarif*).
2. Choisissez votre mode de paiement :
   - **Espèces / Virement** : votre billet est créé avec le statut *En attente*. Passez payer au foyer ou auprès du Trésorier ; votre billet passe *Payé*.
   - **Carte bancaire (Stripe)** *(si activé par le lycée)* : paiement immédiat en ligne.
3. Le jour de l'événement, ouvrez votre billet sur votre téléphone (ou téléchargez le PDF à l'avance) pour présenter votre **QR code**.

### Préparer son bilan Parcoursup (Terminales / Premières engagées)
1. Allez dans **Parcoursup**.
2. Rédigez ou complétez votre résumé d'engagement associatif (les heures passées sur les projets s'additionnent automatiquement).
3. Cochez vos compétences acquises (*Gestion de projet*, *Travail en équipe*, *Trésorerie*…).
4. Cliquez sur **Télécharger le bilan PDF** pour l'utiliser dans votre rubrique *Activités et centres d'intérêt* sur Parcoursup.

---

## 2. Pour les Membres du Bureau

En plus des actions d'un Adhérent, vous organisez concrètement la vie du lycée :

### Créer et piloter un projet
1. Allez dans **Projets** -> **Nouveau projet**.
2. Choisissez parmi les **11 modèles prêts à l'emploi** :
   - *Soirée / Concert*, *Bal de promo*, *Tournoi sportif / e-sport*, *Kermesse / Fête du lycée*, *Collecte caritative*, *Sortie culturelle*, *Semaine à thème*, *Yearbook / Album photo*, *Pull / Sweat de promo*, *Tombola*, *Équipement du foyer*.
3. Chaque modèle crée automatiquement les **tâches avec échéances (`J-60`, `J-30`…)** et la **checklist sécurité** (assurance, autorisation chef d'établissement, droits à l'image…).
4. Déplacez les tâches sur le tableau **Kanban** (*À faire* -> *En cours* -> *Terminé*) et notez les heures de bénévolat des participants (utiles pour Parcoursup !).

### Lancer un sondage
1. Allez dans **Sondages** -> **Créer un sondage**.
2. Choisissez la portée : **Bureau uniquement**, **Adhérents** ou **Tout le lycée**.
3. Ajoutez les choix de réponse et la date de clôture. Les résultats s'affichent en direct.

### Scanner les billets à l'entrée (même sans Internet !)
1. Sur votre smartphone, connectez-vous avant la soirée et ouvrez **Billetterie -> Scanner QR** (la page reste disponible même hors-ligne grâce à la PWA).
2. Autorisez l'appareil photo.
3. Pointez vers le QR code de l'élève :
   - **Vert** : billet authentique (signature Ed25519 vérifiée localement sur le téléphone) et payé -> laissez entrer !
   - **Orange / Rouge** : billet déjà scanné, annulé, falsifié ou paiement encore en attente.

---

## 3. Pour le Trésorier

Vous êtes garant(e) de la transparence financière de la MDL :

1. **Saisir une recette ou une dépense** :
   - Allez dans **Budget** -> **Nouvelle écriture**.
   - Indiquez le type (*Recette* ou *Dépense*), la catégorie (*Subventions*, *Adhésions*, *Billetterie*, *Prestations*, *Équipement Foyer*, *Communication*…), le libellé exact, le montant et le projet associé.
   - **Prenez en photo le ticket de caisse ou la facture** : l'application compresse automatiquement la photo sur votre téléphone (via Rust/WASM) avant de la chiffrer sur le serveur.
2. **Suivre les graphiques et exporter pour le bilan** :
   - Visualisez la répartition recettes/dépenses et le solde net en temps réel.
   - Cliquez sur **Exporter CSV** (format compatible **Excel français** avec séparateur `;` et accents UTF-8) ou **Exporter PDF**.
3. **Valider les paiements de billetterie et cotisations** :
   - Dans **Billetterie**, passez les billets payés en espèces ou par virement de *En attente* à *Payé*.
4. **Déposer les pièces bancaires** :
   - Rangez les relevés bancaires mensuels et le RIB dans le **Coffre-fort**.
5. **Clôturer l'exercice comptable** :
   - En fin d'année scolaire (avant la passation), vérifiez chaque écriture avec le Professeur référent et cliquez sur **Clôturer l'exercice**.
6. **Contrôler le journal d'audit** :
   - Consultez **Audit** pour vérifier l'historique infalsifiable des opérations sensibles.

---

## 4. Pour le Secrétaire

Vous êtes responsable des membres, des Assemblées Générales et des archives :

1. **Gérer les adhérents et invitations** :
   - Dans **Membres**, suivez la liste des inscrits, validez les cotisations reçues et créez des invitations si le mode *Sur invitation* est actif.
2. **Organiser une Assemblée Générale (AG) de A à Z** :
   - Allez dans **Assemblées Générales** -> **Nouvelle AG** (date, lieu, quorum requis).
   - Enregistrez ou validez les **candidatures** (avec leur profession de foi).
   - Le jour J, cochez les **émargements** des présents pour vérifier le quorum.
   - Cliquez sur **Ouvrir le vote**, laissez les adhérents voter (sur leur téléphone ou à l'isoloir), puis cliquez sur **Clôturer & Proclamer les résultats**.
   - Cliquez sur **Générer le PV officiel (PDF)** : le document prêt à imprimer et à envoyer en préfecture est créé instantanément, avec mention de l'anonymisation des bulletins.
3. **Tenir le Coffre-fort et la Passation** :
   - Déposez les statuts loi 1901, le récépissé de préfecture et les PV d'AG signés dans le **Coffre-fort**.
   - Coordonnez la checklist de **Passation** en fin d'année.
4. **Exporter les bilans Parcoursup** :
   - Depuis **Parcoursup**, vous pouvez exporter les attestations de l'ensemble des élèves investis dans la MDL.

---

## 5. Pour le Président (Admin)

Vous pilotez l'équipe et disposez de tous les droits (30/30) :

1. **Au démarrage de l'année** :
   - Configurez le nom du lycée, les couleurs, le montant de la cotisation et le mode d'inscription dans **Administration**.
   - Attribuez les rôles (`tresorier`, `secretaire`, `bureau`, `prof_referent`) et activez votre **double authentification (2FA)** dans votre profil.
2. **Au quotidien** :
   - Coordonnez les projets avec le bureau, co-validez les grosses dépenses et les projets importants.
   - Signez les conventions et PV d'AG avec le Secrétaire.
3. **En fin d'année** :
   - Pilotez la **passation complète** selon [PASSATION.md](PASSATION.md) et transférez les accès au nouveau bureau élu.

---

## 6. Pour le Professeur référent / CPE

Votre rôle est un **rôle de confiance, de conseil et de contrôle institutionnel** (sans avoir à saisir la caisse ni gérer le quotidien des élèves) :

1. **Valider les projets et la sécurité** :
   - Ouvrez les projets en préparation, vérifiez que la **checklist sécurité** est complète (assurance, encadrement, autorisation du chef d'établissement, autorisations parentales pour les mineurs) puis cliquez sur **Valider le projet**.
2. **Superviser la transparence financière et réglementaire** :
   - Consultez à tout moment le **Budget**, les justificatifs, le **Coffre-fort** (statuts, assurance, récépissé) et le **Journal d'audit**.
3. **Accompagner Parcoursup et la passation** :
   - Consultez et exportez les bilans **Parcoursup** des élèves engagés pour appuyer la fiche Avenir / avis du conseil de classe.
   - Suivez la checklist de **Passation** en juin pour éviter toute perte d'accès d'une année sur l'autre (voir la procédure de secours dans [PASSATION.md](PASSATION.md)).
