import type { Permission, Role, RoleDefinition } from '$shared/permissions';

declare global {
  namespace App {
    interface Locals {
      user: {
        id: number;
        email: string;
        firstName: string;
        lastName: string;
        classe: string | null;
        role: Role;
        roleLabel: string;
        permissions: Permission[];
        customTitle: string | null;
        isAdherent: boolean;
        totpEnabled: boolean;
      } | null;
      roles: RoleDefinition[];
      session: {
        id: string;
        twoFactorVerified: boolean;
        expiresAt: string;
      } | null;
      settings: {
        schoolName: string;
        schoolCity: string;
        schoolPostalCode: string;
        schoolDepartment: string;
        schoolUai: string | null;
        mdlName: string;
        primaryColor: string;
        accentColor: string;
        logoUrl: string | null;
        membershipFeeCents: number;
        schoolYear: string;
        registrationMode: 'open' | 'school_code' | 'invite_only';
        stripeEnabled: boolean;
        stripePublishableKey: string | null;
        merchSupplierName: string;
        merchSupplierEmail: string;
        merchSupplierUrl: string;
        setupCompleted: boolean;
      };
      needsAdminBootstrap: boolean;
    }
  }
}

export {};
