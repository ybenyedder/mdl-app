import { createHmac } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.DATABASE_URL = 'pglite://memory';
});

import { encryptText, hmacLookup } from './crypto';
import {
  budgetEntries,
  closeDb,
  db,
  ensureMigrated,
  events,
  meetingAttendances,
  meetings,
  merchItems,
  merchOrders,
  schoolSettings,
  tickets,
  users
} from './db';
import { seedDatabase } from './db/seed';
import { generateEstablishmentAccordPdf, generateMeetingMinutesPdf } from './pdf';
import {
  fulfillStripeCheckoutSession,
  getStripeConfig,
  maskSecretHint,
  verifyStripeWebhookSignature
} from './stripe';

describe('merch, meetings, stripe & PDF extensions (pglite://memory)', () => {
  beforeAll(async () => {
    await ensureMigrated();
    await seedDatabase();
  });

  afterAll(async () => {
    await closeDb();
  });

  it('seeds demo merchItems, meetings and meetingAttendances cleanly', async () => {
    const items = await db.select().from(merchItems);
    expect(items.length).toBeGreaterThanOrEqual(2);
    expect(items.some((i) => i.title.includes('Pull'))).toBe(true);

    const mtgs = await db.select().from(meetings);
    expect(mtgs.length).toBeGreaterThanOrEqual(2);

    const atts = await db.select().from(meetingAttendances);
    expect(atts.length).toBeGreaterThanOrEqual(1);
  });

  it('stores encrypted Stripe keys in schoolSettings, decrypts via getStripeConfig, and masks hint', async () => {
    const fakeSecret = 'sk_test_0000_fake_3456';
    const fakeWhsec = 'whsec_ExampleWebhookSecret999';

    expect(maskSecretHint(fakeSecret)).toBe('sk_test_••••3456');
    expect(maskSecretHint('short')).toBe('shor••••');

    const [settingsRow] = await db.select().from(schoolSettings).limit(1);
    expect(settingsRow).toBeDefined();

    await db
      .update(schoolSettings)
      .set({
        stripeEnabled: true,
        stripePublishableKey: 'pk_test_51ExamplePubKey',
        stripeSecretKeyEncrypted: encryptText(fakeSecret),
        stripeWebhookSecretEncrypted: encryptText(fakeWhsec),
        stripeCurrency: 'eur'
      })
      .where(eq(schoolSettings.id, settingsRow.id));

    const resolved = await getStripeConfig();
    expect(resolved.enabled).toBe(true);
    expect(resolved.publishableKey).toBe('pk_test_51ExamplePubKey');
    expect(resolved.secretKey).toBe(fakeSecret);
    expect(resolved.webhookSecret).toBe(fakeWhsec);
    expect(resolved.currency).toBe('eur');
  });

  it('verifies Stripe webhook HMAC signatures and rejects tampering or expired timestamps', () => {
    const secret = 'whsec_test_signing_secret';
    const payload = JSON.stringify({ id: 'evt_1', type: 'checkout.session.completed' });
    const ts = Math.floor(Date.now() / 1000);
    const sig = createHmac('sha256', secret).update(`${ts}.${payload}`, 'utf8').digest('hex');

    expect(verifyStripeWebhookSignature(payload, `t=${ts},v1=${sig}`, secret)).toBe(true);
    expect(verifyStripeWebhookSignature(`${payload} `, `t=${ts},v1=${sig}`, secret)).toBe(false);

    const oldTs = ts - 600;
    const oldSig = createHmac('sha256', secret).update(`${oldTs}.${payload}`, 'utf8').digest('hex');
    expect(verifyStripeWebhookSignature(payload, `t=${oldTs},v1=${oldSig}`, secret)).toBe(false);
  });

  it('idempotently fulfills Stripe checkout sessions for guest ticket, merch order, and adhesion', async () => {
    // 1. Merch order fulfillment
    const [pull] = await db.select().from(merchItems).limit(1);
    const [order] = await db
      .insert(merchOrders)
      .values({
        itemId: pull.id,
        buyerUserId: null,
        buyerName: 'Léa Invitée',
        buyerEmailEncrypted: encryptText('lea.invitee@lycee.fr'),
        buyerEmailHash: hmacLookup('lea.invitee@lycee.fr'),
        buyerClasse: '1ère G1',
        size: 'M',
        quantity: 2,
        unitPriceCents: pull.priceCents,
        totalCents: pull.priceCents * 2,
        paymentMethod: 'stripe',
        paymentStatus: 'en_attente',
        orderStatus: 'precommande',
        lookupCode: 'ORD-TEST-001'
      })
      .returning();

    const f1 = await fulfillStripeCheckoutSession({
      id: 'cs_test_merch_1',
      url: 'https://checkout.stripe.com/test',
      payment_status: 'paid',
      metadata: { kind: 'merch_order', orderId: String(order.id) }
    });
    expect(f1.fulfilled).toBe(true);

    // Second call must be idempotent (no duplicate budget entry)
    const beforeBudgetCount = (await db.select().from(budgetEntries)).length;
    const f1Repeat = await fulfillStripeCheckoutSession({
      id: 'cs_test_merch_1',
      url: 'https://checkout.stripe.com/test',
      payment_status: 'paid',
      metadata: { kind: 'merch_order', orderId: String(order.id) }
    });
    expect(f1Repeat.fulfilled).toBe(false);
    expect((await db.select().from(budgetEntries)).length).toBe(beforeBudgetCount);

    // 2. Guest ticket fulfillment
    const [ev] = await db.select().from(events).limit(1);
    const [guestTicket] = await db
      .insert(tickets)
      .values({
        eventId: ev.id,
        buyerUserId: null,
        buyerName: 'Tom Externe',
        buyerEmailEncrypted: encryptText('tom.ext@lycee.fr'),
        buyerEmailHash: hmacLookup('tom.ext@lycee.fr'),
        buyerClasse: '2nde 2',
        tier: 'plein',
        priceCents: 800,
        paymentMethod: 'stripe',
        paymentStatus: 'en_attente',
        qrCodeId: 'QR-GUEST-1',
        ed25519Token: 'token-guest-1',
        lookupToken: 'lookup-guest-1'
      })
      .returning();

    const fTicket = await fulfillStripeCheckoutSession({
      id: 'cs_test_ticket_1',
      url: 'https://checkout.stripe.com/test',
      payment_status: 'paid',
      metadata: { kind: 'ticket', ticketId: String(guestTicket.id) }
    });
    expect(fTicket.fulfilled).toBe(true);

    const [updatedTicket] = await db
      .select()
      .from(tickets)
      .where(eq(tickets.id, guestTicket.id))
      .limit(1);
    expect(updatedTicket.paymentStatus).toBe('paye');

    // 3. Direct adhesion fulfillment upgrades 'invite' -> 'adherent'
    const [guestUser] = await db
      .select()
      .from(users)
      .where(eq(users.role, 'invite'))
      .limit(1);
    expect(guestUser).toBeDefined();

    const fAdh = await fulfillStripeCheckoutSession({
      id: 'cs_test_adh_1',
      url: 'https://checkout.stripe.com/test',
      payment_status: 'paid',
      metadata: { kind: 'adhesion', userId: String(guestUser.id) }
    });
    expect(fAdh.fulfilled).toBe(true);

    const [upgraded] = await db.select().from(users).where(eq(users.id, guestUser.id)).limit(1);
    expect(upgraded.isAdherent).toBe(true);
    expect(upgraded.role).toBe('adherent');
  });

  it('generates valid PDFs for meeting minutes and establishment accord letter', async () => {
    const minutesPdf = await generateMeetingMinutesPdf({
      schoolName: 'Lycée Renoir',
      mdlName: 'MDL Renoir',
      title: 'Réunion bureau octobre',
      scheduledAt: '2026-11-18T12:30:00Z',
      location: 'Foyer MDL',
      scope: 'bureau',
      agenda: [{ title: 'Validation pulls', durationMin: 15, done: true }],
      attendees: [{ name: 'Camille Dupont', roleLabel: 'Président', rsvpStatus: 'present', checkedIn: true }],
      minutesText: 'Accord unanime pour lancer les précommandes en zéro avance.'
    });
    expect(Buffer.from(minutesPdf.slice(0, 5)).toString('ascii')).toBe('%PDF-');

    const accordPdf = await generateEstablishmentAccordPdf({
      schoolName: 'Lycée Renoir',
      mdlName: 'MDL Renoir',
      schoolYear: '2026-2027',
      legalRepresentative: 'Mme Claire Moreau (Proviseure)',
      presidentName: 'Camille Dupont',
      bodyText: 'Demande officielle d’autorisation pour les actions MDL 2026-2027.'
    });
    expect(Buffer.from(accordPdf.slice(0, 5)).toString('ascii')).toBe('%PDF-');
  });
});
