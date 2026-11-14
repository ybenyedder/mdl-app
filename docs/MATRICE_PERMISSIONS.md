# Matrice des Permissions — MDL Connect (7 Rôles × 30 Permissions)

> Ce document explique en français simple **qui a le droit de faire quoi** dans MDL Connect.
> Cette matrice correspond exactement au code source vérifié dans `apps/web/src/lib/shared/permissions.ts`.

---

## 1. Les 7 rôles expliqués simplement

| Identifiant technique | Nom affiché | À qui on le donne au lycée ? |
|---|---|---|
| `president` | **Président / Admin** | Le ou la Président(e) élu(e) de la MDL (et éventuellement un co-admin technique). Possède **tous les droits (30/30)**. |
| `tresorier` | **Trésorier** | L'élève responsable des comptes, de la caisse, des justificatifs et de la billetterie payante (**23/30**). |
| `secretaire` | **Secrétaire** | L'élève responsable des adhérents, des convocations d'AG, des procès-verbaux et des attestations Parcoursup (**23/30**). |
| `bureau` | **Membre du bureau** | Les autres élèves élus au conseil d'administration / bureau (ex. pôle événementiel, communication) (**16/30**). |
| `prof_referent` | **Professeur référent** | L'adulte référent (CPE, professeur, vie scolaire). Rôle de **contrôle, validation sécurité et transparence**, sans écriture comptable directe (**14/30**). |
| `adherent` | **Adhérent** | Tout lycéen ayant payé sa cotisation MDL pour l'année en cours (**7/30**). |
| `invite` | **Invité** | Élève non-adhérent ou personne extérieure inscrite (accès minimal : projets publics, sondages lycée, achat de billet) (**3/30**). |

---

## 2. Tableau complet : 7 rôles × 30 permissions

**Légende :** ✅ = Autorisé | — = Non autorisé

| # | Permission (`code`) | Ce que ça autorise en pratique | Président | Trésorier | Secrétaire | Bureau | Prof référent | Adhérent | Invité |
|---:|---|---|---:|---:|---:|---:|---:|---:|---:|
| **1** | `admin:settings` | Modifier les réglages du lycée (nom, couleurs, cotisation, mode d'inscription) | ✅ | — | — | — | — | — | — |
| **2** | `admin:roles` | Changer le rôle d'un utilisateur (nommer Trésorier, Secrétaire, Bureau, etc.) | ✅ | — | — | — | — | — | — |
| **3** | `members:read` | Voir la liste des membres et adhérents | ✅ | ✅ | ✅ | ✅ | ✅ | — | — |
| **4** | `members:invite` | Créer des invitations pour rejoindre la MDL | ✅ | ✅ | ✅ | — | — | — | — |
| **5** | `members:manage` | Valider/modifier une fiche adhérent ou enregistrer une cotisation | ✅ | — | ✅ | — | — | — | — |
| **6** | `projects:read` | Consulter les projets et événements de la MDL | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **7** | `projects:create` | Créer un nouveau projet (à partir des 11 modèles) | ✅ | ✅ | ✅ | ✅ | — | — | — |
| **8** | `projects:edit` | Modifier un projet, ses tâches Kanban et sa checklist sécurité | ✅ | ✅ | ✅ | ✅ | — | — | — |
| **9** | `projects:validate` | Donner la validation officielle d'un projet (ex. autorisation sécurité) | ✅ | — | — | — | ✅ | — | — |
| **10** | `budget:read` | Consulter les comptes, graphiques SVG et justificatifs | ✅ | ✅ | ✅ | ✅ | ✅ | — | — |
| **11** | `budget:write` | Ajouter ou modifier une recette ou une dépense + ticket de caisse | ✅ | ✅ | — | — | — | — | — |
| **12** | `budget:close_year` | Clôturer l'exercice comptable annuel de la MDL | ✅ | ✅ | — | — | — | — | — |
| **13** | `ag:read` | Voir les Assemblées Générales, l'ordre du jour et les candidats | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — |
| **14** | `ag:manage` | Créer une AG, ouvrir/fermer les votes, gérer l'émargement et les candidats | ✅ | — | ✅ | — | — | — | — |
| **15** | `ag:vote` | Voter à bulletin secret lors d'une Assemblée Générale | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — |
| **16** | `ag:generate_pv` | Générer le Procès-Verbal (PV) officiel de l'AG en PDF | ✅ | — | ✅ | — | — | — | — |
| **17** | `polls:read` | Consulter les sondages et leurs résultats | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **18** | `polls:create` | Créer et publier un nouveau sondage | ✅ | ✅ | ✅ | ✅ | — | — | — |
| **19** | `polls:vote` | Voter à un sondage (selon sa portée : bureau, adhérents ou lycée) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — |
| **20** | `tickets:read_admin` | Voir la liste complète des billets vendus et les statistiques d'entrées | ✅ | ✅ | ✅ | ✅ | ✅ | — | — |
| **21** | `tickets:manage` | Créer des événements billetterie, tarifs, et valider les paiements manuels | ✅ | ✅ | — | — | — | — | — |
| **22** | `tickets:scan` | Scanner et valider les QR codes des billets à l'entrée (même hors-ligne) | ✅ | ✅ | ✅ | ✅ | — | — | — |
| **23** | `tickets:buy` | Réserver ou acheter un billet pour soi | ✅ | ✅ | ✅ | ✅ | — | ✅ | ✅ |
| **24** | `passation:read` | Consulter l'avancement de la checklist de passation annuelle | ✅ | ✅ | ✅ | ✅ | ✅ | — | — |
| **25** | `passation:manage` | Cocher et commenter les étapes de la passation annuelle | ✅ | ✅ | ✅ | — | — | — | — |
| **26** | `vault:read` | Consulter et télécharger les documents du coffre-fort chiffré | ✅ | ✅ | ✅ | ✅ | ✅ | — | — |
| **27** | `vault:write` | Déposer ou archiver des documents sensibles dans le coffre-fort | ✅ | ✅ | ✅ | — | — | — | — |
| **28** | `parcoursup:read_own` | Rédiger et exporter **son propre** bilan Parcoursup en PDF | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — |
| **29** | `parcoursup:export_all` | Exporter les bilans Parcoursup de **tous** les élèves impliqués | ✅ | — | ✅ | — | ✅ | — | — |
| **30** | `audit:read` | Lire le journal d'audit infalsifiable (chaîné SHA-256) des actions critiques | ✅ | ✅ | — | — | ✅ | — | — |

---

## 3. Règles de bon sens pour la sécurité des rôles

1. **Un seul `president` actif (ou deux maximum)** : ne donnez jamais le rôle `president` à toute la classe. Seul le Président (et éventuellement un co-président de confiance) doit pouvoir modifier les rôles (`admin:roles`).
2. **Séparation des pouvoirs** :
   - Le **Trésorier** tient les comptes (`budget:write`), mais le **Professeur référent** et le **Président** peuvent tout vérifier (`budget:read`, `audit:read`).
   - Le **Professeur référent** valide les projets à risque (`projects:validate`), mais ne modifie pas la caisse ni les PV d'AG des élèves.
3. **Principe du moindre privilège** : si un élève aide juste à organiser le tournoi ou scanner les billets à l'entrée, le rôle `bureau` lui suffit largement.
