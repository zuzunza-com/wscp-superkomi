/**
 * ResourceLoader - zip에서 리소스 추출, blob URL 제공
 * RPG Maker: Graphics/, Audio/BGM/, Audio/BGS/, Audio/ME/, Audio/SE/
 */
import JSZip from 'jszip';

const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp'];
const AUDIO_EXTS = ['.ogg', '.mp3', '.wav', '.m4a'];

export class ResourceLoader {
  private zip: JSZip;
  /** path (정규화) → blob URL */
  private blobUrls = new Map<string, string>();
  /** path (정규화) → blob (revoke용) */
  private blobs = new Map<string, Blob>();
  private fileIndex = new Map<string, string>(); // lowercase path → original path

  constructor(zip: JSZip) {
    this.zip = zip;
    const names = Object.keys(zip.files);
    for (const name of names) {
      const entry = zip.files[name];
      if (entry.dir) continue;
      const key = this.normalizePath(name);
      this.fileIndex.set(key.toLowerCase(), key);
    }
  }

  /** zip blob에서 ResourceLoader 생성 */
  static async fromBlob(zipBlob: Blob): Promise<ResourceLoader> {
    const zip = await JSZip.loadAsync(zipBlob);
    return new ResourceLoader(zip);
  }

  private normalizePath(p: string): string {
    return p.replace(/\\/g, '/').replace(/^\//, '');
  }

  /** 경로로 파일 찾기 (확장자 없으면 .png/.ogg 등 시도) */
  private resolvePath(path: string, exts?: string[]): string | null {
    const norm = this.normalizePath(path);
    const lower = norm.toLowerCase();

    // 정확히 일치
    if (this.fileIndex.has(lower)) {
      return this.fileIndex.get(lower)!;
    }

    // 확장자 없으면 시도
    const toTry = exts ?? [...IMAGE_EXTS, ...AUDIO_EXTS];
    const base = norm.endsWith('/') ? norm.slice(0, -1) : norm;
    for (const ext of toTry) {
      const candidate = base + ext;
      if (this.fileIndex.has(candidate.toLowerCase())) {
        return this.fileIndex.get(candidate.toLowerCase())!;
      }
    }

    return null;
  }

  /** 이미지 경로 → blob URL (캐시, 생성) */
  async getImageUrl(path: string): Promise<string | null> {
    const resolved = this.resolvePath(path, IMAGE_EXTS);
    if (!resolved) return null;

    const cached = this.blobUrls.get(resolved);
    if (cached) return cached;

    const file = this.zip.file(resolved);
    if (!file) return null;

    const blob = await file.async('blob');
    const url = URL.createObjectURL(blob);
    this.blobUrls.set(resolved, url);
    this.blobs.set(resolved, blob);
    return url;
  }

  /** 오디오 경로 → blob URL */
  async getAudioUrl(path: string): Promise<string | null> {
    const resolved = this.resolvePath(path, AUDIO_EXTS);
    if (!resolved) return null;

    const cached = this.blobUrls.get(resolved);
    if (cached) return cached;

    const file = this.zip.file(resolved);
    if (!file) return null;

    const blob = await file.async('blob');
    const url = URL.createObjectURL(blob);
    this.blobUrls.set(resolved, url);
    this.blobs.set(resolved, blob);
    return url;
  }

  /** RGSS 경로 변환: "Audio/BGM/Field01" → 실제 zip 경로 */
  resolveRgssPath(rgssPath: string, kind: 'image' | 'audio'): string | null {
    const exts = kind === 'image' ? IMAGE_EXTS : AUDIO_EXTS;
    return this.resolvePath(rgssPath, exts);
  }

  /** 사용한 blob URL 해제 */
  dispose(): void {
    for (const url of this.blobUrls.values()) {
      URL.revokeObjectURL(url);
    }
    this.blobUrls.clear();
    this.blobs.clear();
    this.fileIndex.clear();
  }

  /** zip에서 파일 바이트 추출 (parseScripts 등) */
  async getFile(path: string): Promise<Uint8Array | null> {
    const norm = this.normalizePath(path);
    const key = norm.toLowerCase();
    let original = this.fileIndex.get(key);
    if (!original) {
      const base = path.split('/').pop() ?? path;
      for (const [k, v] of this.fileIndex) {
        if (k.endsWith(base.toLowerCase()) || v.toLowerCase().endsWith(base.toLowerCase())) {
          original = v;
          break;
        }
      }
    }
    if (!original) return null;
    const file = this.zip.file(original);
    if (!file) return null;
    return file.async('uint8array');
  }

  /** 로드된 리소스 수 */
  get loadedCount(): number {
    return this.blobUrls.size;
  }

  /** zip 내 파일 목록 (디버그용) */
  listFiles(): string[] {
    return [...this.fileIndex.keys()];
  }

  /** prefix에 맞는 첫 이미지 경로 반환 (폴백용) */
  findFirstImage(prefixes: string[]): string | null {
    for (const prefix of prefixes) {
      const p = prefix.toLowerCase();
      for (const k of this.fileIndex.keys()) {
        if (k.includes(p) && IMAGE_EXTS.some((ext) => k.endsWith(ext))) {
          return this.fileIndex.get(k)!;
        }
      }
    }
    for (const k of this.fileIndex.keys()) {
      if (IMAGE_EXTS.some((ext) => k.endsWith(ext))) {
        return this.fileIndex.get(k)!;
      }
    }
    return null;
  }
}
