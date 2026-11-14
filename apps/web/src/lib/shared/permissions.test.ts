import { describe, expect, it } from 'vitest';
import {
  PERMISSIONS,
  ROLE_LABELS,
  ROLE_PERMISSIONS,
  ROLES,
  hasAnyPermission,
  hasPermission,
  type Permission,
  type Role
} from './permissions';

describe('permissions & RBAC matrix', () => {
  const expectedRoles: readonly Role[] = [
    'president',
    'tresorier',
    'secretaire',
    'bureau',
    'prof_referent',
    'adherent',
    'invite'
  ];

  it('defines exactly the 7 expected roles and labels', () => {
    expect(ROLES).toEqual(expectedRoles);
    expect(Object.keys(ROLE_LABELS).sort()).toEqual([...expectedRoles].sort());
    expect(Object.keys(ROLE_PERMISSIONS).sort()).toEqual([...expectedRoles].sort());
    for (const role of ROLES) {
      expect(ROLE_LABELS[role].length).toBeGreaterThan(0);
    }
  });

  it('grants every defined permission exclusively to president for admin:roles', () => {
    for (const permission of PERMISSIONS) {
      expect(hasPermission('president', permission)).toBe(true);
    }

    for (const role of ROLES) {
      if (role === 'president') {
        expect(hasPermission(role, 'admin:roles')).toBe(true);
        expect(hasPermission(role, 'admin:settings')).toBe(true);
      } else {
        expect(hasPermission(role, 'admin:roles')).toBe(false);
        expect(hasPermission(role, 'admin:settings')).toBe(false);
      }
    }
  });

  it('restricts invite strictly to projects:read, polls:read, tickets:buy and merch catalog', () => {
    const allowedForInvite: readonly Permission[] = [
      'projects:read',
      'polls:read',
      'tickets:buy',
      'merch:read',
      'merch:buy'
    ];
    expect([...ROLE_PERMISSIONS.invite]).toEqual(allowedForInvite);

    for (const permission of PERMISSIONS) {
      const expected = allowedForInvite.includes(permission);
      expect(hasPermission('invite', permission)).toBe(expected);
    }
  });

  it('gives prof_referent projects:validate and audit:read, but not budget:write', () => {
    expect(hasPermission('prof_referent', 'projects:validate')).toBe(true);
    expect(hasPermission('prof_referent', 'audit:read')).toBe(true);
    expect(hasPermission('prof_referent', 'parcoursup:export_all')).toBe(true);
    expect(hasPermission('prof_referent', 'budget:read')).toBe(true);

    expect(hasPermission('prof_referent', 'budget:write')).toBe(false);
    expect(hasPermission('prof_referent', 'budget:close_year')).toBe(false);
    expect(hasPermission('prof_referent', 'projects:create')).toBe(false);
    expect(hasPermission('prof_referent', 'members:manage')).toBe(false);
  });

  it('enforces distinct capabilities for tresorier, secretaire, bureau and adherent', () => {
    // Trésorier : budget & clôture, mais pas de gestion de membres ni génération PV AG
    expect(hasPermission('tresorier', 'budget:write')).toBe(true);
    expect(hasPermission('tresorier', 'budget:close_year')).toBe(true);
    expect(hasPermission('tresorier', 'tickets:manage')).toBe(true);
    expect(hasPermission('tresorier', 'audit:read')).toBe(true);
    expect(hasPermission('tresorier', 'ag:manage')).toBe(false);
    expect(hasPermission('tresorier', 'members:manage')).toBe(false);

    // Secrétaire : gestion AG / PV / membres / Parcoursup, pas d'écriture budget
    expect(hasPermission('secretaire', 'ag:manage')).toBe(true);
    expect(hasPermission('secretaire', 'ag:generate_pv')).toBe(true);
    expect(hasPermission('secretaire', 'members:manage')).toBe(true);
    expect(hasPermission('secretaire', 'parcoursup:export_all')).toBe(true);
    expect(hasPermission('secretaire', 'budget:write')).toBe(false);

    // Bureau : opérationnel projets & scan, pas de vault:write ni budget:write ni ag:manage
    expect(hasPermission('bureau', 'projects:create')).toBe(true);
    expect(hasPermission('bureau', 'tickets:scan')).toBe(true);
    expect(hasPermission('bureau', 'vault:read')).toBe(true);
    expect(hasPermission('bureau', 'vault:write')).toBe(false);
    expect(hasPermission('bureau', 'budget:write')).toBe(false);

    // Adhérent : lecture & votes & achat billet & parcoursup perso
    expect(hasPermission('adherent', 'ag:vote')).toBe(true);
    expect(hasPermission('adherent', 'polls:vote')).toBe(true);
    expect(hasPermission('adherent', 'tickets:buy')).toBe(true);
    expect(hasPermission('adherent', 'parcoursup:read_own')).toBe(true);
    expect(hasPermission('adherent', 'projects:create')).toBe(false);
    expect(hasPermission('adherent', 'tickets:scan')).toBe(false);
    expect(hasPermission('adherent', 'members:read')).toBe(false);
  });

  it('handles hasAnyPermission and invalid roles safely', () => {
    expect(hasAnyPermission('invite', ['budget:write', 'tickets:buy'])).toBe(true);
    expect(hasAnyPermission('invite', ['budget:write', 'ag:vote'])).toBe(false);
    expect(hasAnyPermission('president', [])).toBe(false);
    expect(hasPermission('unknown_role' as Role, 'projects:read')).toBe(false);
  });
});
