import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const ALLOWED_MIMES = new Map<string, string>([
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp'],
  ['application/pdf', '.pdf']
]);

function getUploadsRoot(): string {
  return path.resolve(process.env.UPLOADS_DIR || './data/uploads');
}

function getFileEncryptionKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY?.trim();
  if (raw && /^[0-9a-fA-F]{64}$/.test(raw)) {
    return Buffer.from(raw, 'hex');
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error('ENCRYPTION_KEY (64 hex chars) is required in production.');
  }
  return createHash('sha256').update(raw || 'mdl-dev-upload-key').digest();
}

function detectMimeFromMagicBytes(buf: Buffer): string | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47
  ) {
    return 'image/png';
  }
  if (
    buf.length >= 12 &&
    buf.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buf.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }
  if (buf.length >= 4 && buf.subarray(0, 4).toString('ascii') === '%PDF') {
    return 'application/pdf';
  }
  return null;
}

export async function saveEncryptedUpload(
  folder: 'receipts' | 'vault',
  rawBytes: Uint8Array,
  declaredMime: string,
  maxBytes = 8 * 1024 * 1024
): Promise<{ relativePath: string; mimeType: string; sizeBytes: number }> {
  if (rawBytes.byteLength === 0 || rawBytes.byteLength > maxBytes) {
    throw new Error(`Taille de fichier invalide (max ${Math.round(maxBytes / 1024 / 1024)} Mo).`);
  }

  const buf = Buffer.from(rawBytes);
  const detectedMime = detectMimeFromMagicBytes(buf);
  const mimeType = detectedMime ?? declaredMime;
  const ext = ALLOWED_MIMES.get(mimeType);
  if (!ext || !detectedMime) {
    throw new Error('Format non autorisé. Seuls JPEG, PNG, WebP et PDF valides sont acceptés.');
  }

  const dir = path.join(getUploadsRoot(), folder);
  await fs.mkdir(dir, { recursive: true });

  const fileName = `${randomUUID()}${ext}.enc`;
  const fullPath = path.join(dir, fileName);

  const key = getFileEncryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(buf), cipher.final()]);
  const tag = cipher.getAuthTag();

  // Format binaire: [12 octets IV][16 octets Tag][données chiffrées]
  const outBuf = Buffer.concat([iv, tag, encrypted]);
  await fs.writeFile(fullPath, outBuf);

  return {
    relativePath: `${folder}/${fileName}`,
    mimeType,
    sizeBytes: buf.byteLength
  };
}

export async function readEncryptedUpload(relativePath: string): Promise<Buffer> {
  const root = getUploadsRoot();
  const resolved = path.resolve(root, relativePath);
  if (!resolved.startsWith(root + path.sep)) {
    throw new Error('Chemin de fichier interdit.');
  }
  const raw = await fs.readFile(resolved);
  if (raw.byteLength < 28) {
    throw new Error('Fichier chiffré corrompu.');
  }
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const ciphertext = raw.subarray(28);

  const key = getFileEncryptionKey();
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}
