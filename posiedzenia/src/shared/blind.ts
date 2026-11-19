// Ślepe podpisy RSA (D. Chaum) z haszem pełnej domeny (FDH) — podstawa tajnego głosowania.
//
// 1. Telefon losuje żeton t, liczy m = FDH(t) i zaciemnia go: m' = m · r^e mod n.
// 2. Serwer sprawdza uprawnienie, zapisuje „karta pobrana” i podpisuje m' kluczem głosowania.
// 3. Telefon odciemnia podpis: s = s' · r⁻¹ mod n. Serwer nigdy nie widział t ani s.
// 4. Telefon wysyła bez logowania (t, s, wybór). Serwer sprawdza s^e = FDH(t) i zapisuje sam wybór.
// Dzięki temu baza nie zawiera żadnego powiązania między osobą a oddanym głosem.

export type Sha256 = (data: Uint8Array) => Promise<Uint8Array>;
const TAG = new TextEncoder().encode('POSIEDZENIA-OIPIP-FDH-v1');

export const bytesToHex = (bytes: Uint8Array) => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
export function hexToBytes(hex: string) {
  if (!/^(?:[0-9a-f]{2})*$/i.test(hex)) throw new Error('Nieprawidłowy zapis szesnastkowy.');
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}
export const bytesToBigInt = (bytes: Uint8Array) => bytes.length ? BigInt('0x' + bytesToHex(bytes)) : 0n;
export function bigIntToBytes(x: bigint, length: number) {
  const hex = x.toString(16).padStart(length * 2, '0');
  if (hex.length > length * 2) throw new Error('Liczba nie mieści się w podanej długości.');
  return hexToBytes(hex);
}
export const byteLength = (n: bigint) => Math.ceil(n.toString(16).length / 2);

export function modPow(base: bigint, exp: bigint, mod: bigint) {
  let result = 1n, b = ((base % mod) + mod) % mod, e = exp;
  while (e > 0n) {
    if (e & 1n) result = (result * b) % mod;
    b = (b * b) % mod;
    e >>= 1n;
  }
  return result;
}

export function gcd(a: bigint, b: bigint) {
  while (b) [a, b] = [b, a % b];
  return a < 0n ? -a : a;
}

export function modInverse(a: bigint, m: bigint) {
  let [oldR, r] = [((a % m) + m) % m, m], [oldS, s] = [1n, 0n];
  while (r) {
    const q = oldR / r;
    [oldR, r] = [r, oldR - q * r];
    [oldS, s] = [s, oldS - q * s];
  }
  if (oldR !== 1n) throw new Error('Brak odwrotności modularnej.');
  return ((oldS % m) + m) % m;
}

function fdhInputs(token: Uint8Array, n: bigint) {
  const k = byteLength(n), inputs: Uint8Array[] = [];
  for (let counter = 0; counter * 32 < k; counter++) {
    const input = new Uint8Array(4 + TAG.length + token.length);
    new DataView(input.buffer).setUint32(0, counter);
    input.set(TAG, 4);
    input.set(token, 4 + TAG.length);
    inputs.push(input);
  }
  return {k, inputs};
}

export async function fdh(token: Uint8Array, n: bigint, sha256: Sha256) {
  const {k, inputs} = fdhInputs(token, n), out = new Uint8Array(inputs.length * 32);
  for (let i = 0; i < inputs.length; i++) out.set(await sha256(inputs[i]), i * 32);
  return bytesToBigInt(out.subarray(0, k)) % n;
}

export function fdhSync(token: Uint8Array, n: bigint, sha256: (data: Uint8Array) => Uint8Array) {
  const {k, inputs} = fdhInputs(token, n), out = new Uint8Array(inputs.length * 32);
  inputs.forEach((input, i) => out.set(sha256(input), i * 32));
  return bytesToBigInt(out.subarray(0, k)) % n;
}

export const blindMessage = (m: bigint, r: bigint, n: bigint, e: bigint) => (m * modPow(r, e, n)) % n;
export const unblindSignature = (blinded: bigint, r: bigint, n: bigint) => (blinded * modInverse(r, n)) % n;
export const verifySignature = (s: bigint, m: bigint, n: bigint, e: bigint) => s > 0n && s < n && modPow(s, e, n) === m;

const normalizeHex = (hex: string) => hex.length % 2 ? '0' + hex : hex;
export const formatFingerprint = (digest: Uint8Array) => bytesToHex(digest.subarray(0, 8)).toUpperCase().match(/.{4}/g)!.join('-');
export async function keyFingerprint(nHex: string, sha256: Sha256) {
  return formatFingerprint(await sha256(hexToBytes(normalizeHex(nHex))));
}
export function keyFingerprintSync(nHex: string, sha256: (data: Uint8Array) => Uint8Array) {
  return formatFingerprint(sha256(hexToBytes(normalizeHex(nHex))));
}
