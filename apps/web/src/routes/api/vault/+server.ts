import fs from 'node:fs/promises';
import path from 'node:path';
import { error, json } from '@sveltejs/kit';
import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { appendAuditLog } from '$lib/server/audit';
import { requireAuth } from '$lib/server/auth';
import { db } from '$lib/server/db';
import { users, VAULT_CATEGORIES, vaultDocuments } from '$lib/server/db/schema';
import {
  parseJsonBody,
  parsePositiveIntId,
  sanitizeFilename,
  validateWithSchema
} from '$lib/server/http';
import { readEncryptedUpload, saveEncryptedUpload } from '$lib/server/uploads';
import type { RequestHandler } from './$types';

const vaultMetaSchema = z.object({
  title: z.string().trim().min(2, 'Titre requis').max(140),
  category: z.enum(VAULT_CATEGORIES)
});

const vaultDeleteSchema = z.object({
  id: z.number().int().positive()
});

export const GET: RequestHandler = async (event) => {
  const user = requireAuth(event, 'vault:read');

  const downloadId = event.url.searchParams.get('download');
  if (downloadId !== null) {
    const docId = parsePositiveIntId(downloadId, 'Document');
    const [doc] = await db
      .select()
      .from(vaultDocuments)
      .where(eq(vaultDocuments.id, docId))
      .limit(1);

    if (!doc) {
      throw error(404, 'Document introuvable dans le coffre-fort.');
    }

    let decrypted: Buffer;
    try {
      decrypted = await readEncryptedUpload(doc.filePath);
    } catch {
      throw error(404, 'Fichier chiffré introuvable ou corrompu.');
    }

    await appendAuditLog({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'vault:download',
      targetType: 'vault_document',
      targetId: doc.id,
      details: { title: doc.title, category: doc.category }
    });

    const safeName = sanitizeFilename(doc.title || `document-${doc.id}`);
    return new Response(new Uint8Array(decrypted), {
      status: 200,
      headers: {
        'Content-Type': doc.mimeType,
        'Content-Disposition': `attachment; filename="${safeName}"`,
        'X-Content-Type-Options': 'nosniff'
      }
    });
  }

  const rows = await db
    .select({
      id: vaultDocuments.id,
      title: vaultDocuments.title,
      category: vaultDocuments.category,
      mimeType: vaultDocuments.mimeType,
      sizeBytes: vaultDocuments.sizeBytes,
      encrypted: vaultDocuments.encrypted,
      uploadedBy: vaultDocuments.uploadedBy,
      uploaderFirstName: users.firstName,
      uploaderLastName: users.lastName,
      createdAt: vaultDocuments.createdAt
    })
    .from(vaultDocuments)
    .innerJoin(users, eq(vaultDocuments.uploadedBy, users.id))
    .orderBy(desc(vaultDocuments.createdAt), desc(vaultDocuments.id));

  return json({
    documents: rows.map((d) => ({
      ...d,
      downloadUrl: `/api/vault?download=${d.id}`
    }))
  });
};

export const POST: RequestHandler = async (event) => {
  const user = requireAuth(event, 'vault:write');
  const contentType = event.request.headers.get('content-type') || '';

  if (!contentType.includes('multipart/form-data')) {
    throw error(400, 'Requête multipart/form-data attendue pour le téléversement.');
  }

  const formData = await event.request.formData();
  const meta = validateWithSchema(
    {
      title: formData.get('title'),
      category: formData.get('category')
    },
    vaultMetaSchema
  );

  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) {
    throw error(400, 'Fichier manquant ou vide.');
  }

  let saved: { relativePath: string; mimeType: string; sizeBytes: number };
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    saved = await saveEncryptedUpload('vault', bytes, file.type, 16 * 1024 * 1024);
  } catch (err) {
    throw error(400, err instanceof Error ? err.message : 'Erreur lors du chiffrement du fichier.');
  }

  const [created] = await db
    .insert(vaultDocuments)
    .values({
      title: meta.title,
      category: meta.category,
      filePath: saved.relativePath,
      mimeType: saved.mimeType,
      sizeBytes: saved.sizeBytes,
      encrypted: true,
      uploadedBy: user.id
    })
    .returning();

  await appendAuditLog({
    actorUserId: user.id,
    actorRole: user.role,
    action: 'vault:upload',
    targetType: 'vault_document',
    targetId: created.id,
    details: { title: created.title, category: created.category, sizeBytes: created.sizeBytes }
  });

  return json(
    {
      document: {
        id: created.id,
        title: created.title,
        category: created.category,
        mimeType: created.mimeType,
        sizeBytes: created.sizeBytes,
        encrypted: created.encrypted,
        uploadedBy: created.uploadedBy,
        createdAt: created.createdAt,
        downloadUrl: `/api/vault?download=${created.id}`
      }
    },
    { status: 201 }
  );
};

export const DELETE: RequestHandler = async (event) => {
  const user = requireAuth(event, 'passation:manage');
  const queryId = event.url.searchParams.get('id');
  const docId = queryId
    ? parsePositiveIntId(queryId, 'Document')
    : (await parseJsonBody(event.request, vaultDeleteSchema)).id;

  const [deleted] = await db
    .delete(vaultDocuments)
    .where(eq(vaultDocuments.id, docId))
    .returning();

  if (!deleted) {
    throw error(404, 'Document introuvable.');
  }

  const root = path.resolve(process.env.UPLOADS_DIR || './data/uploads');
  const resolved = path.resolve(root, deleted.filePath);
  if (resolved.startsWith(root + path.sep)) {
    await fs.unlink(resolved).catch(() => undefined);
  }

  await appendAuditLog({
    actorUserId: user.id,
    actorRole: user.role,
    action: 'vault:delete',
    targetType: 'vault_document',
    targetId: deleted.id,
    details: { title: deleted.title, category: deleted.category }
  });

  return json({ deleted: true, id: deleted.id });
};
