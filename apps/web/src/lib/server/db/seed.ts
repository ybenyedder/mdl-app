import { createHash, createHmac, randomUUID } from 'node:crypto';
import { count } from 'drizzle-orm';
import { PROJECT_TEMPLATES } from '../../shared/project-templates';
import { encryptText, hashPassword, hmacLookup, signEd25519Payload } from '../crypto';
import { closeDb, db, ensureMigrated } from './index';
import {
  agAttendances,
  agCandidates,
  assemblies,
  auditLogs,
  budgetEntries,
  events,
  meetingAttendances,
  meetings,
  merchItems,
  parcoursupDrafts,
  passationChecklists,
  polls,
  projectMembers,
  projects,
  projectTasks,
  schoolSettings,
  tickets,
  users
} from './schema';

const DEMO_PASSWORD = process.env.MDL_DEMO_PASSWORD || 'MdlDemo2026!';
const SCHOOL_YEAR = '2026-2027';

function buildTicketToken(qrCodeId: string, eventId: number, buyerName: string): string {
  const secret =
    process.env.TICKET_JWT_SECRET ||
    process.env.ENCRYPTION_KEY ||
    'mdl-dev-ticket-signing-secret';
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({
      jti: qrCodeId,
      eid: eventId,
      sub: buyerName,
      iss: 'mdl-connect',
      iat: Math.floor(Date.now() / 1000)
    })
  ).toString('base64url');
  const signature = createHmac('sha256', secret)
    .update(`${header}.${payload}`)
    .digest('base64url');
  return `${header}.${payload}.${signature}`;
}

function buildEd25519TicketToken(qrCodeId: string, eventId: number, buyerName: string): string {
  const payloadB64Url = Buffer.from(
    JSON.stringify({
      jti: qrCodeId,
      eid: eventId,
      sub: buyerName,
      iss: 'mdl-connect',
      iat: Math.floor(Date.now() / 1000)
    }),
    'utf8'
  ).toString('base64url');
  const sigB64Url = signEd25519Payload(payloadB64Url);
  return `${payloadB64Url}.${sigB64Url}`;
}

function computeAuditHash(
  prevHash: string,
  payload: {
    actorUserId: number | null;
    actorRole: string;
    action: string;
    targetType: string;
    targetId: string | null;
    detailsJson: string;
    createdAt: string;
  }
): string {
  const canonical = JSON.stringify({ prevHash, ...payload });
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

export async function seedDatabase(): Promise<{ skipped: boolean }> {
  await ensureMigrated();

  const existing = await db.select({ value: count() }).from(users);
  if ((existing[0]?.value ?? 0) > 0) {
    console.log('Base de données déjà peuplée (seed ignoré).');
    return { skipped: true };
  }

  const now = new Date().toISOString();
  const demoPasswordHash = await hashPassword(DEMO_PASSWORD);

  // 1. Paramètres établissement
  await db.insert(schoolSettings).values({
    schoolName: 'Lycée Polyvalent Jean Moulin',
    mdlName: 'MDL Jean Moulin',
    primaryColor: '#1d4ed8',
    accentColor: '#f59e0b',
    logoUrl: null,
    membershipFeeCents: 1000,
    schoolYear: SCHOOL_YEAR,
    legalRepresentative: 'Mme Claire Moreau (Proviseure)',
    registrationMode: 'open',
    schoolCodeHash: null,
    updatedAt: now
  });

  // 2. 7 utilisateurs (un par rôle)
  const demoUsersInput = [
    {
      email: 'president@mdl-demo.fr',
      firstName: 'Camille',
      lastName: 'Laurent',
      classe: 'Tle G2',
      role: 'president' as const,
      customTitle: 'Présidente de la MDL',
      isAdherent: true,
      adhesionPaidAt: '2026-09-10T10:15:00.000Z',
      adhesionMethod: 'especes' as const
    },
    {
      email: 'tresorier@mdl-demo.fr',
      firstName: 'Lucas',
      lastName: 'Bernard',
      classe: 'Tle STMG1',
      role: 'tresorier' as const,
      customTitle: 'Trésorier',
      isAdherent: true,
      adhesionPaidAt: '2026-09-10T10:20:00.000Z',
      adhesionMethod: 'virement' as const
    },
    {
      email: 'secretaire@mdl-demo.fr',
      firstName: 'Inès',
      lastName: 'Petit',
      classe: '1ère G4',
      role: 'secretaire' as const,
      customTitle: 'Secrétaire générale',
      isAdherent: true,
      adhesionPaidAt: '2026-09-11T12:00:00.000Z',
      adhesionMethod: 'especes' as const
    },
    {
      email: 'bureau@mdl-demo.fr',
      firstName: 'Noah',
      lastName: 'Girard',
      classe: '1ère STI2D2',
      role: 'bureau' as const,
      customTitle: 'Responsable événementiel',
      isAdherent: true,
      adhesionPaidAt: '2026-09-12T14:30:00.000Z',
      adhesionMethod: 'cheque' as const
    },
    {
      email: 'prof@mdl-demo.fr',
      firstName: 'Sophie',
      lastName: 'Mercier',
      classe: null,
      role: 'prof_referent' as const,
      customTitle: 'CPE & Référente MDL',
      isAdherent: false,
      adhesionPaidAt: null,
      adhesionMethod: null
    },
    {
      email: 'adherent@mdl-demo.fr',
      firstName: 'Lina',
      lastName: 'Benali',
      classe: '2nde 5',
      role: 'adherent' as const,
      customTitle: null,
      isAdherent: true,
      adhesionPaidAt: '2026-09-18T16:10:00.000Z',
      adhesionMethod: 'especes' as const
    },
    {
      email: 'invite@mdl-demo.fr',
      firstName: 'Tom',
      lastName: 'Lefèvre',
      classe: '2nde 2',
      role: 'invite' as const,
      customTitle: null,
      isAdherent: false,
      adhesionPaidAt: null,
      adhesionMethod: null
    }
  ];

  const insertedUsers = await db
    .insert(users)
    .values(
      demoUsersInput.map((u) => ({
        emailEncrypted: encryptText(u.email),
        emailHash: hmacLookup(u.email),
        passwordHash: demoPasswordHash,
        firstName: u.firstName,
        lastName: u.lastName,
        classe: u.classe,
        role: u.role,
        customTitle: u.customTitle,
        isAdherent: u.isAdherent,
        adhesionPaidAt: u.adhesionPaidAt,
        adhesionMethod: u.adhesionMethod,
        totpEnabled: false,
        createdAt: now,
        updatedAt: now
      }))
    )
    .returning();

  const byRole = Object.fromEntries(insertedUsers.map((u) => [u.role, u])) as Record<
    (typeof demoUsersInput)[number]['role'],
    (typeof insertedUsers)[number]
  >;

  // 3. 3 projets avec tâches et checklist sécurité
  const balTemplate = PROJECT_TEMPLATES.find((t) => t.id === 'bal')!;
  const tournoiTemplate = PROJECT_TEMPLATES.find((t) => t.id === 'tournoi')!;
  const caritatifTemplate = PROJECT_TEMPLATES.find((t) => t.id === 'caritatif')!;

  const [projBal, projTournoi, projCaritatif] = await db
    .insert(projects)
    .values([
      {
        templateId: balTemplate.id,
        title: 'Bal de promo des Terminales 2027',
        description:
          'Gala de fin d’année des Terminales avec DJ, buffet sans alcool, photobooth et billetterie QR.',
        category: balTemplate.category,
        eventDate: '2027-06-18T20:00:00.000Z',
        budgetPlannedCents: 350000,
        status: 'valide',
        leadUserId: byRole.president.id,
        safetyChecklistJson: JSON.stringify(
          balTemplate.safetyChecklist.map((label, idx) => ({
            label,
            checked: idx < 3
          }))
        ),
        profValidatedBy: byRole.prof_referent.id,
        profValidatedAt: '2026-11-02T15:00:00.000Z',
        createdAt: now
      },
      {
        templateId: tournoiTemplate.id,
        title: 'Tournoi inter-classes Futsal & Smash Bros',
        description:
          'Après-midi sportive et e-sport au gymnase et au foyer, ouverte à toutes les classes.',
        category: tournoiTemplate.category,
        eventDate: '2026-12-16T13:30:00.000Z',
        budgetPlannedCents: 30000,
        status: 'en_cours',
        leadUserId: byRole.bureau.id,
        safetyChecklistJson: JSON.stringify(
          tournoiTemplate.safetyChecklist.map((label, idx) => ({
            label,
            checked: idx === 0
          }))
        ),
        createdAt: now
      },
      {
        templateId: caritatifTemplate.id,
        title: 'Collecte solidaire d’hiver',
        description:
          'Collecte de denrées non périssables et produits d’hygiène au profit d’une association locale.',
        category: caritatifTemplate.category,
        eventDate: '2027-01-22T09:00:00.000Z',
        budgetPlannedCents: 20000,
        status: 'brouillon',
        leadUserId: byRole.secretaire.id,
        safetyChecklistJson: JSON.stringify(
          caritatifTemplate.safetyChecklist.map((label) => ({
            label,
            checked: false
          }))
        ),
        createdAt: now
      }
    ])
    .returning();

  await db.insert(projectTasks).values([
    // Bal de promo
    {
      projectId: projBal.id,
      title: 'Validation lieu et devis traiteur',
      status: 'done',
      dueDate: '2026-11-01',
      assigneeId: byRole.tresorier.id,
      position: 0,
      createdAt: now
    },
    {
      projectId: projBal.id,
      title: 'Assurance responsabilité civile événement',
      status: 'doing',
      dueDate: '2027-04-15',
      assigneeId: byRole.secretaire.id,
      position: 1,
      createdAt: now
    },
    {
      projectId: projBal.id,
      title: 'Lancement préventes adhérents',
      status: 'todo',
      dueDate: '2027-05-15',
      assigneeId: byRole.president.id,
      position: 2,
      createdAt: now
    },
    // Tournoi
    {
      projectId: projTournoi.id,
      title: 'Réservation gymnase avec la vie scolaire',
      status: 'done',
      dueDate: '2026-11-20',
      assigneeId: byRole.bureau.id,
      position: 0,
      createdAt: now
    },
    {
      projectId: projTournoi.id,
      title: 'Ouverture des inscriptions équipes',
      status: 'doing',
      dueDate: '2026-12-05',
      assigneeId: byRole.bureau.id,
      position: 1,
      createdAt: now
    },
    {
      projectId: projTournoi.id,
      title: 'Tirage au sort de l’arbre de tournoi',
      status: 'todo',
      dueDate: '2026-12-14',
      assigneeId: byRole.adherent.id,
      position: 2,
      createdAt: now
    },
    // Collecte
    {
      projectId: projCaritatif.id,
      title: 'Vote et validation de l’association bénéficiaire',
      status: 'doing',
      dueDate: '2026-12-10',
      assigneeId: byRole.secretaire.id,
      position: 0,
      createdAt: now
    },
    {
      projectId: projCaritatif.id,
      title: 'Campagne d’affichage au foyer et au CDI',
      status: 'todo',
      dueDate: '2027-01-08',
      assigneeId: byRole.adherent.id,
      position: 1,
      createdAt: now
    }
  ]);

  await db.insert(projectMembers).values([
    {
      projectId: projBal.id,
      userId: byRole.president.id,
      hoursLogged: 14.5,
      roleInProject: 'Cheffe de projet'
    },
    {
      projectId: projBal.id,
      userId: byRole.tresorier.id,
      hoursLogged: 9,
      roleInProject: 'Budget & Devis'
    },
    {
      projectId: projTournoi.id,
      userId: byRole.bureau.id,
      hoursLogged: 8.5,
      roleInProject: 'Organisateur'
    },
    {
      projectId: projTournoi.id,
      userId: byRole.adherent.id,
      hoursLogged: 4,
      roleInProject: 'Arbitrage & Accueil'
    },
    {
      projectId: projCaritatif.id,
      userId: byRole.secretaire.id,
      hoursLogged: 3.5,
      roleInProject: 'Coordination'
    }
  ]);

  // 4. 6 écritures budget réalistes
  await db.insert(budgetEntries).values([
    {
      projectId: null,
      type: 'recette',
      category: 'Subventions',
      label: 'Dotation annuelle fonds vie lycéenne (CVL / Établissement)',
      amountCents: 150000,
      entryDate: '2026-09-15',
      createdBy: byRole.tresorier.id,
      validatedBy: byRole.president.id,
      fiscalYear: SCHOOL_YEAR,
      createdAt: now
    },
    {
      projectId: null,
      type: 'recette',
      category: 'Adhésions',
      label: 'Cotisations adhérents MDL — campagne de rentrée (85 élèves)',
      amountCents: 85000,
      entryDate: '2026-10-04',
      createdBy: byRole.tresorier.id,
      validatedBy: byRole.president.id,
      fiscalYear: SCHOOL_YEAR,
      createdAt: now
    },
    {
      projectId: projTournoi.id,
      type: 'recette',
      category: 'Billetterie',
      label: 'Préventes inscriptions équipes Tournoi Futsal & Smash',
      amountCents: 24000,
      entryDate: '2026-11-10',
      createdBy: byRole.tresorier.id,
      validatedBy: null,
      fiscalYear: SCHOOL_YEAR,
      createdAt: now
    },
    {
      projectId: projBal.id,
      type: 'depense',
      category: 'Prestations',
      label: 'Acompte location salle & sonorisation Bal de promo',
      amountCents: 95000,
      entryDate: '2026-11-05',
      createdBy: byRole.tresorier.id,
      validatedBy: byRole.prof_referent.id,
      fiscalYear: SCHOOL_YEAR,
      createdAt: now
    },
    {
      projectId: null,
      type: 'depense',
      category: 'Équipement Foyer',
      label: 'Achat ballons futsal, 2 manettes et jeux de société pour le foyer',
      amountCents: 18550,
      entryDate: '2026-10-18',
      createdBy: byRole.bureau.id,
      validatedBy: byRole.tresorier.id,
      fiscalYear: SCHOOL_YEAR,
      createdAt: now
    },
    {
      projectId: projCaritatif.id,
      type: 'depense',
      category: 'Communication',
      label: 'Impression affiches A3 et flyers sensibilisation collecte',
      amountCents: 6450,
      entryDate: '2026-11-12',
      createdBy: byRole.secretaire.id,
      validatedBy: byRole.tresorier.id,
      fiscalYear: SCHOOL_YEAR,
      createdAt: now
    }
  ]);

  // 5. 1 AG ouverte avec 3 candidats
  const [assembly] = await db
    .insert(assemblies)
    .values({
      title: 'Assemblée Générale Ordinaire — Renouvellement du Bureau 2026-2027',
      description:
        'Présentation du bilan moral et financier, puis élection à bulletin secret des membres du bureau MDL.',
      scheduledAt: '2026-11-25T17:15:00.000Z',
      location: 'Amphithéâtre Jean Moulin',
      status: 'vote_ouvert',
      voteOpensAt: '2026-11-13T08:00:00.000Z',
      voteClosesAt: '2026-11-25T19:00:00.000Z',
      quorumRequired: 30,
      createdBy: byRole.secretaire.id,
      createdAt: now
    })
    .returning();

  await db.insert(agCandidates).values([
    {
      assemblyId: assembly.id,
      userId: byRole.president.id,
      fullName: 'Camille Laurent',
      classe: 'Tle G2',
      positionTitle: 'Présidence',
      professionOfFaith:
        'Poursuivre la modernisation du foyer, lancer le Bal de promo et renforcer les liens avec le CVL.',
      votesCount: 0,
      approved: true,
      createdAt: now
    },
    {
      assemblyId: assembly.id,
      userId: byRole.tresorier.id,
      fullName: 'Lucas Bernard',
      classe: 'Tle STMG1',
      positionTitle: 'Trésorerie',
      professionOfFaith:
        'Garantir une comptabilité transparente au centime près avec publication trimestrielle des comptes.',
      votesCount: 0,
      approved: true,
      createdAt: now
    },
    {
      assemblyId: assembly.id,
      userId: byRole.secretaire.id,
      fullName: 'Inès Petit',
      classe: '1ère G4',
      positionTitle: 'Secrétariat',
      professionOfFaith:
        'Fluidifier la communication avec tous les lycéens et accompagner chaque porteur de projet.',
      votesCount: 0,
      approved: true,
      createdAt: now
    }
  ]);

  await db.insert(agAttendances).values([
    { assemblyId: assembly.id, userId: byRole.president.id, present: true, signedAt: now },
    { assemblyId: assembly.id, userId: byRole.tresorier.id, present: true, signedAt: now },
    { assemblyId: assembly.id, userId: byRole.secretaire.id, present: true, signedAt: now },
    { assemblyId: assembly.id, userId: byRole.adherent.id, present: true, signedAt: now }
  ]);

  // 6. 1 sondage ouvert
  await db.insert(polls).values({
    title: 'Thème du Bal de promo 2027',
    description:
      'Votez pour votre thème préféré afin d’orienter la décoration et le dress code du gala de juin.',
    scope: 'lycee',
    optionsJson: JSON.stringify([
      'Nuit Étoilée',
      'Années 90 / Rétro',
      'Cinéma & Tapis Rouge',
      'Mascarade Vénitienne'
    ]),
    isOpen: true,
    multipleChoice: false,
    createdBy: byRole.bureau.id,
    closesAt: '2026-12-20T23:59:59.000Z',
    createdAt: now
  });

  // 7. 2 événements avec billets
  const [eventBal, eventTournoi] = await db
    .insert(events)
    .values([
      {
        projectId: projBal.id,
        title: 'Bal de promo des Terminales 2027',
        description:
          'Soirée gala de fin d’année : DJ set, buffet sucré/salé, boissons sans alcool et espace photo.',
        eventDate: '2027-06-18T20:00:00.000Z',
        location: 'Salle des fêtes municipale Jean Moulin',
        capacity: 250,
        priceFullCents: 1800,
        priceReducedCents: 1500,
        pricePresaleCents: 1200,
        accessCode: null,
        isPublic: true,
        stripeEnabled: false,
        createdAt: now
      },
      {
        projectId: projTournoi.id,
        title: 'Tournoi Futsal & Smash Bros',
        description:
          'Inscription joueur / spectateur pour le tournoi inter-classes du mercredi après-midi.',
        eventDate: '2026-12-16T13:30:00.000Z',
        location: 'Gymnase & Foyer MDL',
        capacity: 80,
        priceFullCents: 400,
        priceReducedCents: 200,
        pricePresaleCents: 200,
        accessCode: null,
        isPublic: true,
        stripeEnabled: false,
        createdAt: now
      }
    ])
    .returning();

  const ticketSeeds = [
    {
      eventId: eventBal.id,
      buyerUserId: byRole.president.id,
      buyerName: 'Camille Laurent',
      buyerEmail: 'president@mdl-demo.fr',
      buyerClasse: 'Tle G2',
      tier: 'prevente' as const,
      priceCents: 1200,
      paymentMethod: 'virement' as const,
      paymentStatus: 'paye' as const
    },
    {
      eventId: eventBal.id,
      buyerUserId: byRole.adherent.id,
      buyerName: 'Lina Benali',
      buyerEmail: 'adherent@mdl-demo.fr',
      buyerClasse: '2nde 5',
      tier: 'reduit' as const,
      priceCents: 1500,
      paymentMethod: 'especes' as const,
      paymentStatus: 'paye' as const
    },
    {
      eventId: eventBal.id,
      buyerUserId: byRole.invite.id,
      buyerName: 'Tom Lefèvre',
      buyerEmail: 'invite@mdl-demo.fr',
      buyerClasse: '2nde 2',
      tier: 'plein' as const,
      priceCents: 1800,
      paymentMethod: 'especes' as const,
      paymentStatus: 'en_attente' as const
    },
    {
      eventId: eventTournoi.id,
      buyerUserId: byRole.bureau.id,
      buyerName: 'Noah Girard',
      buyerEmail: 'bureau@mdl-demo.fr',
      buyerClasse: '1ère STI2D2',
      tier: 'reduit' as const,
      priceCents: 200,
      paymentMethod: 'especes' as const,
      paymentStatus: 'paye' as const
    },
    {
      eventId: eventTournoi.id,
      buyerUserId: byRole.adherent.id,
      buyerName: 'Lina Benali',
      buyerEmail: 'adherent@mdl-demo.fr',
      buyerClasse: '2nde 5',
      tier: 'prevente' as const,
      priceCents: 200,
      paymentMethod: 'especes' as const,
      paymentStatus: 'paye' as const
    }
  ];

  await db.insert(tickets).values(
    ticketSeeds.map((t) => {
      const qrCodeId = `MDL-${randomUUID().slice(0, 8).toUpperCase()}`;
      return {
        eventId: t.eventId,
        buyerUserId: t.buyerUserId,
        buyerName: t.buyerName,
        buyerEmailEncrypted: encryptText(t.buyerEmail),
        buyerClasse: t.buyerClasse,
        tier: t.tier,
        priceCents: t.priceCents,
        paymentMethod: t.paymentMethod,
        paymentStatus: t.paymentStatus,
        ed25519Token: buildEd25519TicketToken(qrCodeId, t.eventId, t.buyerName),
        jwtToken: buildTicketToken(qrCodeId, t.eventId, t.buyerName),
        qrCodeId,
        createdAt: now
      };
    })
  );

  // 8. 1 checklist de passation
  await db.insert(passationChecklists).values([
    {
      schoolYear: SCHOOL_YEAR,
      stepKey: 'bilan_financier',
      label: 'Arrêter les comptes et faire valider le bilan financier par le bureau sortant',
      completed: true,
      completedBy: byRole.tresorier.id,
      completedAt: '2026-09-20T17:00:00.000Z',
      notes: 'Solde de reprise vérifié sur le relevé bancaire de septembre.'
    },
    {
      schoolYear: SCHOOL_YEAR,
      stepKey: 'mandataires_banque',
      label: 'Mettre à jour les signatures et mandataires sur le compte bancaire MDL',
      completed: true,
      completedBy: byRole.president.id,
      completedAt: '2026-10-02T14:30:00.000Z',
      notes: 'PV d’AG et pièces d’identité déposés en agence.'
    },
    {
      schoolYear: SCHOOL_YEAR,
      stepKey: 'declaration_prefecture',
      label: 'Déclarer le nouveau bureau en préfecture (loi 1901)',
      completed: false,
      completedBy: null,
      completedAt: null,
      notes: 'À finaliser juste après la proclamation de l’AG en cours.'
    },
    {
      schoolYear: SCHOOL_YEAR,
      stepKey: 'cles_foyer',
      label: 'Transmettre les clés du foyer, du coffre et le registre d’inventaire',
      completed: false,
      completedBy: null,
      completedAt: null,
      notes: null
    },
    {
      schoolYear: SCHOOL_YEAR,
      stepKey: 'acces_numeriques',
      label: 'Transférer les accès administrateurs MDL Connect et messagerie officielle',
      completed: false,
      completedBy: null,
      completedAt: null,
      notes: null
    }
  ]);

  // 9. Articles boutique précommandes & réunions MDL
  await db.insert(merchItems).values([
    {
      title: 'Pull de promo 2026-2027 brodé',
      description:
        'Sweat à capuche 320 g/m² coton bio brodé aux couleurs du lycée. Précommande sans avance de trésorerie : la commande fournisseur part dès clôture.',
      category: 'pull',
      priceCents: 3200,
      supplierCostCents: 2100,
      sizesJson: ['XS', 'S', 'M', 'L', 'XL', 'XXL'],
      isActive: true,
      zeroAdvanceMode: true,
      createdBy: byRole.president.id
    },
    {
      title: 'Tote-bag & pack stickers MDL',
      description: 'Coton épais sérigraphié au lycée + planche de 6 stickers vinyle.',
      category: 'goodies',
      priceCents: 800,
      supplierCostCents: 350,
      sizesJson: ['Unique'],
      isActive: true,
      zeroAdvanceMode: true,
      createdBy: byRole.bureau.id
    }
  ]);

  const [meeting1] = await db
    .insert(meetings)
    .values([
      {
        title: 'Réunion bureau — Bilan préventes & pull de promo',
        description: 'Point hebdomadaire sur la trésorerie, la soirée d’automne et les essayages tailles.',
        scope: 'bureau',
        scheduledAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
        location: 'Foyer des lycéens (Salle B04)',
        agendaJson: [
          { title: 'Point trésorerie & validation devis sono', durationMin: 15, done: false },
          { title: 'Organisation essayages pulls XS→XXL', durationMin: 20, done: false },
          { title: 'Répartition créneaux scan entrée', durationMin: 15, done: false }
        ],
        minutesText: '',
        status: 'planifiee',
        createdBy: byRole.president.id
      },
      {
        title: 'Réunion d’information ouverte — Projets du semestre',
        description: 'Présentation des commissions Bal, Tournoi sportif et Yearbook à tous les adhérents.',
        scope: 'adherents',
        scheduledAt: new Date(Date.now() + 9 * 24 * 60 * 60 * 1000).toISOString(),
        location: 'Amphithéâtre',
        agendaJson: [
          { title: 'Présentation des 3 commissions projet', durationMin: 25, done: false },
          { title: 'Appel à volontaires & vote thématique', durationMin: 20, done: false }
        ],
        minutesText: '',
        status: 'planifiee',
        createdBy: byRole.secretaire.id
      }
    ])
    .returning({ id: meetings.id });

  if (meeting1) {
    await db.insert(meetingAttendances).values([
      {
        meetingId: meeting1.id,
        userId: byRole.president.id,
        rsvpStatus: 'present',
        checkedIn: true
      },
      {
        meetingId: meeting1.id,
        userId: byRole.tresorier.id,
        rsvpStatus: 'present',
        checkedIn: false
      }
    ]);
  }

  // 10. Brouillon Parcoursup + entrée initiale d'audit chaînée
  await db.insert(parcoursupDrafts).values({
    userId: byRole.president.id,
    schoolYear: SCHOOL_YEAR,
    summaryText:
      'Présidente de la Maison des Lycéens (MDL) du lycée Jean Moulin : pilotage d’une équipe de 5 élus, gestion d’un budget associatif annuel et coordination du Bal de promo.',
    skillsJson: JSON.stringify([
      'Gestion de projet',
      'Animation de réunion & prise de parole',
      'Gestion budgétaire associative',
      'Encadrement d’équipe'
    ]),
    hoursTotal: 14.5,
    updatedAt: now
  });

  const genesisPrevHash = '0'.repeat(64);
  const auditPayload = {
    actorUserId: byRole.president.id,
    actorRole: 'president',
    action: 'system:seed',
    targetType: 'database',
    targetId: SCHOOL_YEAR,
    detailsJson: JSON.stringify({ message: 'Initialisation du jeu de données de démonstration MDL' }),
    createdAt: now
  };
  await db.insert(auditLogs).values({
    ...auditPayload,
    prevHash: genesisPrevHash,
    entryHash: computeAuditHash(genesisPrevHash, auditPayload)
  });

  console.log('Seed MDL Connect terminé avec succès :');
  console.log(`- 7 utilisateurs créés (mot de passe démo : ${DEMO_PASSWORD})`);
  console.log('- 3 projets, 6 écritures budget, 1 AG (3 candidats), 1 sondage, 2 événements (5 billets), 5 étapes de passation');

  return { skipped: false };
}

const isCliEntry = process.argv[1]?.endsWith('seed.ts') || process.argv[1]?.endsWith('seed.js');
if (isCliEntry) {
  seedDatabase()
    .catch((error) => {
      console.error('Erreur lors du seed :', error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await closeDb();
    });
}
