export interface ProjectTemplate {
  id: string;
  name: string;
  category: string;
  description: string;
  estimatedBudgetCents: number;
  defaultTasks: Array<{ title: string; daysBeforeEvent: number; status: 'todo' | 'doing' | 'done' }>;
  safetyChecklist: string[];
}

export const PROJECT_TEMPLATES: ProjectTemplate[] = [
  {
    id: 'soiree',
    name: 'Soirée du lycée',
    category: 'Événement festif',
    description: 'Organisation complète d’une soirée festive encadrée (DJ, salle, sécurité).',
    estimatedBudgetCents: 120000,
    defaultTasks: [
      { title: 'Demande d’autorisation chef d’établissement', daysBeforeEvent: 45, status: 'todo' },
      { title: 'Réservation sono / DJ et salle', daysBeforeEvent: 30, status: 'todo' },
      { title: 'Ouverture billetterie MDL Connect', daysBeforeEvent: 21, status: 'todo' },
      { title: 'Brief équipe accueil & scanner QR', daysBeforeEvent: 3, status: 'todo' }
    ],
    safetyChecklist: [
      'Autorisation écrite du proviseur',
      'Présence d’adultes référents et APS/PSC1',
      'Respect strict de la jauge incendie',
      'Zéro alcool / contrôle des sacs à l’entrée'
    ]
  },
  {
    id: 'bal',
    name: 'Bal de promo',
    category: 'Événement majeur',
    description: 'Gala de fin d’année pour les Terminales avec traiteur, photo et animation.',
    estimatedBudgetCents: 350000,
    defaultTasks: [
      { title: 'Validation lieu et devis traiteur', daysBeforeEvent: 60, status: 'todo' },
      { title: 'Assurance responsabilité civile événement', daysBeforeEvent: 35, status: 'todo' },
      { title: 'Lancement préventes adhérents', daysBeforeEvent: 28, status: 'todo' },
      { title: 'Liste d’émargement et plan de salle', daysBeforeEvent: 5, status: 'todo' }
    ],
    safetyChecklist: [
      'Convention de mise à disposition signée',
      'Service de sécurité / encadrement adulte validé',
      'Sorties de secours dégagées et signalées',
      'Numéros d’urgence affichés (15 / 18 / 112)'
    ]
  },
  {
    id: 'tournoi',
    name: 'Tournoi sportif / e-sport',
    category: 'Sport & Jeu',
    description: 'Compétition inter-classes (futsal, basket, Smash Bros, échecs).',
    estimatedBudgetCents: 30000,
    defaultTasks: [
      { title: 'Réservation gymnase ou foyer avec la vie scolaire', daysBeforeEvent: 21, status: 'todo' },
      { title: 'Ouverture des inscriptions équipes', daysBeforeEvent: 14, status: 'todo' },
      { title: 'Tirage au sort de l’arbre de tournoi', daysBeforeEvent: 2, status: 'todo' }
    ],
    safetyChecklist: [
      'Trousse de secours et référent EPS/infirmerie',
      'Câbles électriques sécurisés (si tournoi e-sport)',
      'Règlement fair-play signé par les capitaines'
    ]
  },
  {
    id: 'kermesse',
    name: 'Kermesse / Fête du lycée',
    category: 'Vie lycéenne',
    description: 'Stands jeux, buvette sans alcool, musique et animations dans la cour.',
    estimatedBudgetCents: 80000,
    defaultTasks: [
      { title: 'Plan d’implantation des stands dans la cour', daysBeforeEvent: 30, status: 'todo' },
      { title: 'Commande boissons et denrées non périssables', daysBeforeEvent: 10, status: 'todo' },
      { title: 'Planning des bénévoles par créneau d’1h', daysBeforeEvent: 5, status: 'todo' }
    ],
    safetyChecklist: [
      'Chaîne du froid respectée pour la buvette',
      'Allergènes affichés sur chaque stand alimentaire',
      'Passage pompiers maintenu libre dans la cour'
    ]
  },
  {
    id: 'caritatif',
    name: 'Action caritative',
    category: 'Solidarité',
    description: 'Collecte de fonds, dons alimentaires ou course solidaire pour une ONG.',
    estimatedBudgetCents: 20000,
    defaultTasks: [
      { title: 'Vote et validation de l’association bénéficiaire', daysBeforeEvent: 30, status: 'todo' },
      { title: 'Campagne d’affichage et sondage lycéens', daysBeforeEvent: 14, status: 'todo' },
      { title: 'Comptage contradictoire et virement officiel', daysBeforeEvent: -2, status: 'todo' }
    ],
    safetyChecklist: [
      'Reçu fiscal / attestation officielle de l’association partenaire',
      'Double signature trésorier + président pour le comptage des dons'
    ]
  },
  {
    id: 'sortie',
    name: 'Sortie culturelle / loisirs',
    category: 'Sortie',
    description: 'Musée, parc, théâtre ou sortie d’intégration encadrée.',
    estimatedBudgetCents: 90000,
    defaultTasks: [
      { title: 'Devis autocar et billets groupe', daysBeforeEvent: 40, status: 'todo' },
      { title: 'Collecte autorisations parentales mineurs', daysBeforeEvent: 14, status: 'todo' },
      { title: 'Appel et liste des participants jour J', daysBeforeEvent: 0, status: 'todo' }
    ],
    safetyChecklist: [
      'Autorisation parentale obligatoire pour tout élève mineur',
      'Taux d’encadrement réglementaire respecté',
      'Fiche sanitaire et contacts d’urgence sur place'
    ]
  },
  {
    id: 'semaine_theme',
    name: 'Semaine à thème',
    category: 'Culture & Citoyenneté',
    description: 'Semaine de l’écologie, des arts, du cinéma ou du bien-être.',
    estimatedBudgetCents: 45000,
    defaultTasks: [
      { title: 'Programme jour par jour validé avec le CVL', daysBeforeEvent: 25, status: 'todo' },
      { title: 'Invitation intervenants extérieurs', daysBeforeEvent: 15, status: 'todo' },
      { title: 'Installation signalétique et expositions', daysBeforeEvent: 1, status: 'todo' }
    ],
    safetyChecklist: [
      'Autorisation d’accès des intervenants extérieurs à l’accueil',
      'Respect des droits de diffusion (films/musique)'
    ]
  },
  {
    id: 'yearbook',
    name: 'Yearbook du lycée',
    category: 'Édition',
    description: 'Album photo souvenir des classes et clubs avec précommande.',
    estimatedBudgetCents: 220000,
    defaultTasks: [
      { title: 'Collecte consentements droit à l’image (mineurs)', daysBeforeEvent: 60, status: 'todo' },
      { title: 'Shooting photos classes et clubs', daysBeforeEvent: 35, status: 'todo' },
      { title: 'Relecture orthographique et bon à tirer imprimeur', daysBeforeEvent: 15, status: 'todo' }
    ],
    safetyChecklist: [
      'Autorisation écrite droit à l’image (parents si mineur)',
      'Zéro contenu diffamatoire ou donnée personnelle sensible'
    ]
  },
  {
    id: 'pull_promo',
    name: 'Pull de promo',
    category: 'Merchandising',
    description: 'Concours de design, essayage tailles, précommandes et distribution.',
    estimatedBudgetCents: 280000,
    defaultTasks: [
      { title: 'Sondage couleurs et vote du logo sur MDL Connect', daysBeforeEvent: 45, status: 'todo' },
      { title: 'Réception échantillons pour essayage tailles', daysBeforeEvent: 30, status: 'todo' },
      { title: 'Clôture commandes payées et envoi fournisseur', daysBeforeEvent: 20, status: 'todo' }
    ],
    safetyChecklist: [
      'Devis comparatifs (3 fournisseurs) archivés au coffre',
      'Paiement validé avant commande ferme'
    ]
  },
  {
    id: 'tombola',
    name: 'Tombola de la MDL',
    category: 'Financement',
    description: 'Vente de tickets numérotés avec lots locaux et tirage en direct.',
    estimatedBudgetCents: 15000,
    defaultTasks: [
      { title: 'Démarchage commerçants locaux pour les lots', daysBeforeEvent: 35, status: 'todo' },
      { title: 'Mise en ligne des billets numérotés', daysBeforeEvent: 21, status: 'todo' },
      { title: 'Tirage au sort public et remise des lots', daysBeforeEvent: 0, status: 'todo' }
    ],
    safetyChecklist: [
      'Règlement de tombola affiché (date tirage, liste des lots)',
      'Autorisation municipale/préfectorale vérifiée si ouverte hors lycée'
    ]
  },
  {
    id: 'jauge',
    name: 'Jauge / Équipement Foyer',
    category: 'Vie quotidienne',
    description: 'Achat matériel foyer (baby-foot, micro-ondes, canapés, jeux de société).',
    estimatedBudgetCents: 100000,
    defaultTasks: [
      { title: 'Sondage besoins des élèves au foyer', daysBeforeEvent: 20, status: 'todo' },
      { title: 'Validation du budget en réunion de bureau', daysBeforeEvent: 10, status: 'todo' },
      { title: 'Réception, inventaire et charte d’utilisation', daysBeforeEvent: 0, status: 'todo' }
    ],
    safetyChecklist: [
      'Conformité CE et sécurité électrique des appareils',
      'Inscription à l’inventaire matériel de la MDL'
    ]
  }
];
