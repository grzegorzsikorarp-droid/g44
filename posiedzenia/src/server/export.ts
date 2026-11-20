import {createHash} from 'node:crypto';
import {deflateRaw as deflateRawCb, crc32 as zlibCrc32} from 'node:zlib';
import {promisify} from 'node:util';
import type {Actor, Meeting, PaperFormat, PaperId} from '../shared/types.ts';
import * as core from './export-core.ts';

// Eksport dokumentów posiedzenia na serwerze (SPEC-4 5.5): składanie plików jest w `export-core.ts` (ten sam kod
// w wersji próbnej, etap D.3); ten moduł daje serwerowi asynchroniczny `zlib.deflateRaw`, `zlib.crc32` i SHA-256.

const deflate = promisify(deflateRawCb);
export const deflateRaw = async (b: Uint8Array) => new Uint8Array(await deflate(b));
export const crc32 = (b: Uint8Array) => zlibCrc32(b) >>> 0;
const sha256 = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
export const nodeCodec: core.ExportCodec = {deflateRaw, crc32, sha256};

export type ExportDeps = Omit<core.ExportDeps, 'codec'>;
export type PaperFile = core.PaperFile;
export const {CONTENT_TYPES, FOLDER_LIMIT, disposition} = core;
const withCodec = (d: ExportDeps): core.ExportDeps => ({...d, codec: nodeCodec});
export const paperFile = (id: PaperId, format: PaperFormat, m: Meeting, a: Actor, d: ExportDeps) => core.paperFile(id, format, m, a, withCodec(d));
export const buildFolder = (m: Meeting, a: Actor, d: ExportDeps, limit = core.FOLDER_LIMIT) => core.buildFolder(m, a, withCodec(d), limit);
