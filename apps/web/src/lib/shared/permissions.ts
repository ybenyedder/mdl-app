export const ROLES = [
  'president',
  'tresorier',
  'secretaire',
  'bureau',
  'prof_referent',
  'adherent',
  'invite'
] as const;

export type SystemRole = (typeof ROLES)[number];
export type Role = SystemRole | (string & {});

export const ROLE_LABELS: Record<SystemRole, string> = {
  president: 'Président / Admin',
  tresorier: 'Trésorier',
  secretaire: 'Secrétaire',
  bureau: 'Membre du bureau',
  prof_referent: 'Professeur référent',
  adherent: 'Adhérent',
  invite: 'Invité'
};

export const ROLE_DESCRIPTIONS: Record<SystemRole, string> = {
  president: 'Administration complète du lycée, rôles, paramètres, budget et audit.',
  tresorier: 'Gestion financière, budget, billetterie, clôture d’exercice et coffre.',
  secretaire: 'Gestion des membres, assemblées générales, PV, dossiers Parcoursup et coffre.',
  bureau: 'Animation quotidienne : projets, sondages, scan des billets et consultation bureau.',
  prof_referent: 'Validation pédagogique des projets, suivi budgétaire et consultation audit.',
  adherent: 'Élève cotisant : votes AG, sondages adhérents, projets et billetterie.',
  invite: 'Élève non-cotisant : consultation publique, sondages lycée et achat de billets.'
};

export const PERMISSIONS = [
  'admin:settings',
  'admin:roles',
  'members:read',
  'members:invite',
  'members:manage',
  'projects:read',
  'projects:create',
  'projects:edit',
  'projects:validate',
  'budget:read',
  'budget:write',
  'budget:close_year',
  'ag:read',
  'ag:manage',
  'ag:vote',
  'ag:generate_pv',
  'polls:read',
  'polls:create',
  'polls:vote',
  'tickets:read_admin',
  'tickets:manage',
  'tickets:scan',
  'tickets:buy',
  'merch:read',
  'merch:buy',
  'merch:manage',
  'meetings:read',
  'meetings:manage',
  'meetings:rsvp',
  'passation:read',
  'passation:manage',
  'vault:read',
  'vault:write',
  'parcoursup:read_own',
  'parcoursup:export_all',
  'audit:read'
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const ROLE_PERMISSIONS: Record<SystemRole, readonly Permission[]> = {
  president: PERMISSIONS,
  tresorier: [
    'members:read',
    'members:invite',
    'projects:read',
    'projects:create',
    'projects:edit',
    'budget:read',
    'budget:write',
    'budget:close_year',
    'ag:read',
    'ag:vote',
    'polls:read',
    'polls:create',
    'polls:vote',
    'tickets:read_admin',
    'tickets:manage',
    'tickets:scan',
    'tickets:buy',
    'merch:read',
    'merch:buy',
    'merch:manage',
    'meetings:read',
    'meetings:manage',
    'meetings:rsvp',
    'passation:read',
    'passation:manage',
    'vault:read',
    'vault:write',
    'parcoursup:read_own',
    'audit:read'
  ],
  secretaire: [
    'members:read',
    'members:invite',
    'members:manage',
    'projects:read',
    'projects:create',
    'projects:edit',
    'budget:read',
    'ag:read',
    'ag:manage',
    'ag:vote',
    'ag:generate_pv',
    'polls:read',
    'polls:create',
    'polls:vote',
    'tickets:read_admin',
    'tickets:scan',
    'tickets:buy',
    'merch:read',
    'merch:buy',
    'meetings:read',
    'meetings:manage',
    'meetings:rsvp',
    'passation:read',
    'passation:manage',
    'vault:read',
    'vault:write',
    'parcoursup:read_own',
    'parcoursup:export_all'
  ],
  bureau: [
    'members:read',
    'projects:read',
    'projects:create',
    'projects:edit',
    'budget:read',
    'ag:read',
    'ag:vote',
    'polls:read',
    'polls:create',
    'polls:vote',
    'tickets:read_admin',
    'tickets:scan',
    'tickets:buy',
    'merch:read',
    'merch:buy',
    'meetings:read',
    'meetings:manage',
    'meetings:rsvp',
    'passation:read',
    'vault:read',
    'parcoursup:read_own'
  ],
  prof_referent: [
    'members:read',
    'projects:read',
    'projects:validate',
    'budget:read',
    'ag:read',
    'ag:vote',
    'polls:read',
    'polls:vote',
    'tickets:read_admin',
    'merch:read',
    'merch:buy',
    'meetings:read',
    'meetings:rsvp',
    'passation:read',
    'vault:read',
    'parcoursup:read_own',
    'parcoursup:export_all',
    'audit:read'
  ],
  adherent: [
    'projects:read',
    'ag:read',
    'ag:vote',
    'polls:read',
    'polls:vote',
    'tickets:buy',
    'merch:read',
    'merch:buy',
    'meetings:read',
    'meetings:rsvp',
    'parcoursup:read_own'
  ],
  invite: ['projects:read', 'polls:read', 'tickets:buy', 'merch:read', 'merch:buy']
};

export interface RoleDefinition {
  slug: string;
  label: string;
  description: string;
  permissions: Permission[];
  isSystem: boolean;
  isElevated: boolean;
  isBureau: boolean;
  memberCount?: number;
}

export interface PermissionGroup {
  id: string;
  label: string;
  permissions: readonly { key: Permission; label: string }[];
}

export const PERMISSION_GROUPS: readonly PermissionGroup[] = [
  {
    id: 'admin',
    label: 'Administration & Audit',
    permissions: [
      { key: 'admin:settings', label: 'Modifier les paramètres & couleurs du lycée' },
      { key: 'admin:roles', label: 'Créer, modifier, supprimer et attribuer les rôles' },
      { key: 'audit:read', label: 'Consulter & vérifier le journal SHA-256' }
    ]
  },
  {
    id: 'members',
    label: 'Membres & Adhésions',
    permissions: [
      { key: 'members:read', label: 'Voir l’annuaire des membres' },
      { key: 'members:invite', label: 'Inviter de nouveaux membres' },
      { key: 'members:manage', label: 'Gérer les adhésions, classes et rôles standards' }
    ]
  },
  {
    id: 'projects',
    label: 'Projets MDL',
    permissions: [
      { key: 'projects:read', label: 'Consulter les projets et tâches' },
      { key: 'projects:create', label: 'Créer de nouveaux projets' },
      { key: 'projects:edit', label: 'Modifier tous les projets et tâches' },
      { key: 'projects:validate', label: 'Valider / approuver les projets' }
    ]
  },
  {
    id: 'budget',
    label: 'Budget & Trésorerie',
    permissions: [
      { key: 'budget:read', label: 'Consulter les recettes, dépenses et graphiques' },
      { key: 'budget:write', label: 'Saisir et justifier des écritures budgétaires' },
      { key: 'budget:close_year', label: 'Clôturer l’exercice financier' }
    ]
  },
  {
    id: 'ag',
    label: 'Assemblées Générales',
    permissions: [
      { key: 'ag:read', label: 'Consulter les AG et candidatures' },
      { key: 'ag:manage', label: 'Convoquer, ouvrir/clôturer une AG et émarger' },
      { key: 'ag:vote', label: 'Voter en Assemblée Générale' },
      { key: 'ag:generate_pv', label: 'Générer le procès-verbal PDF officiel' }
    ]
  },
  {
    id: 'polls',
    label: 'Sondages',
    permissions: [
      { key: 'polls:read', label: 'Voir les sondages accessibles au rôle' },
      { key: 'polls:create', label: 'Créer et clôturer des sondages' },
      { key: 'polls:vote', label: 'Voter aux sondages' }
    ]
  },
  {
    id: 'tickets',
    label: 'Billetterie & Contrôle',
    permissions: [
      { key: 'tickets:buy', label: 'Réserver / acheter un billet événement' },
      { key: 'tickets:read_admin', label: 'Voir les listes de billets et statistiques' },
      { key: 'tickets:manage', label: 'Créer et gérer les événements / tarifs' },
      { key: 'tickets:scan', label: 'Scanner et valider les QR codes à l’entrée' }
    ]
  },
  {
    id: 'merch',
    label: 'Boutique & Précommandes',
    permissions: [
      { key: 'merch:read', label: 'Consulter le catalogue de la boutique MDL' },
      { key: 'merch:buy', label: 'Précommander des pulls, maillots ou goodies' },
      { key: 'merch:manage', label: 'Créer les produits, tailles et suivre les commandes fournisseur' }
    ]
  },
  {
    id: 'meetings',
    label: 'Réunions MDL',
    permissions: [
      { key: 'meetings:read', label: 'Consulter les réunions, ordres du jour et comptes-rendus' },
      { key: 'meetings:rsvp', label: 'Confirmer sa présence / absence à une réunion' },
      { key: 'meetings:manage', label: 'Planifier les réunions, présences et comptes-rendus' }
    ]
  },
  {
    id: 'passation',
    label: 'Passation & Coffre',
    permissions: [
      { key: 'passation:read', label: 'Consulter la checklist de passation' },
      { key: 'passation:manage', label: 'Modifier la checklist de passation' },
      { key: 'vault:read', label: 'Accéder aux documents du coffre-fort' },
      { key: 'vault:write', label: 'Ajouter ou supprimer des documents du coffre' }
    ]
  },
  {
    id: 'parcoursup',
    label: 'Parcoursup',
    permissions: [
      { key: 'parcoursup:read_own', label: 'Rédiger et exporter sa propre fiche d’engagement' },
      { key: 'parcoursup:export_all', label: 'Exporter les attestations de tous les élèves' }
    ]
  }
];

const ELEVATED_PERMISSION_SET = new Set<Permission>([
  'admin:settings',
  'admin:roles',
  'members:manage',
  'projects:validate',
  'budget:write',
  'budget:close_year',
  'ag:manage',
  'ag:generate_pv',
  'tickets:manage',
  'merch:manage',
  'passation:manage',
  'vault:write',
  'parcoursup:export_all',
  'audit:read'
]);

const BUREAU_PERMISSION_SET = new Set<Permission>([
  ...ELEVATED_PERMISSION_SET,
  'members:read',
  'members:invite',
  'projects:edit',
  'budget:read',
  'tickets:read_admin',
  'tickets:scan',
  'meetings:manage',
  'passation:read',
  'vault:read',
  'polls:create'
]);

const DEFAULT_ELEVATED_ROLES = new Set<string>([
  'president',
  'tresorier',
  'secretaire',
  'prof_referent'
]);

const DEFAULT_BUREAU_ROLES = new Set<string>([
  'president',
  'tresorier',
  'secretaire',
  'bureau',
  'prof_referent'
]);

export function computeRoleFlags(
  slug: string,
  permissions: readonly Permission[]
): { isElevated: boolean; isBureau: boolean } {
  const isElevated =
    DEFAULT_ELEVATED_ROLES.has(slug) ||
    permissions.some((p) => ELEVATED_PERMISSION_SET.has(p));
  const isBureau =
    isElevated ||
    DEFAULT_BUREAU_ROLES.has(slug) ||
    permissions.some((p) => BUREAU_PERMISSION_SET.has(p));
  return { isElevated, isBureau };
}

export interface RolePreset {
  slug: string;
  label: string;
  description: string;
  permissions: readonly Permission[];
}

export const ROLE_PRESETS: readonly RolePreset[] = [
  {
    slug: 'representant_eleves',
    label: 'Représentant des élèves',
    description: 'Délégué / CVL : porte la voix des élèves, crée des sondages et propose des projets.',
    permissions: [
      'members:read',
      'projects:read',
      'projects:create',
      'ag:read',
      'ag:vote',
      'polls:read',
      'polls:create',
      'polls:vote',
      'tickets:buy',
      'parcoursup:read_own'
    ]
  },
  {
    slug: 'resp_taches',
    label: 'Responsable de tâches & projets',
    description: 'Pilote l’avancement des projets et attribue/édite toutes les tâches des projets.',
    permissions: [
      'members:read',
      'projects:read',
      'projects:create',
      'projects:edit',
      'ag:read',
      'ag:vote',
      'polls:read',
      'polls:vote',
      'tickets:buy',
      'parcoursup:read_own'
    ]
  },
  {
    slug: 'resp_evenements',
    label: 'Responsable d’événements',
    description: 'Organise les événements, configure la billetterie et scanne les entrées.',
    permissions: [
      'members:read',
      'projects:read',
      'projects:create',
      'projects:edit',
      'polls:read',
      'polls:create',
      'polls:vote',
      'tickets:read_admin',
      'tickets:manage',
      'tickets:scan',
      'tickets:buy',
      'ag:read',
      'ag:vote',
      'parcoursup:read_own'
    ]
  },
  {
    slug: 'resp_communication',
    label: 'Responsable communication',
    description: 'Anime la communication : sondages lycée, suivi des événements et projets.',
    permissions: [
      'members:read',
      'projects:read',
      'polls:read',
      'polls:create',
      'polls:vote',
      'tickets:read_admin',
      'tickets:buy',
      'ag:read',
      'ag:vote',
      'parcoursup:read_own'
    ]
  },
  {
    slug: 'resp_cafeteria',
    label: 'Responsable cafétéria',
    description: 'Gère l’accueil, le contrôle des billets/accès et le suivi d’activité.',
    permissions: [
      'projects:read',
      'polls:read',
      'polls:vote',
      'tickets:read_admin',
      'tickets:scan',
      'tickets:buy',
      'ag:read',
      'ag:vote',
      'parcoursup:read_own'
    ]
  }
];

export const SYSTEM_ROLE_DEFINITIONS: readonly RoleDefinition[] = ROLES.map((slug) => {
  const permissions = [...ROLE_PERMISSIONS[slug]];
  const flags = computeRoleFlags(slug, permissions);
  return {
    slug,
    label: ROLE_LABELS[slug],
    description: ROLE_DESCRIPTIONS[slug],
    permissions,
    isSystem: true,
    isElevated: flags.isElevated,
    isBureau: flags.isBureau
  };
});

const dynamicRoleMap = new Map<string, RoleDefinition>(
  SYSTEM_ROLE_DEFINITIONS.map((role) => [role.slug, role])
);

export function syncDynamicRoles(rolesList: readonly RoleDefinition[]): void {
  dynamicRoleMap.clear();
  for (const sys of SYSTEM_ROLE_DEFINITIONS) {
    dynamicRoleMap.set(sys.slug, sys);
  }
  for (const role of rolesList) {
    dynamicRoleMap.set(role.slug, {
      ...role,
      permissions: [...role.permissions]
    });
  }
}

export function getRoleDefinition(role: string): RoleDefinition | undefined {
  return dynamicRoleMap.get(role);
}

export function getAllRoleDefinitions(): RoleDefinition[] {
  return Array.from(dynamicRoleMap.values());
}

export function getRoleLabel(role: string, customTitle?: string | null): string {
  if (customTitle && customTitle.trim().length > 0) return customTitle.trim();
  return dynamicRoleMap.get(role)?.label ?? ROLE_LABELS[role as SystemRole] ?? role;
}

export function isElevatedRole(role: string): boolean {
  const def = dynamicRoleMap.get(role);
  if (def) return def.isElevated;
  return DEFAULT_ELEVATED_ROLES.has(role);
}

export function isBureauRole(role: string): boolean {
  const def = dynamicRoleMap.get(role);
  if (def) return def.isBureau;
  return DEFAULT_BUREAU_ROLES.has(role);
}

export function slugifyRoleLabel(label: string): string {
  return label
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/^[^a-z]+/, '')
    .slice(0, 40);
}

export function hasPermission(role: Role, permission: Permission): boolean {
  const dynamic = dynamicRoleMap.get(role);
  if (dynamic) {
    return dynamic.permissions.includes(permission);
  }
  return ROLE_PERMISSIONS[role as SystemRole]?.includes(permission) ?? false;
}

export function hasAnyPermission(role: Role, permissions: readonly Permission[]): boolean {
  return permissions.some((p) => hasPermission(role, p));
}
