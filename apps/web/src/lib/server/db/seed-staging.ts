import { count, eq } from 'drizzle-orm';
import { encryptText, hmacLookup } from '../crypto';
import { signTicketEd25519Qr, signTicketJwt } from '../tickets';
import { closeDb, db, ensureMigrated } from './index';
import { seedDatabase } from './seed';
import {
  budgetEntries,
  events,
  projectMembers,
  projects,
  projectTasks,
  schoolSettings,
  tickets,
  users
} from './schema';

const STAGING_MARKER_EVENT = 'Festival Printemps Lycéen (Staging)';

const STUDENT_NAMES = [
  'Camille Laurent',
  'Lucas Moreau',
  'Inès Benali',
  'Hugo Lefèvre',
  'Chloé Martin',
  'Nathan Girard',
  'Zoé Chevalier',
  'Enzo Mercier',
  'Manon Garnier',
  'Théo Faure',
  'Léna Blanc',
  'Raphaël Guérin',
  'Jade Perrin',
  'Tom Clément',
  'Sarah Nicolas',
  'Mathis Henry',
  'Eva Roussel',
  'Gabriel Mathieu',
  'Louna Gauthier',
  'SachaMasson',
  'Ambre Robin',
  'Ethan Bonnet',
  'Nina François',
  'Noah Legrand',
  'Lola Boyer'
].map((n) => n.replace('SachaMasson', 'Sacha Masson'));

const CLASSES = ['2nde A', '2nde B', '2nde D', '1re G1', '1re G3', '1re STMG', 'Tle G2', 'Tle S1', 'Tle HLP'];

/**
 * Peuple un environnement de staging isolé avec un jeu volumétrique réaliste
 * (9+ projets dont dépassements budgétaires, 30+ écritures sur 7 catégories
 * et 2 exercices, et 55 billets signés Ed25519 prêts pour test scanner hors-ligne).
 *
 * Exige explicitement `MDL_STAGING=1` pour éviter toute écriture en production.
 */
export async function seedStagingVolume(): Promise<{ skipped: boolean }> {
  if (process.env.MDL_STAGING !== '1') {
    throw new Error('Refus : MDL_STAGING=1 est requis pour exécuter le seed de staging.');
  }

  await ensureMigrated();
  await seedDatabase();

  const existingMarker = await db
    .select({ value: count() })
    .from(events)
    .where(eq(events.title, STAGING_MARKER_EVENT));

  if ((existingMarker[0]?.value ?? 0) > 0) {
    console.log('Données volumétriques staging déjà présentes (seed staging ignoré).');
    return { skipped: true };
  }

  const allUsers = await db.select().from(users);
  const president = allUsers.find((u) => u.role === 'president') ?? allUsers[0];
  const tresorier = allUsers.find((u) => u.role === 'tresorier') ?? president;
  const bureau = allUsers.find((u) => u.role === 'bureau') ?? president;
  const adherent = allUsers.find((u) => u.role === 'adherent') ?? president;

  if (!president) {
    throw new Error('Aucun utilisateur trouvé après seedDatabase().');
  }

  // Marquer le setup comme terminé pour accéder directement au dashboard et modules
  await db
    .update(schoolSettings)
    .set({ setupCompleted: true, updatedAt: new Date().toISOString() });

  // 1. Ajouter 6 projets complémentaires réalistes (dont 2 en dépassement budgétaire pour tester les graphiques)
  const existingProjects = await db.select().from(projects);
  const existingByTitle = Object.fromEntries(existingProjects.map((p) => [p.title, p]));

  const extraProjectsSpec = [
    {
      title: 'Festival Printemps Lycéen',
      description: 'Scène ouverte musicale, stands associatifs et buvette solidaire dans la cour d’honneur.',
      category: 'Culture',
      eventDate: '2027-04-16T14:00:00.000Z',
      budgetPlannedCents: 180000, // 1 800 € prévu -> 2 140 € dépensé (dépassement rouge)
      status: 'en_cours' as const,
      leadUserId: president.id
    },
    {
      title: 'Tournoi Futsal Inter-Classes',
      description: 'Championnat 5v5 au gymnase municipal avec arbitrage lycéen et coupes gravées.',
      category: 'Sport',
      eventDate: '2027-02-12T13:30:00.000Z',
      budgetPlannedCents: 45000, // 450 € prévu -> 545 € dépensé (dépassement rouge)
      status: 'valide' as const,
      leadUserId: bureau.id
    },
    {
      title: 'Tournoi E-Sport & Pizza',
      description: 'Soirée gaming polyvalente en salle des fêtes : Rocket League, Mario Kart et buvette.',
      category: 'Événements',
      eventDate: '2027-03-05T18:00:00.000Z',
      budgetPlannedCents: 75000, // 750 € prévu -> 610 € dépensé
      status: 'en_cours' as const,
      leadUserId: bureau.id
    },
    {
      title: 'Kiosque Cafétéria Solidaire',
      description: 'Gestion du foyer, machines à café équitable et goûters bio à prix coûtant.',
      category: 'Vie lycéenne',
      eventDate: '2027-01-15T10:00:00.000Z',
      budgetPlannedCents: 120000, // 1 200 € prévu -> 980 € dépensé
      status: 'en_cours' as const,
      leadUserId: tresorier.id
    },
    {
      title: 'Semaine des Arts & Expo Photo',
      description: 'Exposition tirages argentiques, fresque murale collective et vernissage parents/élèves.',
      category: 'Culture',
      eventDate: '2027-05-14T16:30:00.000Z',
      budgetPlannedCents: 90000, // 900 € prévu -> 640 € dépensé
      status: 'valide' as const,
      leadUserId: president.id
    },
    {
      title: 'Collecte Hiver & Vestiaire',
      description: 'Opération solidaire d’hiver avec transport vers les associations locales.',
      category: 'Solidarité',
      eventDate: '2026-12-18T12:00:00.000Z',
      budgetPlannedCents: 40000, // 400 € prévu -> 310 € dépensé
      status: 'termine' as const,
      leadUserId: adherent.id
    }
  ];

  const insertedProjects = await db
    .insert(projects)
    .values(
      extraProjectsSpec.map((p) => ({
        ...p,
        safetyChecklistJson: JSON.stringify([
          { label: 'Autorisation chef d’établissement validée', checked: true },
          { label: 'Assurance MAIF / responsabilité civile confirmée', checked: true },
          { label: 'Point accueil et trousse de secours sur place', checked: p.status !== 'en_cours' }
        ])
      }))
    )
    .returning();

  const byTitle = Object.fromEntries(insertedProjects.map((p) => [p.title, p]));

  // Tâches et membres associés
  await db.insert(projectTasks).values(
    insertedProjects.flatMap((proj, idx) => [
      {
        projectId: proj.id,
        title: `Valider la fiche logistique — ${proj.title}`,
        status: 'done' as const,
        dueDate: '2026-11-20',
        assigneeId: president.id,
        position: 0
      },
      {
        projectId: proj.id,
        title: `Boucler les devis & prestataires`,
        status: idx % 2 === 0 ? ('doing' as const) : ('done' as const),
        dueDate: '2026-12-10',
        assigneeId: tresorier.id,
        position: 1
      },
      {
        projectId: proj.id,
        title: `Préparer affichage foyer et PRONOTE`,
        status: 'todo' as const,
        dueDate: '2027-01-15',
        assigneeId: bureau.id,
        position: 2
      }
    ])
  );

  await db.insert(projectMembers).values(
    insertedProjects.map((proj) => ({
      projectId: proj.id,
      userId: bureau.id,
      hoursLogged: 6,
      roleInProject: 'Coordination'
    }))
  );

  // 2. Volume budgétaire réaliste : 7 catégories + 2 exercices scolaires + dépassements réels
  const entriesSpec: Array<{
    projectId: number | null;
    type: 'recette' | 'depense';
    category: string;
    label: string;
    amountCents: number;
    entryDate: string;
    validated: boolean;
    fiscalYear: string;
  }> = [
    // Festival Printemps Lycéen -> 2 140 € dépensé (vs 1 800 € prévu = dépassement)
    { projectId: byTitle['Festival Printemps Lycéen'].id, type: 'depense', category: 'Prestataires', label: 'Location sonorisation & régie scène', amountCents: 115000, entryDate: '2026-11-05', validated: true, fiscalYear: '2026-2027' },
    { projectId: byTitle['Festival Printemps Lycéen'].id, type: 'depense', category: 'Événements', label: 'Achat barrières, badges & bracelets accès', amountCents: 46000, entryDate: '2026-11-06', validated: true, fiscalYear: '2026-2027' },
    { projectId: byTitle['Festival Printemps Lycéen'].id, type: 'depense', category: 'Restauration', label: 'Stock boissons & crêpes buvette', amountCents: 38000, entryDate: '2026-11-08', validated: false, fiscalYear: '2026-2027' },
    { projectId: byTitle['Festival Printemps Lycéen'].id, type: 'depense', category: 'Communication', label: 'Affiches A2 & flyers quadri', amountCents: 15000, entryDate: '2026-11-09', validated: true, fiscalYear: '2026-2027' },
    { projectId: byTitle['Festival Printemps Lycéen'].id, type: 'recette', category: 'Billetterie', label: 'Préventes en ligne Festival Printemps', amountCents: 192000, entryDate: '2026-11-10', validated: true, fiscalYear: '2026-2027' },

    // Tournoi Futsal Inter-Classes -> 545 € dépensé (vs 450 € prévu = dépassement)
    { projectId: byTitle['Tournoi Futsal Inter-Classes'].id, type: 'depense', category: 'Matériel', label: 'Ballons futsal officiels & chasubles', amountCents: 32500, entryDate: '2026-10-21', validated: true, fiscalYear: '2026-2027' },
    { projectId: byTitle['Tournoi Futsal Inter-Classes'].id, type: 'depense', category: 'Fournitures', label: 'Trophées gravés et médailles podium', amountCents: 22000, entryDate: '2026-10-24', validated: true, fiscalYear: '2026-2027' },
    { projectId: byTitle['Tournoi Futsal Inter-Classes'].id, type: 'recette', category: 'Inscriptions', label: 'Cotisations 14 équipes inter-classes', amountCents: 56000, entryDate: '2026-10-25', validated: true, fiscalYear: '2026-2027' },

    // Tournoi E-Sport & Pizza -> 610 € dépensé (vs 750 € prévu)
    { projectId: byTitle['Tournoi E-Sport & Pizza'].id, type: 'depense', category: 'Restauration', label: 'Pizzas artisanales & bouteilles jus', amountCents: 39000, entryDate: '2026-11-01', validated: true, fiscalYear: '2026-2027' },
    { projectId: byTitle['Tournoi E-Sport & Pizza'].id, type: 'depense', category: 'Matériel', label: 'Câbles HDMI, multiprises & manettes', amountCents: 22000, entryDate: '2026-11-02', validated: true, fiscalYear: '2026-2027' },
    { projectId: byTitle['Tournoi E-Sport & Pizza'].id, type: 'recette', category: 'Billetterie', label: 'Entrées joueurs & spectateurs', amountCents: 84000, entryDate: '2026-11-03', validated: true, fiscalYear: '2026-2027' },

    // Kiosque Cafétéria Solidaire -> 980 € dépensé (vs 1 200 € prévu)
    { projectId: byTitle['Kiosque Cafétéria Solidaire'].id, type: 'depense', category: 'Restauration', label: 'Approvisionnement mensuel thés, chocolats & fruits', amountCents: 68000, entryDate: '2026-10-14', validated: true, fiscalYear: '2026-2027' },
    { projectId: byTitle['Kiosque Cafétéria Solidaire'].id, type: 'depense', category: 'Matériel', label: 'Thermos inox & gobelets réutilisables consignés', amountCents: 30000, entryDate: '2026-10-16', validated: true, fiscalYear: '2026-2027' },
    { projectId: byTitle['Kiosque Cafétéria Solidaire'].id, type: 'recette', category: 'Ventes', label: 'Recette cafétéria octobre-novembre', amountCents: 134000, entryDate: '2026-11-11', validated: true, fiscalYear: '2026-2027' },

    // Semaine des Arts & Expo Photo -> 640 € dépensé (vs 900 € prévu)
    { projectId: byTitle['Semaine des Arts & Expo Photo'].id, type: 'depense', category: 'Fournitures', label: 'Tirages grand format, cadres & bombes acrylique', amountCents: 49000, entryDate: '2026-11-03', validated: true, fiscalYear: '2026-2027' },
    { projectId: byTitle['Semaine des Arts & Expo Photo'].id, type: 'depense', category: 'Communication', label: 'Livrets catalogue exposition (300 ex.)', amountCents: 15000, entryDate: '2026-11-04', validated: false, fiscalYear: '2026-2027' },

    // Collecte Hiver & Vestiaire -> 310 € dépensé (vs 400 € prévu)
    { projectId: byTitle['Collecte Hiver & Vestiaire'].id, type: 'depense', category: 'Transport', label: 'Location utilitaire livraison centre solidaire', amountCents: 19000, entryDate: '2026-10-28', validated: true, fiscalYear: '2026-2027' },
    { projectId: byTitle['Collecte Hiver & Vestiaire'].id, type: 'depense', category: 'Fournitures', label: 'Cartons de tri & étiquettes', amountCents: 12000, entryDate: '2026-10-27', validated: true, fiscalYear: '2026-2027' },

    // Projets issus du seed de base pour compléter le bar chart (>= 8 barres)
    ...(existingByTitle['Bal de promo des Terminales 2027']
      ? [
          { projectId: existingByTitle['Bal de promo des Terminales 2027'].id, type: 'depense' as const, category: 'Prestataires', label: 'Acompte traiteur buffet sucré-salé', amountCents: 145000, entryDate: '2026-11-07', validated: true, fiscalYear: '2026-2027' },
          { projectId: existingByTitle['Bal de promo des Terminales 2027'].id, type: 'depense' as const, category: 'Événements', label: 'Arche lumineuse & photobooth', amountCents: 62000, entryDate: '2026-11-10', validated: true, fiscalYear: '2026-2027' }
        ]
      : []),
    ...(existingByTitle['Collecte solidaire d’hiver']
      ? [
          { projectId: existingByTitle['Collecte solidaire d’hiver'].id, type: 'depense' as const, category: 'Communication', label: 'Affiches et bacs de collecte', amountCents: 9500, entryDate: '2026-10-19', validated: true, fiscalYear: '2026-2027' }
        ]
      : []),

    // Recettes générales et subventions
    { projectId: null, type: 'recette', category: 'Subventions', label: 'Dotation CVL / Fonds de vie lycéenne', amountCents: 250000, entryDate: '2026-09-25', validated: true, fiscalYear: '2026-2027' },
    { projectId: null, type: 'recette', category: 'Adhésions', label: 'Campagne adhésions de rentrée (142 élèves)', amountCents: 142000, entryDate: '2026-10-05', validated: true, fiscalYear: '2026-2027' },
    { projectId: null, type: 'depense', category: 'Prestataires', label: 'Cotisation annuelle assurance MAIF association', amountCents: 18500, entryDate: '2026-09-18', validated: true, fiscalYear: '2026-2027' },

    // Exercice précédent 2025-2026 pour tester le sélecteur d'exercice fiscal
    { projectId: null, type: 'recette', category: 'Adhésions', label: 'Cotisations 2025-2026 (clôturées)', amountCents: 195000, entryDate: '2025-10-12', validated: true, fiscalYear: '2025-2026' },
    { projectId: null, type: 'recette', category: 'Billetterie', label: 'Billetterie Bal de Promo 2026', amountCents: 310000, entryDate: '2026-06-18', validated: true, fiscalYear: '2025-2026' },
    { projectId: null, type: 'depense', category: 'Prestataires', label: 'Salle & DJ Bal de Promo 2026', amountCents: 220000, entryDate: '2026-06-19', validated: true, fiscalYear: '2025-2026' },
    { projectId: null, type: 'depense', category: 'Restauration', label: 'Buffet & boissons Bal 2026', amountCents: 74000, entryDate: '2026-06-19', validated: true, fiscalYear: '2025-2026' },
    { projectId: null, type: 'depense', category: 'Communication', label: 'Communication globale année 2025-2026', amountCents: 28000, entryDate: '2026-02-11', validated: true, fiscalYear: '2025-2026' }
  ];

  await db.insert(budgetEntries).values(
    entriesSpec.map((e) => ({
      projectId: e.projectId,
      type: e.type,
      category: e.category,
      label: e.label,
      amountCents: e.amountCents,
      entryDate: e.entryDate,
      createdBy: tresorier.id,
      validatedBy: e.validated ? president.id : null,
      fiscalYear: e.fiscalYear
    }))
  );

  // 3. Événements & 55 billets signés Ed25519 au format officiel MDL1.<payload>.<sig>
  const [festivalEvent, esportEvent] = await db
    .insert(events)
    .values([
      {
        projectId: byTitle['Festival Printemps Lycéen'].id,
        title: STAGING_MARKER_EVENT,
        description: 'Soirée concerts lycéens avec billetterie QR Ed25519 hors-ligne haute capacité.',
        eventDate: '2027-04-16T18:30:00.000Z',
        location: 'Cour d’honneur · Lycée Renoir',
        capacity: 300,
        priceFullCents: 800,
        priceReducedCents: 500,
        pricePresaleCents: 400,
        isPublic: true,
        stripeEnabled: false
      },
      {
        projectId: byTitle['Tournoi E-Sport & Pizza'].id,
        title: 'Tournoi E-Sport & Pizza (Staging)',
        description: 'Tournoi inter-lycées — billets QR pour test batch scanner.',
        eventDate: '2027-03-05T18:00:00.000Z',
        location: 'Salle polyvalente',
        capacity: 120,
        priceFullCents: 600,
        priceReducedCents: 400,
        pricePresaleCents: 300,
        isPublic: true,
        stripeEnabled: false
      }
    ])
    .returning();

  const ticketValues = Array.from({ length: 55 }, (_, idx) => {
    const num = idx + 1;
    const ev = idx < 35 ? festivalEvent : esportEvent;
    const buyerName = `${STUDENT_NAMES[idx % STUDENT_NAMES.length]} #${String(num).padStart(2, '0')}`;
    const buyerEmail = `eleve.staging.${num}@lycee-renoir.fr`;
    const tier = idx % 3 === 0 ? ('plein' as const) : idx % 3 === 1 ? ('reduit' as const) : ('prevente' as const);
    const priceCents =
      tier === 'plein' ? ev.priceFullCents : tier === 'reduit' ? ev.priceReducedCents : ev.pricePresaleCents;
    const qrCodeId = `MDL-STG-${String(num).padStart(4, '0')}`;

    // Billets 1..48 : payés et non scannés (prêts pour test scanner volume hors-ligne)
    // Billets 49..52 : déjà scannés (test anti-double-scan serveur)
    // Billets 53..55 : annulés (test refus billet annulé)
    const isAlreadyScanned = num >= 49 && num <= 52;
    const isCancelled = num >= 53;

    return {
      eventId: ev.id,
      buyerUserId: adherent.id,
      buyerName,
      buyerEmailEncrypted: encryptText(buyerEmail),
      buyerEmailHash: hmacLookup(buyerEmail),
      buyerClasse: CLASSES[idx % CLASSES.length],
      tier,
      priceCents,
      paymentMethod: idx % 2 === 0 ? ('stripe' as const) : ('especes' as const),
      paymentStatus: isCancelled ? ('annule' as const) : ('paye' as const),
      qrCodeId,
      ed25519Token: '',
      jwtToken: '',
      scannedAt: isAlreadyScanned ? '2026-11-12T19:15:00.000Z' : null,
      scannedBy: isAlreadyScanned ? bureau.id : null
    };
  });

  const insertedTickets = await db.insert(tickets).values(ticketValues).returning();

  // Signer chaque billet avec son tid réel pour compatibilité exacte WASM Ed25519 (MDL1.<payload>.<sig>)
  for (const t of insertedTickets) {
    const payload = { tid: t.id, eid: t.eventId, qrid: t.qrCodeId, tier: t.tier };
    await db
      .update(tickets)
      .set({
        ed25519Token: signTicketEd25519Qr(payload),
        jwtToken: signTicketJwt(payload)
      })
      .where(eq(tickets.id, t.id));
  }

  console.log('Seed volumétrique staging MDL Connect terminé :');
  console.log(`- ${insertedProjects.length} projets ajoutés (+ base = ${existingProjects.length + insertedProjects.length} projets)`);
  console.log(`- ${entriesSpec.length} écritures comptables (7 catégories, exercices 2025-2026 & 2026-2027)`);
  console.log(`- ${insertedTickets.length} billets signés Ed25519 (MDL1.* : 48 valides à scanner, 4 déjà scannés, 3 annulés)`);

  return { skipped: false };
}

const isCliEntry =
  process.argv[1]?.endsWith('seed-staging.ts') || process.argv[1]?.endsWith('seed-staging.js');

if (isCliEntry) {
  seedStagingVolume()
    .catch((error) => {
      console.error('Erreur lors du seed staging :', error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await closeDb();
    });
}
