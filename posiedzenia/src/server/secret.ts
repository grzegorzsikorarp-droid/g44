import {constants, createHash, generateKeyPairSync, privateDecrypt} from 'node:crypto';
import {bigIntToBytes, byteLength, fdhSync, hexToBytes, keyFingerprintSync, verifySignature} from '../shared/blind.ts';
import type {Choice} from '../shared/types.ts';
import type {Store} from './store.ts';

const sha256 = (data: Uint8Array) => new Uint8Array(createHash('sha256').update(data).digest());
const bad = (message: string, status = 400) => Object.assign(new Error(message), {status});

// Klucze i karty tajnych głosowań. Tabela secret_votes przechowuje wyłącznie skrót żetonu
// i wybór — bez osoby, bez czasu i bez kolejności (klucz główny to losowy skrót, tabela bez rowid).
export class SecretBallots {
  private store: Store;
  private afterClose: () => void;
  constructor(store: Store, afterClose: () => void) { this.store = store; this.afterClose = afterClose; }

  openKey(ballotId: string) {
    const {privateKey, publicKey} = generateKeyPairSync('rsa', {modulusLength: 2048, publicExponent: 0x10001});
    const jwk = publicKey.export({format: 'jwk'});
    const n = Buffer.from(jwk.n!, 'base64url').toString('hex'), e = Buffer.from(jwk.e!, 'base64url').toString('hex');
    this.store.db.prepare('INSERT INTO secret_keys VALUES (?,?,?,?)').run(ballotId, privateKey.export({format: 'pem', type: 'pkcs8'}) as string, n, e);
    return {n, e, fingerprint: keyFingerprintSync(n, sha256)};
  }

  sign(ballotId: string, blindedHex: unknown) {
    const row = this.store.db.prepare('SELECT private_pem, n FROM secret_keys WHERE ballot_id=?').get(ballotId) as {private_pem: string; n: string} | undefined;
    if (!row) throw bad('To głosowanie tajne zostało zakończone.', 409);
    const n = BigInt('0x' + row.n), k = byteLength(n);
    if (typeof blindedHex !== 'string' || !/^[0-9a-f]{1,1024}$/i.test(blindedHex)) throw bad('Nieprawidłowa karta do głosowania.');
    const blinded = BigInt('0x' + blindedHex);
    if (blinded <= 1n || blinded >= n) throw bad('Nieprawidłowa karta do głosowania.');
    return privateDecrypt({key: row.private_pem, padding: constants.RSA_NO_PADDING}, Buffer.from(bigIntToBytes(blinded, k))).toString('hex');
  }

  // Sprawdza podpis karty. Zwraca skrót żetonu albo informację, że karta została już wykorzystana.
  check(ballotId: string, key: {n: string; e: string}, tokenHex: unknown, signatureHex: unknown) {
    if (typeof tokenHex !== 'string' || !/^[0-9a-f]{64}$/i.test(tokenHex)) throw bad('Nieprawidłowa karta do głosowania.');
    if (typeof signatureHex !== 'string' || !/^[0-9a-f]{1,1024}$/i.test(signatureHex)) throw bad('Nieprawidłowa karta do głosowania.');
    const n = BigInt('0x' + key.n), e = BigInt('0x' + key.e), token = hexToBytes(tokenHex.toLowerCase());
    if (!verifySignature(BigInt('0x' + signatureHex), fdhSync(token, n, sha256), n, e)) throw bad('Karta do głosowania nie ma ważnego podpisu.', 403);
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const used = !!this.store.db.prepare('SELECT 1 FROM secret_votes WHERE ballot_id=? AND token_hash=?').get(ballotId, tokenHash);
    return {tokenHash, used};
  }

  record(ballotId: string, tokenHash: string, choice: Choice) {
    this.store.db.prepare('INSERT INTO secret_votes VALUES (?,?,?)').run(ballotId, tokenHash, choice);
  }

  tally(ballotId: string) {
    const counts = {za: 0, przeciw: 0, wstrzymuje: 0};
    for (const row of this.store.db.prepare('SELECT choice, COUNT(*) AS n FROM secret_votes WHERE ballot_id=? GROUP BY choice').all(ballotId) as {choice: Choice; n: number}[]) counts[row.choice] = Number(row.n);
    return counts;
  }

  closeKey(ballotId: string) {
    this.store.db.prepare('DELETE FROM secret_keys WHERE ballot_id=?').run(ballotId);
    this.afterClose();
  }
}
