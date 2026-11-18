import {bigIntToBytes, blindMessage, byteLength, bytesToBigInt, bytesToHex, fdh, gcd, keyFingerprint, unblindSignature, verifySignature} from '../shared/blind.ts';
import {sha256 as jsSha256} from '../shared/sha256.ts';
import type {Ballot, Choice} from '../shared/types.ts';
import {request} from './api.ts';

const sha256 = async (data: Uint8Array) => crypto.subtle
  ? new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(data)))
  : jsSha256(data);
const random = (length: number) => crypto.getRandomValues(new Uint8Array(length));
const store = {
  get: (key: string) => { try { return localStorage.getItem(key); } catch { return null; } },
  set: (key: string, value: string) => { try { localStorage.setItem(key, value); } catch { /* tryb prywatny */ } },
  del: (key: string) => { try { localStorage.removeItem(key); } catch { /* tryb prywatny */ } },
};
const pendingKey = (id: string) => `posiedzenia:karta:${id}`;
const doneKey = (id: string) => `posiedzenia:oddano:${id}`;

export const secretCastHere = (ballotId: string) => store.get(doneKey(ballotId)) === '1';
export const secretPending = (ballotId: string) => !!store.get(pendingKey(ballotId));

// Tajny głos: pobranie ślepo podpisanej karty (z logowaniem), a potem wysłanie głosu bez logowania.
export async function castSecret(meetingId: string, ballot: Ballot, choice: Choice) {
  const key = ballot.secret!;
  if (await keyFingerprint(key.n, sha256) !== key.fingerprint) throw new Error('Klucz głosowania nie zgadza się z odciskiem widocznym na karcie. Zgłoś to prowadzącemu.');
  const n = BigInt('0x' + key.n), e = BigInt('0x' + key.e);
  let pending = JSON.parse(store.get(pendingKey(ballot.id)) ?? 'null') as {token: string; signature: string; choice: Choice} | null;
  if (!pending) {
    const token = random(32);
    const m = await fdh(token, n, sha256);
    const k = byteLength(n);
    let r = 0n;
    while (r < 2n || gcd(r, n) !== 1n) r = bytesToBigInt(random(k)) % n;
    const {signature} = await request<{signature: string}>(`/api/meetings/${meetingId}/secret/issue`, {body: {ballotId: ballot.id, blinded: bytesToHex(bigIntToBytes(blindMessage(m, r, n, e), k))}});
    const s = unblindSignature(BigInt('0x' + signature), r, n);
    if (!verifySignature(s, m, n, e)) throw new Error('Serwer zwrócił nieprawidłowy podpis karty.');
    pending = {token: bytesToHex(token), signature: s.toString(16), choice};
    store.set(pendingKey(ballot.id), JSON.stringify(pending));
  }
  // Krótka losowa zwłoka utrudnia powiązanie pobrania karty z oddaniem głosu po czasie nadejścia.
  await new Promise(r => setTimeout(r, 400 + Math.floor(Math.random() * 1800)));
  await request(`/api/meetings/${meetingId}/secret/cast`, {body: {ballotId: ballot.id, ...pending}, anonymous: true});
  store.del(pendingKey(ballot.id));
  store.set(doneKey(ballot.id), '1');
}
