import {test} from 'node:test';
import assert from 'node:assert/strict';
import {constants, createHash, generateKeyPairSync, privateDecrypt, randomBytes} from 'node:crypto';
import {
  bigIntToBytes, blindMessage, byteLength, bytesToBigInt, fdh, keyFingerprint, modInverse, modPow,
  unblindSignature, verifySignature,
} from '../src/shared/blind.ts';

const sha256 = async (d: Uint8Array) => new Uint8Array(createHash('sha256').update(d).digest());
const b64 = (s: string) => bytesToBigInt(new Uint8Array(Buffer.from(s, 'base64url')));

test('arytmetyka modularna', () => {
  assert.equal(modPow(4n, 13n, 497n), 445n);
  assert.equal((modInverse(3n, 11n) * 3n) % 11n, 1n);
});

test('ślepy podpis: serwer podpisuje zaciemnioną wiadomość, podpis po odciemnieniu jest ważny', async () => {
  const {privateKey, publicKey} = generateKeyPairSync('rsa', {modulusLength: 2048, publicExponent: 0x10001});
  const jwk = publicKey.export({format: 'jwk'});
  const n = b64(jwk.n!), e = b64(jwk.e!), k = byteLength(n);
  const token = new Uint8Array(randomBytes(32));
  const m = await fdh(token, n, sha256);
  const r = bytesToBigInt(new Uint8Array(randomBytes(k))) % n;
  const blinded = blindMessage(m, r, n, e);
  assert.notEqual(blinded, m);
  const signed = privateDecrypt({key: privateKey, padding: constants.RSA_NO_PADDING}, Buffer.from(bigIntToBytes(blinded, k)));
  const s = unblindSignature(bytesToBigInt(new Uint8Array(signed)), r, n);
  assert.ok(verifySignature(s, m, n, e));
  const other = await fdh(new Uint8Array(randomBytes(32)), n, sha256);
  assert.equal(verifySignature(s, other, n, e), false);
  assert.match(await keyFingerprint(n.toString(16), sha256), /^[0-9A-F]{4}(-[0-9A-F]{4}){3}$/);
});

test('zapasowy SHA-256 daje te same wyniki co node:crypto', async () => {
  const {sha256: jsSha256} = await import('../src/shared/sha256.ts');
  for (const length of [0, 1, 55, 56, 63, 64, 65, 119, 120, 1000, 4096]) {
    const data = new Uint8Array(randomBytes(length));
    assert.equal(Buffer.from(jsSha256(data)).toString('hex'), createHash('sha256').update(data).digest('hex'), `długość ${length}`);
  }
});
