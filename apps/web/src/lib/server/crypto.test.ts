import { createHmac, generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  base32Decode,
  base32Encode,
  decryptText,
  encryptText,
  generateTotpSecret,
  getTicketEd25519Keys,
  hashPassword,
  hmacLookup,
  signEd25519Payload,
  verifyEd25519Payload,
  verifyPassword,
  verifyTotpCode
} from './crypto';

function computeTotpAt(secretBase32: string, timestampMs: number): string {
  const key = base32Decode(secretBase32);
  const counter = Math.floor(timestampMs / 1000 / 30);
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigUInt64BE(BigInt(counter), 0);
  const hmac = createHmac('sha1', key).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(code % 1_000_000).padStart(6, '0');
}

describe('crypto utilities', () => {
  describe('Argon2id password hashing', () => {
    it('hashes and verifies passwords with Argon2id', async () => {
      const password = 'CorrectHorse-BatteryStaple#2026';
      const hash = await hashPassword(password);

      expect(hash.startsWith('$argon2id$')).toBe(true);
      await expect(verifyPassword(hash, password)).resolves.toBe(true);
      await expect(verifyPassword(hash, 'wrong-password')).resolves.toBe(false);
      await expect(verifyPassword('', password)).resolves.toBe(false);
      await expect(verifyPassword(hash, '')).resolves.toBe(false);
      await expect(verifyPassword('not-a-valid-hash', password)).resolves.toBe(false);
    });
  });

  describe('AES-256-GCM encryption & tampering rejection', () => {
    it('encrypts and decrypts UTF-8 text with random IVs', () => {
      const plain = 'élève.test+tag@lycée-jean-moulin.fr — 🔑';
      const c1 = encryptText(plain);
      const c2 = encryptText(plain);

      expect(c1).not.toBe(c2);
      expect(c1.startsWith('v1:')).toBe(true);
      expect(c1.split(':')).toHaveLength(4);
      expect(decryptText(c1)).toBe(plain);
      expect(decryptText(c2)).toBe(plain);

      // Empty string round-trip
      const emptyCipher = encryptText('');
      expect(decryptText(emptyCipher)).toBe('');
    });

    it('rejects tampered ciphertext, auth tag, IV, and malformed payloads', () => {
      const cipher = encryptText('secret-payload');
      const [version, ivHex, tagHex, dataHex] = cipher.split(':');

      // Tamper ciphertext byte
      const tamperedData =
        (dataHex[0] === 'a' ? 'b' : 'a') + dataHex.slice(1);
      expect(() => decryptText(`${version}:${ivHex}:${tagHex}:${tamperedData}`)).toThrow();

      // Tamper auth tag byte
      const tamperedTag =
        (tagHex[0] === '0' ? '1' : '0') + tagHex.slice(1);
      expect(() => decryptText(`${version}:${ivHex}:${tamperedTag}:${dataHex}`)).toThrow();

      // Tamper IV byte
      const tamperedIv =
        (ivHex[0] === '0' ? '1' : '0') + ivHex.slice(1);
      expect(() => decryptText(`${version}:${tamperedIv}:${tagHex}:${dataHex}`)).toThrow();

      // Malformed formats
      expect(() => decryptText('v2:aa:bb:cc')).toThrow();
      expect(() => decryptText('v1:zz:bb:cc')).toThrow();
      expect(() => decryptText('v1:aa:bb:cc')).toThrow();
    });
  });

  describe('HMAC lookup', () => {
    it('produces deterministic normalized 64-char hex HMAC digests', () => {
      const h1 = hmacLookup('  Alice.Dupont@LycEE.fr ');
      const h2 = hmacLookup('alice.dupont@lycee.fr');
      const h3 = hmacLookup('bob.martin@lycee.fr');

      expect(h1).toMatch(/^[0-9a-f]{64}$/);
      expect(h1).toBe(h2);
      expect(h1).not.toBe(h3);
    });
  });

  describe('TOTP secret generation & verification', () => {
    it('generates valid Base32 secrets and verifies valid and invalid TOTP codes', () => {
      const secret = generateTotpSecret();
      expect(secret).toMatch(/^[A-Z2-7]+$/);
      expect(base32Decode(secret).length).toBe(20);
      expect(base32Encode(base32Decode(secret))).toBe(secret);

      const nowMs = 1_790_000_000_000;
      const validCurrent = computeTotpAt(secret, nowMs);
      const validPrevStep = computeTotpAt(secret, nowMs - 30_000);
      const validNextStep = computeTotpAt(secret, nowMs + 30_000);
      const expiredStep = computeTotpAt(secret, nowMs - 120_000);

      expect(verifyTotpCode(secret, validCurrent, nowMs)).toBe(true);
      expect(verifyTotpCode(secret, ` ${validCurrent.slice(0, 3)} ${validCurrent.slice(3)} `, nowMs)).toBe(true);
      expect(verifyTotpCode(secret, validPrevStep, nowMs)).toBe(true);
      expect(verifyTotpCode(secret, validNextStep, nowMs)).toBe(true);
      expect(verifyTotpCode(secret, expiredStep, nowMs)).toBe(false);

      // Guaranteed wrong code
      const wrongCode = validCurrent === '000000' ? '000001' : '000000';
      expect(verifyTotpCode(secret, wrongCode, nowMs)).toBe(false);
      expect(verifyTotpCode(secret, '12345', nowMs)).toBe(false);
      expect(verifyTotpCode(secret, 'abcdef', nowMs)).toBe(false);
      expect(verifyTotpCode('INVALID!1', validCurrent, nowMs)).toBe(false);
      expect(verifyTotpCode('', validCurrent, nowMs)).toBe(false);
    });
  });

  describe('Ed25519 payload signing & verification', () => {
    it('signs and verifies payloads, and rejects tampered payloads or wrong keys', () => {
      const payload = Buffer.from(JSON.stringify({ tid: 42, eid: 7 }), 'utf8').toString('base64url');
      const sig = signEd25519Payload(payload);
      const { publicKeyHex } = getTicketEd25519Keys();

      expect(publicKeyHex).toMatch(/^[0-9a-f]{64}$/);
      expect(verifyEd25519Payload(payload, sig)).toBe(true);
      expect(verifyEd25519Payload(payload, sig, publicKeyHex)).toBe(true);

      // Altered payload
      const alteredPayload = Buffer.from(JSON.stringify({ tid: 43, eid: 7 }), 'utf8').toString('base64url');
      expect(verifyEd25519Payload(alteredPayload, sig)).toBe(false);

      // Altered signature
      const alteredSig = (sig[0] === 'A' ? 'B' : 'A') + sig.slice(1);
      expect(verifyEd25519Payload(payload, alteredSig)).toBe(false);

      // Wrong public key (valid Ed25519 SPKI key from an independent keypair)
      const otherPair = generateKeyPairSync('ed25519');
      const otherSpkiDer = otherPair.publicKey.export({ format: 'der', type: 'spki' });
      const otherPubKeyHex = otherSpkiDer.subarray(12).toString('hex');
      expect(otherPubKeyHex).not.toBe(publicKeyHex);
      expect(verifyEd25519Payload(payload, sig, otherPubKeyHex)).toBe(false);

      // Malformed inputs
      expect(verifyEd25519Payload(payload, sig, 'not-hex')).toBe(false);
      expect(verifyEd25519Payload('', sig)).toBe(false);
      expect(verifyEd25519Payload(payload, 'bad+sig=')).toBe(false);
    });
  });
});
