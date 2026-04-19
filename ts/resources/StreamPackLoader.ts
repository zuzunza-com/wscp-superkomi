import type { IResourceLoader } from "./types";

const MAGIC = "WSRGPKG1";
const HEADER_BYTES = 12;
const IMAGE_EXTS = [".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp"];
const AUDIO_EXTS = [".ogg", ".mp3", ".wav", ".m4a"];
const RGSS_DATA_EXTS = [".rvdata2", ".rvdata", ".rxdata"];
const MAX_MANIFEST_BYTES = 8 * 1024 * 1024;

/** Cache API 캐시 이름 (스트림 팩 클라이언트 캐시) */
const STREAM_PACK_CACHE_NAME = "wscp-stream-pack-v1";

interface StreamPackManifestFile {
  path: string;
  offset: number;
  size: number;
}

interface StreamPackManifest {
  format: "wscp-rgss-stream-pack";
  version: 1;
  files: StreamPackManifestFile[];
}

export interface StreamPackBulkOptions {
  /** 최대 허용 바이트 (초과 시 create로 폴백). 기본 100MB */
  maxBytes?: number;
  /** 스트림 수신 진행률 콜백 (loaded, total?) */
  onProgress?: (loaded: number, total?: number) => void;
}

export class StreamPackLoader implements IResourceLoader {
  private readonly packageUrl: string;
  private readonly dataOffset: number;
  private readonly fileIndex = new Map<string, StreamPackManifestFile>();
  private readonly fileOriginalPath = new Map<string, string>();
  private readonly fileBytesCache = new Map<string, Uint8Array>();
  private readonly blobUrls = new Map<string, string>();
  /** 단일 GET으로 수신한 전체 버퍼 (createBulk 전용). 있으면 랜덤 액세스로 slice */
  private _fullBuffer: Uint8Array | null = null;

  private constructor(packageUrl: string, manifest: StreamPackManifest, manifestLen: number) {
    this.packageUrl = packageUrl;
    this.dataOffset = HEADER_BYTES + manifestLen;
    for (const file of manifest.files) {
      const norm = this.normalizePath(file.path);
      const key = norm.toLowerCase();
      this.fileIndex.set(key, { ...file, path: norm });
      this.fileOriginalPath.set(key, norm);
    }
  }

  static async create(packageUrl: string): Promise<StreamPackLoader> {
    const headerBuf = await StreamPackLoader.fetchRangeBytes(packageUrl, 0, HEADER_BYTES - 1);
    if (headerBuf.byteLength < HEADER_BYTES) {
      throw new Error("RGSS stream pack header too short");
    }
    const header = new Uint8Array(headerBuf);
    const magic = new TextDecoder("ascii").decode(header.slice(0, 8));
    if (magic !== MAGIC) {
      throw new Error("Invalid RGSS stream pack magic");
    }
    const view = new DataView(headerBuf);
    const manifestLen = view.getUint32(8, true);
    if (manifestLen <= 0 || manifestLen > MAX_MANIFEST_BYTES) {
      throw new Error("Invalid RGSS stream pack manifest length");
    }

    const manifestBuf = await StreamPackLoader.fetchRangeBytes(
      packageUrl,
      HEADER_BYTES,
      HEADER_BYTES + manifestLen - 1
    );
    const manifestText = new TextDecoder("utf-8").decode(manifestBuf);
    const manifest = JSON.parse(manifestText) as StreamPackManifest;
    if (
      manifest?.format !== "wscp-rgss-stream-pack" ||
      manifest?.version !== 1 ||
      !Array.isArray(manifest.files)
    ) {
      throw new Error("Invalid RGSS stream pack manifest");
    }

    return new StreamPackLoader(packageUrl, manifest, manifestLen);
  }

  /**
   * 단일 GET으로 전체 스트림 팩을 수신한 뒤 메모리에서 랜덤 액세스.
   * create()의 Range 요청 2회 + preloadBulk 1회 대신, GET 1회만 사용.
   * 브라우저에서는 Cache API로 응답을 캐시하여 동일 URL 재방문 시 재다운로드 방지.
   */
  static async createBulk(
    packageUrl: string,
    options: StreamPackBulkOptions = {}
  ): Promise<StreamPackLoader> {
    const { maxBytes = 256 * 1024 * 1024, onProgress } = options;

    let res: Response;
    const useCache = typeof caches !== "undefined";

    if (useCache) {
      const cache = await caches.open(STREAM_PACK_CACHE_NAME);
      const cached = await cache.match(packageUrl);
      if (cached?.body) {
        res = cached;
      } else {
        res = await fetch(packageUrl, { cache: "reload" });
        if (res.ok && res.body)
          cache.put(packageUrl, res.clone());
      }
    } else {
      res = await fetch(packageUrl, { cache: "force-cache" });
    }

    if (!res.ok) throw new Error(`Stream pack fetch failed (${res.status})`);
    if (!res.body) throw new Error("Stream pack response has no body");
    const contentLength = res.headers.get("content-length");
    const total = contentLength ? Number.parseInt(contentLength, 10) : undefined;
    if (total !== undefined && total > maxBytes) {
      throw new Error(`Stream pack exceeds maxBytes (${total} > ${maxBytes})`);
    }
    const fullBuffer = await StreamPackLoader.streamToBuffer(res.body, total, onProgress);
    if (fullBuffer.length > maxBytes) {
      throw new Error(`Stream pack exceeds maxBytes (${fullBuffer.length} > ${maxBytes})`);
    }
    const header = fullBuffer.subarray(0, HEADER_BYTES);
    const magic = new TextDecoder("ascii").decode(header.slice(0, 8));
    if (magic !== MAGIC) throw new Error("Invalid RGSS stream pack magic");
    const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
    const manifestLen = view.getUint32(8, true);
    if (manifestLen <= 0 || manifestLen > MAX_MANIFEST_BYTES) {
      throw new Error("Invalid RGSS stream pack manifest length");
    }
    const manifestText = new TextDecoder("utf-8").decode(
      fullBuffer.subarray(HEADER_BYTES, HEADER_BYTES + manifestLen)
    );
    const manifest = JSON.parse(manifestText) as StreamPackManifest;
    if (
      manifest?.format !== "wscp-rgss-stream-pack" ||
      manifest?.version !== 1 ||
      !Array.isArray(manifest.files)
    ) {
      throw new Error("Invalid RGSS stream pack manifest");
    }
    const loader = new StreamPackLoader(packageUrl, manifest, manifestLen);
    loader._fullBuffer = fullBuffer;
    return loader;
  }

  private static async streamToBuffer(
    body: ReadableStream<Uint8Array>,
    total: number | undefined,
    onProgress?: (loaded: number, total?: number) => void
  ): Promise<Uint8Array> {
    const reader = body.getReader();
    const chunks: Uint8Array[] = [];
    let loaded = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value && value.length > 0) {
        chunks.push(value);
        loaded += value.length;
        onProgress?.(loaded, total);
      }
    }
    const out = new Uint8Array(loaded);
    let offset = 0;
    for (const c of chunks) {
      out.set(c, offset);
      offset += c.length;
    }
    if (loaded > 0) onProgress?.(loaded, total);
    return out;
  }

  private static async fetchRangeBytes(url: string, start: number, end: number): Promise<ArrayBuffer> {
    const res = await fetch(url, {
      headers: { Range: `bytes=${start}-${end}` },
      cache: "force-cache",
    });
    if (!(res.status === 206 || res.status === 200)) {
      throw new Error(`RGSS stream pack range fetch failed (${res.status})`);
    }
    const buf = await res.arrayBuffer();
    if (res.status === 206) return buf;
    if (buf.byteLength < end + 1) {
      throw new Error("RGSS stream pack full-body fallback is shorter than requested range");
    }
    return buf.slice(start, end + 1);
  }

  private normalizePath(p: string): string {
    return p.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "");
  }

  private resolvePath(path: string, exts?: string[]): string | null {
    const norm = this.normalizePath(path);
    const lower = norm.toLowerCase();
    if (this.fileIndex.has(lower)) return this.fileOriginalPath.get(lower)!;

    const toTry = exts ?? [...RGSS_DATA_EXTS, ...IMAGE_EXTS, ...AUDIO_EXTS];
    const base = norm.endsWith("/") ? norm.slice(0, -1) : norm;
    for (const ext of toTry) {
      const candidate = `${base}${ext}`.toLowerCase();
      const hit = this.fileOriginalPath.get(candidate);
      if (hit) return hit;
    }
    return null;
  }

  private async fetchFileBytesByNormalizedPath(resolvedPath: string): Promise<Uint8Array | null> {
    const key = resolvedPath.toLowerCase();
    const cached = this.fileBytesCache.get(key);
    if (cached) return cached;

    const entry = this.fileIndex.get(key);
    if (!entry) return null;

    if (this._fullBuffer) {
      const bytes = this._fullBuffer.slice(
        this.dataOffset + entry.offset,
        this.dataOffset + entry.offset + entry.size
      );
      this.fileBytesCache.set(key, bytes);
      return bytes;
    }

    const start = this.dataOffset + entry.offset;
    const end = start + entry.size - 1;
    const buf = await StreamPackLoader.fetchRangeBytes(this.packageUrl, start, end);
    const bytes = new Uint8Array(buf);
    if (bytes.length !== entry.size) {
      throw new Error(`RGSS stream pack file size mismatch: ${resolvedPath}`);
    }
    this.fileBytesCache.set(key, bytes);
    return bytes;
  }

  private async getBlobUrl(resolvedPath: string, mimeType: string): Promise<string | null> {
    const key = resolvedPath.toLowerCase();
    const cached = this.blobUrls.get(key);
    if (cached) return cached;

    const bytes = await this.fetchFileBytesByNormalizedPath(resolvedPath);
    if (!bytes) return null;
    const blobBytes = new Uint8Array(bytes);
    const blob = new Blob([blobBytes], { type: mimeType });
    const url = URL.createObjectURL(blob);
    this.blobUrls.set(key, url);
    return url;
  }

  async getImageUrl(path: string): Promise<string | null> {
    const resolved = this.resolvePath(path, IMAGE_EXTS);
    if (!resolved) return null;
    return this.getBlobUrl(resolved, "application/octet-stream");
  }

  async getAudioUrl(path: string): Promise<string | null> {
    const resolved = this.resolvePath(path, AUDIO_EXTS);
    if (!resolved) return null;
    return this.getBlobUrl(resolved, "application/octet-stream");
  }

  findFirstImage(prefixes: string[]): string | null {
    const lowers = prefixes.map((p) => p.toLowerCase());
    for (const original of this.fileOriginalPath.values()) {
      const lower = original.toLowerCase();
      if (!IMAGE_EXTS.some((ext) => lower.endsWith(ext))) continue;
      if (lowers.some((p) => lower.includes(p))) return original;
    }
    for (const original of this.fileOriginalPath.values()) {
      if (IMAGE_EXTS.some((ext) => original.toLowerCase().endsWith(ext))) {
        return original;
      }
    }
    return null;
  }

  async getFile(path: string): Promise<Uint8Array | null> {
    const resolved = this.resolvePath(path);
    if (!resolved) return null;
    return this.fetchFileBytesByNormalizedPath(resolved);
  }

  /**
   * 전체 데이터를 fileBytesCache에 채운다.
   * - createBulk 사용 시: _fullBuffer가 있어 추가 HTTP 없이 메모리 슬라이스만 수행.
   * - create 사용 시: 단일 Range 요청으로 데이터 취득 후 슬라이스.
   * maxBytes 초과 시 false 반환하여 호출 측이 개별 preload로 폴백.
   */
  async preloadBulk(maxBytes = 512 * 1024 * 1024): Promise<boolean> {
    if (this.fileIndex.size === 0) return true;

    if (this._fullBuffer) {
      for (const [key, entry] of this.fileIndex) {
        if (this.fileBytesCache.has(key)) continue;
        this.fileBytesCache.set(key, this._fullBuffer.slice(
          this.dataOffset + entry.offset,
          this.dataOffset + entry.offset + entry.size,
        ));
      }
      return true;
    }

    let totalDataSize = 0;
    for (const entry of this.fileIndex.values()) {
      const end = entry.offset + entry.size;
      if (end > totalDataSize) totalDataSize = end;
    }
    if (totalDataSize === 0) return true;
    if (totalDataSize > maxBytes) return false;

    const buf = await StreamPackLoader.fetchRangeBytes(
      this.packageUrl,
      this.dataOffset,
      this.dataOffset + totalDataSize - 1,
    );
    const fullData = new Uint8Array(buf);
    for (const [key, entry] of this.fileIndex) {
      if (this.fileBytesCache.has(key)) continue;
      this.fileBytesCache.set(key, fullData.slice(entry.offset, entry.offset + entry.size));
    }
    return true;
  }

  listFiles(): string[] {
    return [...this.fileOriginalPath.values()];
  }

  dispose(): void {
    for (const url of this.blobUrls.values()) {
      URL.revokeObjectURL(url);
    }
    this.blobUrls.clear();
    this.fileBytesCache.clear();
    this._fullBuffer = null;
  }
}
