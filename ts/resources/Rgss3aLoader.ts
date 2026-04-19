/**
 * Rgss3aLoader — RGSS Encrypted Archive 복호화 + IResourceLoader 구현
 *
 * 지원 포맷:
 *  - Game.rgss3a  (RPG Maker VX Ace, version byte = 3)
 *  - Game.rgss2a  (RPG Maker VX,     version byte = 1)
 *  - Game.rgssad  (RPG Maker XP,     version byte = 1)
 *
 * 파일 구조 참고:
 *  https://gist.github.com/UserUnknownFactor/4e700940079109f2430078534f163504
 *  (rgssunpack.rb / rgssrepack.rb)
 *
 * v1 (XP / VX) 헤더:
 *   [0-3]  "RGSS"
 *   [4-6]  "AD\0"
 *   [7]    version = 1
 *   이후 인덱스+데이터 인터리브:
 *     4B  name_length ^ key
 *     name_length B  name XOR key (1바이트씩)
 *     4B  file_size ^ key
 *     file_size B  data XOR key (4바이트 단위)
 *   key = 0xDEADCAFE 에서 시작하는 LCG (seed * 7 + 3)
 *
 * v3 (VX Ace) 헤더:
 *   [0-3]  "RGSS"
 *   [4-6]  "AD\0"
 *   [7]    version = 3
 *   [8-11] seed_key (little-endian uint32)
 *   이후 인덱스 블록 (key = seed_key * 9 + 3):
 *     4B  file_offset ^ key
 *     4B  file_size   ^ key
 *     4B  file_key    ^ key
 *     4B  name_length ^ key
 *     name_length B  name XOR key[i % 4]
 *     ... 반복 ...
 *     4B  0 (terminator)
 *   데이터 블록은 각 항목의 file_key로 독립 복호화
 */

import type { IResourceLoader } from './types';

const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp'];
const AUDIO_EXTS = ['.ogg', '.mp3', '.wav', '.m4a'];
const SIGNATURE = 'RGSS';

interface RgssEntry {
  name: string;   // 정규화된 경로 (/ 구분자, UTF-8)
  offset: number;
  size: number;
  key: number;    // 파일 데이터 복호화용 seed key
}

// ─── LCG Key Generator ───────────────────────────────────────────────────────

class KeyGen {
  private seed: number;

  constructor(seed: number) {
    // uint32 범위 유지
    this.seed = seed >>> 0;
  }

  next(): number {
    const k = this.seed;
    // seed = seed * 7 + 3  (uint32 절삭)
    this.seed = (Math.imul(this.seed, 7) + 3) >>> 0;
    return k;
  }
}

// ─── XOR 복호화 ──────────────────────────────────────────────────────────────

/**
 * RGSS XOR 복호화 (v1 / v3 공통).
 * key_seed 로 KeyGen 을 초기화하여 4바이트마다 key 교체.
 */
function prXorDecrypt(data: Uint8Array, keySeed: number): Uint8Array {
  const gen = new KeyGen(keySeed);
  const out = new Uint8Array(data.length);
  let key = gen.next();

  for (let i = 0; i < data.length; i++) {
    if (i > 0 && i % 4 === 0) key = gen.next();
    const keyByte = (key >>> ((i % 4) * 8)) & 0xff;
    out[i] = data[i] ^ keyByte;
  }
  return out;
}

// ─── 문자열 디코드 ────────────────────────────────────────────────────────────

function decodeRgssName(bytes: Uint8Array): string {
  // UTF-8 시도 → CP932(Shift-JIS) 폴백 → ASCII fallback
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    try {
      return new TextDecoder('shift_jis').decode(bytes);
    } catch {
      return Array.from(bytes)
        .map((b) => (b >= 32 && b <= 126 ? String.fromCharCode(b) : '_'))
        .join('');
    }
  }
}

function normalizeName(raw: string): string {
  // 백슬래시 → 슬래시, 선행 슬래시 제거, null 제거
  return raw.replace(/\\/g, '/').replace(/^\/*/, '').replace(/\0/g, '');
}

// ─── 인덱스 파싱 ─────────────────────────────────────────────────────────────

function readUint32LE(buf: Uint8Array, offset: number): number {
  return (
    (buf[offset] |
      (buf[offset + 1] << 8) |
      (buf[offset + 2] << 16) |
      (buf[offset + 3] << 24)) >>> 0
  );
}

function parseIndexV1(buf: Uint8Array): RgssEntry[] {
  const entries: RgssEntry[] = [];
  const gen = new KeyGen(0xdeadcafe);
  let pos = 8; // skip "RGSSAD\0\1"

  while (pos + 4 <= buf.length) {
    const rawKey = gen.next();
    const nameLen = readUint32LE(buf, pos) ^ rawKey;
    pos += 4;

    if (pos + nameLen > buf.length) break;
    const nameEncBytes = buf.slice(pos, pos + nameLen);
    pos += nameLen;

    // v1 name: 1바이트씩 key (하위 1바이트 사용)
    const nameDecBytes = new Uint8Array(nameLen);
    for (let i = 0; i < nameLen; i++) {
      nameDecBytes[i] = nameEncBytes[i] ^ (gen.next() & 0xff);
    }

    if (pos + 4 > buf.length) break;
    const fileSize = readUint32LE(buf, pos) ^ gen.next();
    pos += 4;

    const fileKey = gen.next(); // current seed before data skip

    entries.push({
      name: normalizeName(decodeRgssName(nameDecBytes)),
      offset: pos,
      size: fileSize,
      key: fileKey,
    });

    pos += fileSize;
  }
  return entries;
}

function parseIndexV3(buf: Uint8Array): RgssEntry[] {
  const entries: RgssEntry[] = [];

  // [8-11] seed_key
  const seedKey = readUint32LE(buf, 8);
  const masterKey = (Math.imul(seedKey, 9) + 3) >>> 0;

  // key bytes for name decryption (little-endian breakdown)
  const keyBytes = [
    masterKey & 0xff,
    (masterKey >>> 8) & 0xff,
    (masterKey >>> 16) & 0xff,
    (masterKey >>> 24) & 0xff,
  ];

  let pos = 12; // after header (8) + seedKey (4)

  while (pos + 4 <= buf.length) {
    const rawOffset = readUint32LE(buf, pos) ^ masterKey;
    if (rawOffset === 0) break; // terminator
    pos += 4;

    if (pos + 12 > buf.length) break;
    const fileSize = readUint32LE(buf, pos) ^ masterKey;
    pos += 4;
    const fileKey = readUint32LE(buf, pos) ^ masterKey;
    pos += 4;
    const nameLen = readUint32LE(buf, pos) ^ masterKey;
    pos += 4;

    if (pos + nameLen > buf.length) break;
    const nameEncBytes = buf.slice(pos, pos + nameLen);
    pos += nameLen;

    // v3 name: byte[i] ^ keyBytes[i % 4]
    const nameDecBytes = new Uint8Array(nameLen);
    for (let i = 0; i < nameLen; i++) {
      nameDecBytes[i] = nameEncBytes[i] ^ keyBytes[i % 4];
    }

    entries.push({
      name: normalizeName(decodeRgssName(nameDecBytes)),
      offset: rawOffset,
      size: fileSize,
      key: fileKey,
    });
  }
  return entries;
}

// ─── Rgss3aLoader (IResourceLoader) ──────────────────────────────────────────

export class Rgss3aLoader implements IResourceLoader {
  private readonly buf: Uint8Array;
  private readonly entries: RgssEntry[];
  /** lowercase path → entry index */
  private readonly index: Map<string, number> = new Map();
  /** path → blob URL (캐시) */
  private readonly blobCache: Map<string, string> = new Map();

  private constructor(buf: Uint8Array, entries: RgssEntry[]) {
    this.buf = buf;
    this.entries = entries;

    for (let i = 0; i < entries.length; i++) {
      const key = entries[i].name.toLowerCase();
      this.index.set(key, i);
    }
  }

  /** ArrayBuffer / Uint8Array / Blob / File 에서 로드 */
  static async fromBlob(blob: Blob | File | ArrayBuffer): Promise<Rgss3aLoader> {
    const arrayBuf =
      blob instanceof ArrayBuffer ? blob : await (blob as Blob).arrayBuffer();
    const buf = new Uint8Array(arrayBuf);
    return Rgss3aLoader.fromBuffer(buf);
  }

  static fromBuffer(buf: Uint8Array): Rgss3aLoader {
    // 시그니처 확인: "RGSSAD\0" (7 bytes) + version (1 byte)
    const sig = String.fromCharCode(buf[0], buf[1], buf[2], buf[3]);
    if (sig !== SIGNATURE) {
      throw new Error(`유효하지 않은 RGSS 아카이브 시그니처: ${sig}`);
    }
    const sub = String.fromCharCode(buf[4], buf[5], buf[6]);
    if (sub !== 'AD\0') {
      throw new Error('유효하지 않은 RGSS 아카이브 (AD\\0 없음)');
    }

    const version = buf[7];
    let entries: RgssEntry[];
    if (version === 1) {
      entries = parseIndexV1(buf);
    } else if (version === 3) {
      entries = parseIndexV3(buf);
    } else {
      throw new Error(`지원하지 않는 RGSS 아카이브 버전: ${version}`);
    }

    return new Rgss3aLoader(buf, entries);
  }

  // ── 내부 유틸 ────────────────────────────────────────────────────────────

  private resolve(path: string, exts?: string[]): number | null {
    const norm = path.replace(/\\/g, '/').replace(/^\/*/, '');
    const lower = norm.toLowerCase();

    if (this.index.has(lower)) return this.index.get(lower)!;

    const tryExts = exts ?? [...IMAGE_EXTS, ...AUDIO_EXTS];
    // 확장자 없는 경우 시도
    for (const ext of tryExts) {
      const candidate = lower + ext;
      if (this.index.has(candidate)) return this.index.get(candidate)!;
    }

    // 파일명만 일치 시도
    const base = lower.split('/').pop()!;
    for (const [k, v] of this.index) {
      if (k.endsWith('/' + base) || k === base) return v;
      for (const ext of tryExts) {
        if (k.endsWith('/' + base + ext) || k === base + ext) return v;
      }
    }

    return null;
  }

  private getEntryData(idx: number): Uint8Array {
    const e = this.entries[idx];
    const encrypted = this.buf.slice(e.offset, e.offset + e.size);
    return prXorDecrypt(encrypted, e.key);
  }

  private async entryToBlobUrl(idx: number, mime?: string): Promise<string> {
    const name = this.entries[idx].name;
    const cached = this.blobCache.get(name);
    if (cached) return cached;

    const data = this.getEntryData(idx);
    const blobData = new Uint8Array(data);
    const blob = new Blob([blobData], { type: mime ?? 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    this.blobCache.set(name, url);
    return url;
  }

  private guessMime(name: string): string {
    const ext = name.toLowerCase().split('.').pop() ?? '';
    const imageMap: Record<string, string> = {
      png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
      gif: 'image/gif', bmp: 'image/bmp', webp: 'image/webp',
    };
    const audioMap: Record<string, string> = {
      ogg: 'audio/ogg', mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4',
    };
    return imageMap[ext] ?? audioMap[ext] ?? 'application/octet-stream';
  }

  // ── IResourceLoader 구현 ─────────────────────────────────────────────────

  async getImageUrl(path: string): Promise<string | null> {
    const idx = this.resolve(path, IMAGE_EXTS);
    if (idx === null) return null;
    return this.entryToBlobUrl(idx, this.guessMime(this.entries[idx].name));
  }

  async getAudioUrl(path: string): Promise<string | null> {
    const idx = this.resolve(path, AUDIO_EXTS);
    if (idx === null) return null;
    return this.entryToBlobUrl(idx, this.guessMime(this.entries[idx].name));
  }

  async getFile(path: string): Promise<Uint8Array | null> {
    const idx = this.resolve(path);
    if (idx === null) return null;
    return this.getEntryData(idx);
  }

  listFiles(): string[] {
    return this.entries.map((e) => e.name);
  }

  findFirstImage(prefixes: string[]): string | null {
    for (const prefix of prefixes) {
      const p = prefix.toLowerCase();
      for (const e of this.entries) {
        const lower = e.name.toLowerCase();
        if (lower.includes(p) && IMAGE_EXTS.some((ext) => lower.endsWith(ext))) {
          return e.name;
        }
      }
    }
    for (const e of this.entries) {
      if (IMAGE_EXTS.some((ext) => e.name.toLowerCase().endsWith(ext))) return e.name;
    }
    return null;
  }

  dispose(): void {
    for (const url of this.blobCache.values()) URL.revokeObjectURL(url);
    this.blobCache.clear();
  }

  /** 아카이브에 포함된 파일 수 */
  get fileCount(): number {
    return this.entries.length;
  }

  /** 이 Blob/File이 RGSS 아카이브인지 확인 (헤더 검사) */
  static async isRgssArchive(blob: Blob): Promise<boolean> {
    try {
      const header = await blob.slice(0, 8).arrayBuffer();
      const bytes = new Uint8Array(header);
      return (
        bytes[0] === 0x52 && // R
        bytes[1] === 0x47 && // G
        bytes[2] === 0x53 && // S
        bytes[3] === 0x53 && // S
        bytes[4] === 0x41 && // A
        bytes[5] === 0x44 && // D
        bytes[6] === 0x00 && // \0
        bytes[7] === 3 // RGSS3(.rgss3a) 전용
      );
    } catch {
      return false;
    }
  }
}

/**
 * Blob이 RGSS 아카이브인지 확인하고, 맞으면 Rgss3aLoader 반환.
 * zip(.zip)이거나 아카이브가 아니면 null 반환.
 */
export async function tryLoadRgssArchive(blob: Blob): Promise<Rgss3aLoader | null> {
  const isRgss = await Rgss3aLoader.isRgssArchive(blob);
  if (!isRgss) return null;
  return Rgss3aLoader.fromBlob(blob);
}
