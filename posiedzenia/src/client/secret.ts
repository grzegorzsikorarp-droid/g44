import {bigIntToBytes, blindMessage, byteLength, bytesToBigInt, bytesToHex, fdh, gcd, keyFingerprint, unblindSignature, verifySignature} from '../shared/blind.ts';
import {sha256 as jsSha256} from '../shared/sha256.ts';
import type {Ballot, Choice} from '../shared/types.ts';
import {ApiError, request} from './api.ts';

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
const rejectedKey = (id: string) => `posiedzenia:odrzucono:${id}`;
type Card = {token: string; signature: string; choice: Choice};

export const secretCastHere = (ballotId: string) => store.get(doneKey(ballotId)) === '1';
export const secretPending = (ballotId: string) => !!store.get(pendingKey(ballotId));
/** Głos wysłany z tego urządzenia dotarł po zakończeniu głosowania i nie został policzony. */
export const secretRejected = (ballotId: string) => store.get(rejectedKey(ballotId)) === '1';

// Widok członka słucha zmian znacznika odrzuconego głosu, więc pokazuje uwagę od razu, bez dodatkowego zapytania.
const listeners = new Set<() => void>();
const changed = () => { for (const listener of listeners) listener(); };
export function onSecretChange(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
/** „Rozumiem” przy uwadze o niepoliczonym głosie usuwa znacznik. */
export function forgetRejected(ballotId: string) {
  store.del(rejectedKey(ballotId));
  changed();
}

function savedCard(ballotId: string): Card | null {
  try { return JSON.parse(store.get(pendingKey(ballotId)) ?? 'null') as Card | null; } catch { return null; }
}

// Tajny głos: pobranie ślepo podpisanej karty (z logowaniem), a potem wysłanie głosu bez logowania.
// Karta zapisana na tym urządzeniu ma pierwszeństwo przed nowym wyborem, bo zawiera już potwierdzony głos.
export async function castSecret(meetingId: string, ballot: Ballot, choice: Choice) {
  const key = ballot.secret!;
  if (await keyFingerprint(key.n, sha256) !== key.fingerprint) throw new Error('Klucz głosowania nie zgadza się z odciskiem widocznym na karcie. Nie głosuj i zgłoś to osobie prowadzącej obrady.');
  const n = BigInt('0x' + key.n), e = BigInt('0x' + key.e);
  let pending = savedCard(ballot.id);
  if (!pending) {
    const token = random(32);
    const m = await fdh(token, n, sha256);
    const k = byteLength(n);
    let r = 0n;
    while (r < 2n || gcd(r, n) !== 1n) r = bytesToBigInt(random(k)) % n;
    const {signature} = await request<{signature: string}>(`/api/meetings/${meetingId}/secret/issue`, {body: {ballotId: ballot.id, blinded: bytesToHex(bigIntToBytes(blindMessage(m, r, n, e), k))}});
    const s = unblindSignature(BigInt('0x' + signature), r, n);
    if (!verifySignature(s, m, n, e)) throw new Error('Nie udało się pobrać karty do głosowania. Spróbuj ponownie. Jeśli błąd się powtórzy, nie głosuj i zgłoś to osobie prowadzącej obrady.');
    pending = {token: bytesToHex(token), signature: s.toString(16), choice};
    store.set(pendingKey(ballot.id), JSON.stringify(pending));
  }
  await send(meetingId, ballot.id, pending);
}

/** Ponowne wysłanie karty zapisanej na tym urządzeniu. Zwraca false, gdy takiej karty nie ma. */
export async function resendSecret(meetingId: string, ballotId: string) {
  const pending = savedCard(ballotId);
  if (!pending) return false;
  await send(meetingId, ballotId, pending);
  return true;
}

async function send(meetingId: string, ballotId: string, card: Card) {
  // Krótka losowa zwłoka utrudnia powiązanie pobrania karty z oddaniem głosu po czasie nadejścia.
  await new Promise(r => setTimeout(r, 400 + Math.floor(Math.random() * 1800)));
  try {
    await request(`/api/meetings/${meetingId}/secret/cast`, {body: {ballotId, ...card}, anonymous: true});
  } catch (e) {
    // Odpowiedź 409: głosowanie zakończyło się, zanim głos dotarł. Głos nie został policzony, a karta jest już bezużyteczna.
    if (e instanceof ApiError && e.status === 409) {
      store.del(pendingKey(ballotId));
      store.set(rejectedKey(ballotId), '1');
      changed();
    }
    throw e;
  }
  store.del(pendingKey(ballotId));
  store.set(doneKey(ballotId), '1');
}
