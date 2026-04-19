import type { IResourceLoader } from "./types";

const IMAGE_EXTS = [".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp"];
const AUDIO_EXTS = [".ogg", ".mp3", ".wav", ".m4a"];

interface RtpIndexResponse {
  count: number;
  paths: string[];
}

export class RouteRtpLoader implements IResourceLoader {
  private readonly basePath: string;
  private readonly fileIndex = new Map<string, string>();
  private readonly blobUrls = new Map<string, string>();

  private constructor(basePath: string, paths: string[]) {
    this.basePath = basePath.replace(/\/+$/, "");
    for (const p of paths) {
      const norm = this.normalizePath(p);
      this.fileIndex.set(norm.toLowerCase(), norm);
    }
  }

  static async create(basePath = "/api/rgss/rtp"): Promise<RouteRtpLoader | null> {
    const res = await fetch(`${basePath.replace(/\/+$/, "")}/index`, {
      cache: "force-cache",
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Partial<RtpIndexResponse>;
    if (!Array.isArray(data.paths)) return null;
    return new RouteRtpLoader(basePath, data.paths);
  }

  private normalizePath(p: string): string {
    return p.replace(/\\/g, "/").replace(/^\/+/, "");
  }

  private resolvePath(path: string, exts?: string[]): string | null {
    const norm = this.normalizePath(path);
    const lower = norm.toLowerCase();
    if (this.fileIndex.has(lower)) return this.fileIndex.get(lower)!;

    const toTry = exts ?? [...IMAGE_EXTS, ...AUDIO_EXTS];
    const base = norm.endsWith("/") ? norm.slice(0, -1) : norm;
    for (const ext of toTry) {
      const candidate = `${base}${ext}`;
      const hit = this.fileIndex.get(candidate.toLowerCase());
      if (hit) return hit;
    }
    return null;
  }

  private buildFileUrl(path: string): string {
    const encoded = path.split("/").map(encodeURIComponent).join("/");
    return `${this.basePath}/file/${encoded}`;
  }

  private async getBlobUrl(path: string): Promise<string | null> {
    const cached = this.blobUrls.get(path);
    if (cached) return cached;

    const res = await fetch(this.buildFileUrl(path), { cache: "force-cache" });
    if (!res.ok) return null;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    this.blobUrls.set(path, url);
    return url;
  }

  async getImageUrl(path: string): Promise<string | null> {
    const resolved = this.resolvePath(path, IMAGE_EXTS);
    if (!resolved) return null;
    return this.getBlobUrl(resolved);
  }

  async getAudioUrl(path: string): Promise<string | null> {
    const resolved = this.resolvePath(path, AUDIO_EXTS);
    if (!resolved) return null;
    return this.getBlobUrl(resolved);
  }

  findFirstImage(prefixes: string[]): string | null {
    const lowers = prefixes.map((p) => p.toLowerCase());
    for (const original of this.fileIndex.values()) {
      const lower = original.toLowerCase();
      if (!IMAGE_EXTS.some((ext) => lower.endsWith(ext))) continue;
      if (lowers.some((p) => lower.includes(p))) return original;
    }
    for (const original of this.fileIndex.values()) {
      if (IMAGE_EXTS.some((ext) => original.toLowerCase().endsWith(ext))) {
        return original;
      }
    }
    return null;
  }

  async getFile(path: string): Promise<Uint8Array | null> {
    const resolved = this.resolvePath(path);
    if (!resolved) return null;
    const res = await fetch(this.buildFileUrl(resolved), { cache: "force-cache" });
    if (!res.ok) return null;
    return new Uint8Array(await res.arrayBuffer());
  }

  listFiles(): string[] {
    return [...this.fileIndex.values()];
  }

  dispose(): void {
    for (const url of this.blobUrls.values()) {
      URL.revokeObjectURL(url);
    }
    this.blobUrls.clear();
  }
}
