import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ensureMigrated } from './db';
import { checkRateLimit } from './rate-limit';
import { readEncryptedUpload, saveEncryptedUpload } from './uploads';

let tempUploadsDir = '';

describe('rate limiting & encrypted upload storage', () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = 'pglite://memory';
    tempUploadsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mdl-uploads-test-'));
    process.env.UPLOADS_DIR = tempUploadsDir;
    await ensureMigrated();
  });

  afterAll(async () => {
    if (tempUploadsDir) {
      await fs.rm(tempUploadsDir, { recursive: true, force: true });
    }
  });

  it('enforces rate limit threshold and blocks excess attempts', async () => {
    const key = `test-rl-${Date.now()}`;
    const r1 = await checkRateLimit(key, 2, 60_000);
    const r2 = await checkRateLimit(key, 2, 60_000);
    const r3 = await checkRateLimit(key, 2, 60_000);

    expect(r1.allowed).toBe(true);
    expect(r1.remaining).toBe(1);
    expect(r2.allowed).toBe(true);
    expect(r2.remaining).toBe(0);
    expect(r3.allowed).toBe(false);
    expect(r3.retryAfterSeconds).toBeGreaterThanOrEqual(1);
  });

  it('encrypts valid PDF/JPEG uploads at rest and rejects disguised scripts', async () => {
    const fakePdf = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF', 'ascii');
    const saved = await saveEncryptedUpload('vault', fakePdf, 'application/pdf');
    expect(saved.relativePath.endsWith('.pdf.enc')).toBe(true);

    const diskCipher = await fs.readFile(path.join(tempUploadsDir, saved.relativePath));
    expect(diskCipher.includes(Buffer.from('%PDF-1.4'))).toBe(false);

    const decrypted = await readEncryptedUpload(saved.relativePath);
    expect(decrypted.equals(fakePdf)).toBe(true);

    await expect(
      saveEncryptedUpload('receipts', Buffer.from('<script>alert(1)</script>'), 'image/jpeg')
    ).rejects.toThrow(/Format non autorisé/);
  });
});
