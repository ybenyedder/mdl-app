import { json } from '@sveltejs/kit';
import { and, eq, isNull, ne } from 'drizzle-orm';
import { z } from 'zod';
import { appendAuditLog } from '$lib/server/audit';
import { requireAuth } from '$lib/server/auth';
import { verifyEd25519Payload } from '$lib/server/crypto';
import { db } from '$lib/server/db';
import { tickets } from '$lib/server/db/schema';
import { parseJsonBody } from '$lib/server/http';
import { verifyTicketEd25519Qr } from '$lib/server/tickets';
import type { RequestHandler } from './$types';

const singleScanSchema = z.object({
  qrText: z.string().trim().min(5).max(4096),
  scannedAt: z.string().trim().optional()
});

const batchScanSchema = z.object({
  scans: z.array(singleScanSchema).min(1).max(500)
});

const scanRequestSchema = z.union([batchScanSchema, singleScanSchema]);

interface VerifiedQrRefs {
  qrid: string;
  eid: number;
}

function verifyQrEd25519(qrText: string): VerifiedQrRefs | null {
  const standard = verifyTicketEd25519Qr(qrText);
  if (standard) {
    return { qrid: standard.qrid, eid: standard.eid };
  }

  // Compatibilité avec les billets Ed25519 générés par seed.ts (<payloadB64Url>.<sigB64Url>)
  const parts = qrText.trim().split('.');
  if (parts.length === 2) {
    const [payloadB64Url, sigB64Url] = parts;
    if (!verifyEd25519Payload(payloadB64Url, sigB64Url)) {
      return null;
    }
    try {
      const parsed = JSON.parse(Buffer.from(payloadB64Url, 'base64url').toString('utf8')) as {
        jti?: string;
        qrid?: string;
        eid?: number;
      };
      const qrid = parsed.qrid || parsed.jti;
      if (!qrid || typeof parsed.eid !== 'number') return null;
      return { qrid, eid: parsed.eid };
    } catch {
      return null;
    }
  }

  return null;
}

async function processSingleScan(
  qrText: string,
  rawScannedAt: string | undefined,
  scannerUserId: number
) {
  const verified = verifyQrEd25519(qrText);
  if (!verified) {
    return {
      ok: false,
      valid: false,
      status: 'invalid_signature' as const,
      message: 'Signature Ed25519 invalide ou billet falsifié.'
    };
  }

  let scanIso = new Date().toISOString();
  if (rawScannedAt) {
    const parsedDate = new Date(rawScannedAt);
    if (!Number.isNaN(parsedDate.getTime())) {
      scanIso = parsedDate.toISOString();
    }
  }

  const updated = await db
    .update(tickets)
    .set({
      scannedAt: scanIso,
      scannedBy: scannerUserId
    })
    .where(
      and(
        eq(tickets.qrCodeId, verified.qrid),
        eq(tickets.eventId, verified.eid),
        isNull(tickets.scannedAt),
        ne(tickets.paymentStatus, 'annule')
      )
    )
    .returning();

  if (updated.length === 1) {
    const t = updated[0];
    return {
      ok: true,
      valid: true,
      status: 'valid' as const,
      message: `Billet valide (${t.buyerName}).`,
      ticket: {
        id: t.id,
        eventId: t.eventId,
        qrCodeId: t.qrCodeId,
        buyerName: t.buyerName,
        buyerClasse: t.buyerClasse,
        tier: t.tier,
        paymentStatus: t.paymentStatus,
        scannedAt: t.scannedAt
      }
    };
  }

  const [existing] = await db
    .select()
    .from(tickets)
    .where(and(eq(tickets.qrCodeId, verified.qrid), eq(tickets.eventId, verified.eid)))
    .limit(1);

  if (!existing) {
    return {
      ok: false,
      valid: false,
      status: 'not_found' as const,
      qrCodeId: verified.qrid,
      message: 'Billet inconnu en base de données.'
    };
  }

  if (existing.paymentStatus === 'annule') {
    return {
      ok: false,
      valid: false,
      status: 'cancelled' as const,
      qrCodeId: existing.qrCodeId,
      message: 'Ce billet a été annulé.'
    };
  }

  return {
    ok: false,
    valid: false,
    status: 'already_scanned' as const,
    qrCodeId: existing.qrCodeId,
    scannedAt: existing.scannedAt,
    message: `Billet déjà scanné le ${existing.scannedAt}.`,
    ticket: {
      id: existing.id,
      eventId: existing.eventId,
      qrCodeId: existing.qrCodeId,
      buyerName: existing.buyerName,
      buyerClasse: existing.buyerClasse,
      tier: existing.tier,
      paymentStatus: existing.paymentStatus,
      scannedAt: existing.scannedAt
    }
  };
}

export const POST: RequestHandler = async (event) => {
  const user = requireAuth(event, 'tickets:scan');
  const body = await parseJsonBody(event.request, scanRequestSchema);

  if ('scans' in body) {
    const results = [];
    for (const item of body.scans) {
      results.push(await processSingleScan(item.qrText, item.scannedAt, user.id));
    }

    const validCount = results.filter((r) => r.ok).length;
    await appendAuditLog({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'ticket:scan_batch',
      targetType: 'ticket',
      details: { total: results.length, validCount }
    });

    return json({
      total: results.length,
      validCount,
      rejectedCount: results.length - validCount,
      results
    });
  }

  const result = await processSingleScan(body.qrText, body.scannedAt, user.id);

  await appendAuditLog({
    actorUserId: user.id,
    actorRole: user.role,
    action: 'ticket:scan',
    targetType: 'ticket',
    targetId: result.ticket?.id ?? null,
    details: { status: result.status, qrCodeId: result.qrCodeId ?? result.ticket?.qrCodeId ?? null }
  });

  return json(result);
};
