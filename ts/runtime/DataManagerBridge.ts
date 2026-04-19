import type { IResourceLoader } from "../resources/types";
import { parseRvdata2 } from "../rvdata2/parseRvdata2";

type CacheMap = Map<string, unknown>;

export class DataManagerBridge {
  private readonly loader: IResourceLoader;
  private readonly cache: CacheMap = new Map();

  constructor(loader: IResourceLoader) {
    this.loader = loader;
  }

  clearCache(): void {
    this.cache.clear();
  }

  async loadRaw(path: string): Promise<Uint8Array | null> {
    return this.loader.getFile(path);
  }

  async loadRvdata2(path: string): Promise<unknown | null> {
    const key = path.toLowerCase();
    if (this.cache.has(key)) return this.cache.get(key) ?? null;
    const bytes = await this.loader.getFile(path);
    if (!bytes) return null;
    const parsed = parseRvdata2(bytes);
    this.cache.set(key, parsed);
    return parsed;
  }

  async loadSystem(): Promise<unknown | null> {
    for (const p of ["Data/System.rvdata2", "System.rvdata2", "Data/System.rxdata", "System.rxdata"]) {
      const v = await this.loadRvdata2(p);
      if (v) return v;
    }
    return null;
  }

  async loadMapInfos(): Promise<unknown | null> {
    for (const p of ["Data/MapInfos.rvdata2", "MapInfos.rvdata2", "Data/MapInfos.rxdata"]) {
      const v = await this.loadRvdata2(p);
      if (v) return v;
    }
    return null;
  }

  async loadMap(mapId: number): Promise<unknown | null> {
    const id = Math.max(0, Math.floor(mapId));
    const p = `Data/Map${String(id).padStart(3, "0")}.rvdata2`;
    return this.loadRvdata2(p);
  }

  listFiles(): string[] {
    return this.loader.listFiles();
  }
}
