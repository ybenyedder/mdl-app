import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  createPrivateKey,
  createPublicKey,
  randomBytes,
  sign,
  timingSafeEqual,
  verify,
  type KeyObject
} from 'node:crypto';
import { hash as argon2Hash, verify as argon2Verify, type Options as Argon2Options } from '@node-rs/argon2';

const CIPHER_VERSION = 'v1';
const AES_ALGORITHM = 'aes-256-gcm';
const IV_LENGTH_BYTES = 12;
const AUTH_TAG_LENGTH_BYTES = 16;

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const TOTP_STEP_SECONDS = 30;
const TOTP_DIGITS = 6;
const TOTP_WINDOW = 1;

const ARGON2_OPTIONS: Argon2Options = {
  algorithm: 2, // Argon2id (const enum value = 2, compatible isolatedModules)
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1
};

const DEV_FALLBACK_SEED = 'mdl-connect-dev-insecure-key-change-in-production';

function resolveMasterKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY?.trim();

  if (!raw) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('ENCRYPTION_KEY environment variable is required in production.');
    }
    return createHash('sha256').update(DEV_FALLBACK_SEED, 'utf8').digest();
  }

  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    return Buffer.from(raw, 'hex');
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error('ENCRYPTION_KEY must be a 64-character hexadecimal string (32 bytes) in production.');
  }

  return createHash('sha256').update(raw, 'utf8').digest();
}

function resolveHmacKey(): Buffer {
  const explicit = process.env.LOOKUP_HMAC_KEY?.trim();
  if (explicit) {
    if (/^[0-9a-fA-F]{64}$/.test(explicit)) {
      return Buffer.from(explicit, 'hex');
    }
    return createHash('sha256').update(explicit, 'utf8').digest();
  }

  // Domain separation from the AES-256-GCM encryption key
  return createHmac('sha256', resolveMasterKey()).update('mdl-lookup-hmac-v1', 'utf8').digest();
}

export function encryptText(plain: string): string {
  const key = resolveMasterKey();
  const iv = randomBytes(IV_LENGTH_BYTES);
  const cipher = createCipheriv(AES_ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH_BYTES
  });

  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `${CIPHER_VERSION}:${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decryptText(cipher: string): string {
  const parts = cipher.split(':');
  if (parts.length !== 4 || parts[0] !== CIPHER_VERSION) {
    throw new Error('Invalid encrypted payload format.');
  }

  const [, ivHex, tagHex, dataHex] = parts;
  if (
    !/^[0-9a-fA-F]+$/.test(ivHex) ||
    !/^[0-9a-fA-F]+$/.test(tagHex) ||
    (dataHex.length > 0 && !/^[0-9a-fA-F]+$/.test(dataHex))
  ) {
    throw new Error('Invalid hexadecimal encoding in encrypted payload.');
  }

  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(tagHex, 'hex');
  const encryptedData = Buffer.from(dataHex, 'hex');

  if (iv.length !== IV_LENGTH_BYTES || authTag.length !== AUTH_TAG_LENGTH_BYTES) {
    throw new Error('Invalid IV or authentication tag length.');
  }

  const key = resolveMasterKey();
  const decipher = createDecipheriv(AES_ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH_BYTES
  });
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([decipher.update(encryptedData), decipher.final()]);
  return decrypted.toString('utf8');
}

export function hmacLookup(value: string): string {
  const normalized = value.trim().toLowerCase();
  return createHmac('sha256', resolveHmacKey()).update(normalized, 'utf8').digest('hex');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function generateRandomToken(byteLength = 32): string {
  return randomBytes(byteLength).toString('base64url');
}

export async function hashPassword(password: string): Promise<string> {
  return argon2Hash(password, ARGON2_OPTIONS);
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  if (!hash || !password) {
    return false;
  }
  try {
    return await argon2Verify(hash, password, ARGON2_OPTIONS);
  } catch {
    return false;
  }
}

export function base32Encode(buffer: Buffer): string {
  if (buffer.length === 0) {
    return '';
  }

  let bits = 0;
  let value = 0;
  let output = '';

  for (let i = 0; i < buffer.length; i++) {
    const byte = buffer[i];
    value = (value << 8) | byte;
    bits += 8;

    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }

  return output;
}

export function base32Decode(encoded: string): Buffer {
  const cleaned = encoded.toUpperCase().replace(/[\s=-]+$/g, '').replace(/[\s-]/g, '');
  if (cleaned.length === 0) {
    return Buffer.alloc(0);
  }

  let bits = 0;
  let value = 0;
  const bytes: number[] = [];

  for (let i = 0; i < cleaned.length; i++) {
    const char = cleaned[i];
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx === -1) {
      throw new Error(`Invalid Base32 character: ${char}`);
    }

    value = (value << 5) | idx;
    bits += 5;

    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }

  return Buffer.from(bytes);
}

export function generateTotpSecret(byteLength = 20): string {
  return base32Encode(randomBytes(byteLength));
}

export function generateTotpUri(secret: string, email: string, issuer = 'MDL Connect'): string {
  const normalizedSecret = secret.toUpperCase().replace(/[\s=]/g, '');
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(email.trim())}`;
  const params = new URLSearchParams({
    secret: normalizedSecret,
    issuer,
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_STEP_SECONDS)
  });

  return `otpauth://totp/${label}?${params.toString()}`;
}

function computeHotp(secretKey: Buffer, counter: number): string {
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigUInt64BE(BigInt(counter), 0);

  const hmac = createHmac('sha1', secretKey).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binaryCode =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  const otp = binaryCode % 10 ** TOTP_DIGITS;
  return otp.toString().padStart(TOTP_DIGITS, '0');
}

export function verifyTotpCode(secret: string, code: string, timestampMs = Date.now()): boolean {
  const normalizedCode = code.replace(/\s+/g, '');
  if (!/^\d{6}$/.test(normalizedCode)) {
    return false;
  }

  let secretKey: Buffer;
  try {
    secretKey = base32Decode(secret);
  } catch {
    return false;
  }

  if (secretKey.length === 0) {
    return false;
  }

  const currentCounter = Math.floor(timestampMs / 1000 / TOTP_STEP_SECONDS);
  const targetBuf = Buffer.from(normalizedCode, 'utf8');

  for (let delta = -TOTP_WINDOW; delta <= TOTP_WINDOW; delta++) {
    const stepCounter = currentCounter + delta;
    if (stepCounter < 0) {
      continue;
    }
    const candidate = computeHotp(secretKey, stepCounter);
    const candidateBuf = Buffer.from(candidate, 'utf8');
    if (candidateBuf.length === targetBuf.length && timingSafeEqual(candidateBuf, targetBuf)) {
      return true;
    }
  }

  return false;
}

const ED25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
const ED25519_RAW_KEY_BYTES = 32;
const ED25519_SIGNATURE_BYTES = 64;

export interface TicketEd25519Keys {
  privateKey: KeyObject;
  publicKey: KeyObject;
  privateKeyPkcs8Pem: string;
  publicKeyHex: string;
}

let cachedEd25519Entry: { seedHex: string; keys: TicketEd25519Keys } | null = null;

export function getSessionSecret(): string {
  const raw = process.env.SESSION_SECRET?.trim() || process.env.ENCRYPTION_KEY?.trim();
  if (!raw) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('SESSION_SECRET or ENCRYPTION_KEY environment variable is required in production.');
    }
    return DEV_FALLBACK_SEED;
  }
  return raw;
}

function resolveEd25519Seed(): Buffer {
  const envSeed = process.env.TICKET_ED25519_PRIVATE_KEY_HEX?.trim();
  if (envSeed) {
    if (!/^[0-9a-fA-F]{64}$/.test(envSeed)) {
      throw new Error(
        'TICKET_ED25519_PRIVATE_KEY_HEX must be a 64-character hexadecimal string (32-byte Ed25519 seed).'
      );
    }
    return Buffer.from(envSeed, 'hex');
  }

  return createHash('sha256').update(getSessionSecret(), 'utf8').digest();
}

export function getTicketEd25519Keys(): TicketEd25519Keys {
  const seed = resolveEd25519Seed();
  const seedHex = seed.toString('hex');

  if (cachedEd25519Entry && cachedEd25519Entry.seedHex === seedHex) {
    return cachedEd25519Entry.keys;
  }

  const pkcs8Der = Buffer.concat([ED25519_PKCS8_PREFIX, seed]);
  const privateKey = createPrivateKey({ key: pkcs8Der, format: 'der', type: 'pkcs8' });
  const publicKey = createPublicKey(privateKey);
  const spkiDer = publicKey.export({ format: 'der', type: 'spki' });
  const rawPublicKey = spkiDer.subarray(ED25519_SPKI_PREFIX.length);

  if (rawPublicKey.length !== ED25519_RAW_KEY_BYTES) {
    throw new Error('Unexpected Ed25519 SPKI public key length.');
  }

  const keys: TicketEd25519Keys = {
    privateKey,
    publicKey,
    privateKeyPkcs8Pem: privateKey.export({ format: 'pem', type: 'pkcs8' }) as string,
    publicKeyHex: rawPublicKey.toString('hex')
  };

  cachedEd25519Entry = { seedHex, keys };
  return keys;
}

export function signEd25519Payload(payloadB64Url: string): string {
  const { privateKey } = getTicketEd25519Keys();
  const signature = sign(null, Buffer.from(payloadB64Url, 'utf8'), privateKey);
  return signature.toString('base64url');
}

export function verifyEd25519Payload(
  payloadB64Url: string,
  sigB64Url: string,
  pubKeyHex?: string
): boolean {
  if (!payloadB64Url || !sigB64Url || !/^[A-Za-z0-9_-]+$/.test(sigB64Url)) {
    return false;
  }

  try {
    const sigBuf = Buffer.from(sigB64Url, 'base64url');
    if (sigBuf.length !== ED25519_SIGNATURE_BYTES) {
      return false;
    }

    let verifyingKey: KeyObject;
    if (pubKeyHex !== undefined) {
      const trimmedHex = pubKeyHex.trim();
      if (!/^[0-9a-fA-F]{64}$/.test(trimmedHex)) {
        return false;
      }
      const spkiDer = Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(trimmedHex, 'hex')]);
      verifyingKey = createPublicKey({ key: spkiDer, format: 'der', type: 'spki' });
    } else {
      verifyingKey = getTicketEd25519Keys().publicKey;
    }

    return verify(null, Buffer.from(payloadB64Url, 'utf8'), verifyingKey, sigBuf);
  } catch {
    return false;
  }
}
