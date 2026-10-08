// Criptografia de credenciais (AES-256-GCM), tokens opacos e hashing.
import crypto from 'node:crypto';
import { config } from '../config.js';

let devKeyWarned = false;

function key(): Buffer {
  let secret = config.encryptionKey;
  if (!secret) {
    if (!devKeyWarned && !config.isTest) {
      console.warn('[crypto] APP_ENCRYPTION_KEY não definido — usando chave de desenvolvimento. NÃO use em produção.');
      devKeyWarned = true;
    }
    secret = 'megazord-dev-only-encryption-key-change-me';
  }
  return crypto.createHash('sha256').update(secret).digest();
}

export function encrypt(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv.toString('base64'), tag.toString('base64'), enc.toString('base64')].join(':');
}

export function decrypt(payload: string): string {
  const [version, iv, tag, data] = payload.split(':');
  if (version !== 'v1' || !iv || !tag || !data) throw new Error('Formato de credencial inválido');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
}

export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

export function last4(value: string): string {
  return value.slice(-4);
}
