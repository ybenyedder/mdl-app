import crypto from 'node:crypto';
import QRCode from 'qrcode';
import {
  getSessionSecret,
  getTicketEd25519Keys,
  signEd25519Payload,
  verifyEd25519Payload
} from './crypto';

export interface TicketPayload {
  tid: number;
  eid: number;
  qrid: string;
  tier: string;
  iat: number;
}

function getTicketSecret(): string {
  const explicit = process.env.JWT_TICKET_SECRET?.trim();
  if (explicit) return explicit;
  return crypto.createHmac('sha256', getSessionSecret()).update('mdl-ticket-jwt-v1', 'utf8').digest('hex');
}

function b64urlEncode(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
  return buf.toString('base64url');
}

function b64urlDecode(input: string): Buffer {
  return Buffer.from(input, 'base64url');
}

export function signTicketJwt(payload: Omit<TicketPayload, 'iat'>): string {
  const header = b64urlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64urlEncode(JSON.stringify({ ...payload, iat: Math.floor(Date.now() / 1000) }));
  const data = `${header}.${body}`;
  const sig = b64urlEncode(crypto.createHmac('sha256', getTicketSecret()).update(data).digest());
  return `${data}.${sig}`;
}

export function verifyTicketJwt(token: string): TicketPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [header, body, sig] = parts;
    const data = `${header}.${body}`;
    const expectedSig = b64urlEncode(
      crypto.createHmac('sha256', getTicketSecret()).update(data).digest()
    );
    const sigBuf = Buffer.from(sig);
    const expBuf = Buffer.from(expectedSig);
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      return null;
    }
    const parsed = JSON.parse(b64urlDecode(body).toString('utf8')) as TicketPayload;
    if (!parsed.tid || !parsed.eid || !parsed.qrid) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function signTicketEd25519Qr(payload: Omit<TicketPayload, 'iat'>): string {
  const fullPayload: TicketPayload = { ...payload, iat: Math.floor(Date.now() / 1000) };
  const payloadB64Url = Buffer.from(JSON.stringify(fullPayload), 'utf8').toString('base64url');
  const sigB64Url = signEd25519Payload(payloadB64Url);
  return `MDL1.${payloadB64Url}.${sigB64Url}`;
}

export function verifyTicketEd25519Qr(qrText: string): TicketPayload | null {
  const parts = qrText.trim().split('.');
  if (parts.length !== 3 || parts[0] !== 'MDL1') return null;
  const [, payloadB64Url, sigB64Url] = parts;
  if (!verifyEd25519Payload(payloadB64Url, sigB64Url)) {
    return null;
  }
  try {
    const parsed = JSON.parse(Buffer.from(payloadB64Url, 'base64url').toString('utf8')) as TicketPayload;
    if (!parsed.tid || !parsed.eid || !parsed.qrid) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function getTicketPublicKeyHex(): string {
  return getTicketEd25519Keys().publicKeyHex;
}

export async function generateQrSvg(text: string): Promise<string> {
  return QRCode.toString(text, {
    type: 'svg',
    margin: 1,
    width: 220,
    color: {
      dark: '#0f172a',
      light: '#ffffff'
    }
  });
}
