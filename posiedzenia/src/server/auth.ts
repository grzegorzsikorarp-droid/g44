import {createHash, randomBytes, scrypt as rawScrypt, timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
import type {IncomingMessage} from 'node:http';

const scrypt = promisify(rawScrypt) as (password: string, salt: string, keylen: number, options: object) => Promise<Buffer>;
const params = {N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024};
export const COOKIE = 'posiedzenia_sesja';
export const SESSION_SECONDS = 12 * 3600;

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
export const newToken = () => randomBytes(32).toString('base64url');

export function validPassword(value: unknown): string {
  if (typeof value !== 'string' || value.length < 12 || value.length > 200) throw Object.assign(new Error('Hasło musi mieć od 12 do 200 znaków.'), {status: 400});
  return value;
}
export function validUsername(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-z0-9._-]{3,64}$/.test(value)) throw Object.assign(new Error('Login: 3–64 znaki — małe litery bez polskich znaków, cyfry, kropka, myślnik lub podkreślenie.'), {status: 400});
  return value;
}

export async function passwordHash(password: string) {
  validPassword(password);
  const salt = randomBytes(16).toString('hex');
  const hash = await scrypt(password, salt, 64, params);
  return `scrypt:${salt}:${hash.toString('hex')}`;
}

export async function passwordMatches(password: unknown, stored: string) {
  if (typeof password !== 'string' || password.length > 200) return false;
  const [, salt, expected] = stored.split(':');
  const hash = await scrypt(password, salt, 64, params);
  return timingSafeEqual(Buffer.from(expected, 'hex'), hash);
}

export function cookieToken(req: IncomingMessage) {
  return new RegExp(`(?:^|;\\s*)${COOKIE}=([A-Za-z0-9_-]{43})(?:;|$)`).exec(req.headers.cookie || '')?.[1];
}

export function sessionCookie(token: string, secure: boolean, maxAge = SESSION_SECONDS) {
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}
