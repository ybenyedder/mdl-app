import { describe, expect, it } from 'vitest';
import {
  generateQrSvg,
  getTicketPublicKeyHex,
  signTicketEd25519Qr,
  signTicketJwt,
  verifyTicketEd25519Qr,
  verifyTicketJwt
} from './tickets';

describe('tickets signing, verification and QR SVG generation', () => {
  const sampleTicket = {
    tid: 101,
    eid: 5,
    qrid: 'MDL-9F3A12BC',
    tier: 'prevente'
  };

  describe('Ed25519 QR tickets (MDL1.<payload>.<sig>)', () => {
    it('generates MDL1.<payload>.<sig> format and verifies valid tickets', () => {
      const qrToken = signTicketEd25519Qr(sampleTicket);
      const parts = qrToken.split('.');

      expect(parts).toHaveLength(3);
      expect(parts[0]).toBe('MDL1');
      expect(qrToken).toMatch(/^MDL1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
      expect(getTicketPublicKeyHex()).toMatch(/^[0-9a-f]{64}$/);

      const verified = verifyTicketEd25519Qr(`  ${qrToken}  `);
      expect(verified).not.toBeNull();
      expect(verified).toMatchObject(sampleTicket);
      expect(typeof verified?.iat).toBe('number');
    });

    it('rejects altered payload, altered signature, wrong prefix, or missing claims', () => {
      const qrToken = signTicketEd25519Qr(sampleTicket);
      const [prefix, payloadB64, sigB64] = qrToken.split('.');

      // Tamper payload JSON
      const tamperedPayload = Buffer.from(
        JSON.stringify({ ...sampleTicket, tid: 999, iat: Math.floor(Date.now() / 1000) }),
        'utf8'
      ).toString('base64url');
      expect(verifyTicketEd25519Qr(`${prefix}.${tamperedPayload}.${sigB64}`)).toBeNull();

      // Tamper signature
      const tamperedSig = (sigB64[0] === 'A' ? 'B' : 'A') + sigB64.slice(1);
      expect(verifyTicketEd25519Qr(`${prefix}.${payloadB64}.${tamperedSig}`)).toBeNull();

      // Wrong version prefix
      expect(verifyTicketEd25519Qr(`MDL2.${payloadB64}.${sigB64}`)).toBeNull();
      expect(verifyTicketEd25519Qr(`${payloadB64}.${sigB64}`)).toBeNull();

      // Signed payload missing required fields
      const incompleteQr = signTicketEd25519Qr({ tid: 0, eid: 5, qrid: 'MDL-ZERO', tier: 'plein' });
      expect(verifyTicketEd25519Qr(incompleteQr)).toBeNull();
    });
  });

  describe('HS256 JWT tickets', () => {
    it('signs and verifies valid JWT tickets and rejects tampering', () => {
      const jwt = signTicketJwt(sampleTicket);
      const parts = jwt.split('.');
      expect(parts).toHaveLength(3);

      const decoded = verifyTicketJwt(jwt);
      expect(decoded).not.toBeNull();
      expect(decoded).toMatchObject(sampleTicket);
      expect(typeof decoded?.iat).toBe('number');

      // Tamper body
      const [header, , sig] = parts;
      const tamperedBody = Buffer.from(
        JSON.stringify({ ...sampleTicket, eid: 99, iat: Math.floor(Date.now() / 1000) }),
        'utf8'
      ).toString('base64url');
      expect(verifyTicketJwt(`${header}.${tamperedBody}.${sig}`)).toBeNull();

      // Tamper signature
      const tamperedSig = (sig[0] === 'x' ? 'y' : 'x') + sig.slice(1);
      expect(verifyTicketJwt(`${header}.${parts[1]}.${tamperedSig}`)).toBeNull();

      // Malformed / missing required claims
      expect(verifyTicketJwt('not-a-jwt')).toBeNull();
      const incompleteJwt = signTicketJwt({ tid: 1, eid: 0, qrid: 'MDL-BAD', tier: 'plein' });
      expect(verifyTicketJwt(incompleteJwt)).toBeNull();
    });
  });

  describe('QR SVG generation', () => {
    it('generates a valid SVG string for a signed ticket QR code', async () => {
      const qrToken = signTicketEd25519Qr(sampleTicket);
      const svg = await generateQrSvg(qrToken);

      expect(svg).toContain('<svg');
      expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
      expect(svg).toContain('</svg>');
      expect(svg).toMatch(/<(path|rect)\b/);
    });
  });
});
