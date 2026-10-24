// Password hashing with scrypt (memory-hard, built into Node's crypto module).
// Format: scrypt$N$r$p$saltBase64$hashBase64 -- parameters are stored so they can be raised later.
import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt);
const N = 16384, R = 8, P = 1, KEYLEN = 64;

export async function hashPassword(plain) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(plain, salt, KEYLEN, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function verifyPassword(plain, stored) {
  const parts = String(stored).split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, saltB64, hashB64] = parts;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = await scrypt(plain, Buffer.from(saltB64, 'base64'), expected.length, { N: Number(n), r: Number(r), p: Number(p) });
  return crypto.timingSafeEqual(actual, expected);
}

// Used to keep login timing similar when the email does not exist.
export const DUMMY_HASH = await hashPassword('luna-dummy-password-1');
