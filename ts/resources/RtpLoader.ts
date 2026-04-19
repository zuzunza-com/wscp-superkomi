/**
 * RTP (Runtime Package) 로더
 *
 * 기존에는 파일 단위로 API 라우트를 반복 호출했으나,
 * 이제는 RTP 파일 목록을 한번에 보내고 필요한 리소스를 ZIP payload로 받는
 * 일괄 로딩 전략을 기본으로 사용한다.
 */
import JSZip from 'jszip';
import { ResourceLoader } from './ResourceLoader';
import { RouteRtpLoader } from './RouteRtpLoader';
import type { IResourceLoader } from './types';

const DEFAULT_RTP_URLS = [
  '/api/rgss/rtp',
  '/static/RPGVXAce.zip',
  '/RPGVXAce.zip',
] as const;
const RTP_BULK_POST_URL = '/api/rgss/rtp/bulk';
const RTP_BULK_CACHE_PREFIX = 'webrgss_rtp_bulk_data_v1';
const RTP_BULK_CACHE_META_KEY = 'webrgss_rtp_bulk_meta_v1';
const FETCH_TIMEOUT_MS = 15000;

const RTP_BULK_MIN_FILES = 1;

let _rtpLoader: IResourceLoader | null = null;
let _rtpPromise: Promise<IResourceLoader | null> | null = null;
let _rtpSourceUrl: string | null = null;

export interface RtpLoadStatus {
  phase:
    | 'start'
    | 'cache_check'
    | 'cache_hit'
    | 'cache_miss'
    | 'probing'
    | 'fetching'
    | 'parsing'
    | 'persisting'
    | 'loaded'
    | 'not_found'
    | 'error';
  url?: string;
  message?: string;
}

export interface LoadRtpOptions {
  onStatus?: (status: RtpLoadStatus) => void;
  forceReload?: boolean;
}

interface LocalForageLike {
  getItem<T = unknown>(key: string): Promise<T | null>;
  setItem<T = unknown>(key: string, value: T): Promise<T>;
  removeItem(key: string): Promise<void>;
}

interface RtpCacheMeta {
  cacheToken: string;
  sourceUrl: string;
  cachedAt: number;
  byteLength: number;
  files: string[];
}

function getCandidateUrls(): string[] {
  return [...DEFAULT_RTP_URLS];
}

function normalizeFilePath(file: string): string {
  return file.replace(/^\/+/g, '').replace(/\\/g, '/');
}

function makeCacheToken(files: string[]): string {
  const normalized = [...new Set(files.map(normalizeFilePath))].sort();
  let hash = 2166136261;
  for (const s of normalized) {
    for (let i = 0; i < s.length; i += 1) {
      hash ^= s.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    hash ^= 10;
  }
  return String(hash >>> 0);
}

function hasLikelyRtpFiles(zip: JSZip): boolean {
  const names = Object.keys(zip.files).map((n) => n.toLowerCase());
  return names.some((n) => n.startsWith('graphics/')) && names.some((n) => n.startsWith('audio/'));
}

function getLocalForage(): LocalForageLike | null {
  if (typeof window === 'undefined') return null;
  return ((window as unknown as { localforage?: LocalForageLike }).localforage ?? null);
}

function cacheDataKey(token: string): string {
  return `${RTP_BULK_CACHE_PREFIX}:${token}`;
}

async function toArrayBuffer(value: unknown): Promise<ArrayBuffer | null> {
  if (!value) return null;
  if (value instanceof ArrayBuffer) return value;
  if (value instanceof Uint8Array) {
    return new Uint8Array(value).buffer;
  }
  if (typeof Blob !== 'undefined' && value instanceof Blob) {
    return value.arrayBuffer();
  }
  return null;
}

async function clearCachedRtp(): Promise<void> {
  const lf = getLocalForage();
  if (!lf) return;
  try {
    const meta = await lf.getItem<RtpCacheMeta>(RTP_BULK_CACHE_META_KEY);
    const promises: Promise<unknown>[] = [lf.removeItem(RTP_BULK_CACHE_META_KEY)];
    if (meta?.cacheToken) {
      promises.push(lf.removeItem(cacheDataKey(meta.cacheToken)));
    }
    await Promise.all(promises);
  } catch (error) {
    console.warn('[RtpLoader] Failed to clear cached RTP:', error);
  }
}

async function loadRtpFromUserCache(
  onStatus?: (status: RtpLoadStatus) => void,
): Promise<{ loader: IResourceLoader; meta: RtpCacheMeta } | null> {
  const lf = getLocalForage();
  if (!lf) return null;

  onStatus?.({ phase: 'cache_check', message: 'indexeddb' });

  try {
    const meta = await lf.getItem<RtpCacheMeta>(RTP_BULK_CACHE_META_KEY);
    if (!meta || !meta.cacheToken) {
      onStatus?.({ phase: 'cache_miss', message: 'no_cached_rtp_meta' });
      return null;
    }

    const rawData = await lf.getItem<ArrayBuffer | Uint8Array | Blob>(cacheDataKey(meta.cacheToken));
    const cachedBuffer = await toArrayBuffer(rawData);
    if (!cachedBuffer) {
      onStatus?.({ phase: 'cache_miss', message: 'no_cached_zip' });
      return null;
    }

    const zip = await JSZip.loadAsync(cachedBuffer);
    if (!hasLikelyRtpFiles(zip)) {
      console.warn('[RtpLoader] Cached RTP zip is invalid. Clearing cache.');
      await clearCachedRtp();
      onStatus?.({ phase: 'cache_miss', message: 'invalid_cached_zip' });
      return null;
    }

    onStatus?.({ phase: 'cache_hit', message: 'indexeddb' });
    return {
      loader: new ResourceLoader(zip),
      meta,
    };
  } catch (error) {
    console.warn('[RtpLoader] Failed to read RTP cache from user storage:', error);
    onStatus?.({
      phase: 'cache_miss',
      message: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

async function loadRtpFromRoute(
  onStatus?: (status: RtpLoadStatus) => void,
): Promise<IResourceLoader | null> {
  const routeBase = '/api/rgss/rtp';
  onStatus?.({ phase: 'probing', url: `${routeBase}/index`, message: 'route-index' });
  try {
    const loader = await RouteRtpLoader.create(routeBase);
    if (!loader) return null;
    if (loader.listFiles().length === 0) return null;
    return loader;
  } catch (error) {
    console.warn('[RtpLoader] Route RTP loader unavailable:', error);
    return null;
  }
}

async function saveRtpToUserCache(
  buffer: ArrayBuffer,
  cacheToken: string,
  sourceUrl: string,
  files: string[],
  onStatus?: (status: RtpLoadStatus) => void,
): Promise<void> {
  const lf = getLocalForage();
  if (!lf) return;

  onStatus?.({ phase: 'persisting', url: sourceUrl });
  try {
    const meta: RtpCacheMeta = {
      cacheToken,
      sourceUrl,
      cachedAt: Date.now(),
      byteLength: buffer.byteLength,
      files: [...new Set(files.map(normalizeFilePath))].sort(),
    };
    await Promise.all([
      lf.setItem(cacheDataKey(cacheToken), buffer),
      lf.setItem(RTP_BULK_CACHE_META_KEY, meta),
    ]);
  } catch (error) {
    console.warn('[RtpLoader] Failed to persist RTP into user storage:', error);
  }
}

async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, {
      ...init,
      signal: init?.signal ?? controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function loadRtpFileIndex(
  base: string = '/api/rgss/rtp',
  onStatus?: (status: RtpLoadStatus) => void,
): Promise<string[] | null> {
  try {
    onStatus?.({ phase: 'probing', url: `${base}/index` });
    const res = await fetchWithTimeout(`${base}/index`);
    if (!res.ok) {
      return null;
    }

    const json = (await res.json()) as { paths?: unknown };
    if (!Array.isArray(json.paths)) return null;

    const paths = json.paths
      .map((path) => (typeof path === 'string' ? normalizeFilePath(path) : ''))
      .filter((v) => v.length > 0);

    return paths.length === 0 ? null : paths;
  } catch (error) {
    onStatus?.({
      phase: 'error',
      url: `${base}/index`,
      message: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

async function loadRtpFromBulk(
  files: string[],
  onStatus?: (status: RtpLoadStatus) => void,
): Promise<IResourceLoader | null> {
  const uniq = [...new Set(files.map(normalizeFilePath))].filter((f) => f.length > 0);
  if (uniq.length < RTP_BULK_MIN_FILES) {
    return null;
  }

  const lf = getLocalForage();
  if (lf) {
    const meta = await lf.getItem<RtpCacheMeta>(RTP_BULK_CACHE_META_KEY);
    // 파일 목록이 동일하면 캐시 사용 (cacheToken은 서버 MD5이므로 파일 목록으로 비교)
    if (meta?.cacheToken && meta.files && meta.files.length === uniq.length) {
      const sortedMeta = [...meta.files].sort();
      const sortedUniq = [...uniq].sort();
      const same = sortedMeta.every((f, i) => f === sortedUniq[i]);
      if (same) {
        onStatus?.({ phase: 'probing', url: 'local cache' });
        const rawData = await lf.getItem<ArrayBuffer | Uint8Array | Blob>(cacheDataKey(meta.cacheToken));
        const cachedBuffer = await toArrayBuffer(rawData);
        if (cachedBuffer) {
          const zip = await JSZip.loadAsync(cachedBuffer);
          if (hasLikelyRtpFiles(zip)) {
            _rtpSourceUrl = `bulk-cache:${meta.cacheToken}`;
            onStatus?.({ phase: 'loaded', url: _rtpSourceUrl });
            return new ResourceLoader(zip);
          }
        }
      }
    }
  }

  try {
    onStatus?.({ phase: 'fetching', url: RTP_BULK_POST_URL });
    const res = await fetchWithTimeout(RTP_BULK_POST_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ files: uniq }),
    });

    if (!res.ok) {
      throw new Error(`bulk request failed (${res.status})`);
    }

    onStatus?.({ phase: 'parsing', url: RTP_BULK_POST_URL });
    const buffer = await res.arrayBuffer();
    const zip = await JSZip.loadAsync(buffer);
    if (!hasLikelyRtpFiles(zip)) {
      console.warn('[RtpLoader] RTP bulk payload is invalid (missing graphics/audio).');
      return null;
    }

    const key = res.headers.get('X-RGSS-Bulk-Key') ?? makeCacheToken(uniq);
    _rtpSourceUrl = `bulk:${key}`;
    await saveRtpToUserCache(
      buffer,
      key,
      _rtpSourceUrl,
      uniq,
      onStatus,
    );
    onStatus?.({ phase: 'loaded', url: _rtpSourceUrl });
    return new ResourceLoader(zip);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    onStatus?.({ phase: 'error', url: RTP_BULK_POST_URL, message: msg });
    return null;
  }
}

/**
 * static/RPGVXAce.zip 로드 (캐시, 싱글톤)
 */
export async function loadRtp(options?: LoadRtpOptions): Promise<IResourceLoader | null> {
  if (options?.forceReload) {
    _rtpLoader = null;
    _rtpPromise = null;
    _rtpSourceUrl = null;
    await clearCachedRtp();
  }

  if (_rtpLoader) {
    options?.onStatus?.({ phase: 'loaded', url: _rtpSourceUrl ?? undefined, message: 'cache' });
    return _rtpLoader;
  }
  if (_rtpPromise) return _rtpPromise;

  _rtpPromise = (async () => {
    options?.onStatus?.({ phase: 'start' });

    // 1) 사용자 영역 캐시 우선 사용 (bulk payload)
    const cached = await loadRtpFromUserCache(options?.onStatus);
    if (cached) {
      _rtpLoader = cached.loader;
      _rtpSourceUrl = cached.meta.sourceUrl;
      options?.onStatus?.({ phase: 'loaded', url: _rtpSourceUrl });
      return _rtpLoader;
    }

    // 2) RTP 인덱스를 받아 파일명단 기반으로 한 번의 Bulk 요청
    const manifestFiles = await loadRtpFileIndex('/api/rgss/rtp', options?.onStatus);
    if (manifestFiles && manifestFiles.length > 0) {
      const bulkLoader = await loadRtpFromBulk(manifestFiles, options?.onStatus);
      if (bulkLoader) {
        _rtpLoader = bulkLoader;
        return _rtpLoader;
      }
    }

    // 3) 기존 ZIP 단건 요청 폴백 (로컬/기존 CDN)
    for (const url of getCandidateUrls()) {
      options?.onStatus?.({ phase: 'probing', url });
      try {
        options?.onStatus?.({ phase: 'fetching', url });
        const res = await fetchWithTimeout(url);
        if (!res.ok) {
          if (res.status === 404) {
            continue;
          }
          console.warn(`[RtpLoader] RTP fetch failed: ${url} (${res.status})`);
          continue;
        }
        options?.onStatus?.({ phase: 'parsing', url });
        const buffer = await res.arrayBuffer();
        const zip = await JSZip.loadAsync(buffer);
        if (!hasLikelyRtpFiles(zip)) {
          console.warn(`[RtpLoader] RTP zip parsed but expected Audio/Graphics folders not found: ${url}`);
          continue;
        }

        const token = makeCacheToken([]);
        _rtpLoader = new ResourceLoader(zip);
        _rtpSourceUrl = `${url}`;
        await saveRtpToUserCache(buffer, token, url, ['/*zip-fallback*/'], options?.onStatus);
        console.log(`[RtpLoader] RTP loaded from ${url} (${_rtpLoader.listFiles().length} files)`);
        options?.onStatus?.({ phase: 'loaded', url });
        return _rtpLoader;
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.warn(`[RtpLoader] RTP candidate failed: ${url} - ${msg}`);
        options?.onStatus?.({ phase: 'error', url, message: msg });
      }
    }

    // 4) Route 기반 on-demand fallback
    const routeLoader = await loadRtpFromRoute(options?.onStatus);
    if (routeLoader) {
      _rtpLoader = routeLoader;
      _rtpSourceUrl = 'route:/api/rgss/rtp';
      options?.onStatus?.({ phase: 'loaded', url: _rtpSourceUrl });
      return _rtpLoader;
    }

    console.info('[RtpLoader] RTP not found; continuing without RTP fallback');
    options?.onStatus?.({ phase: 'not_found' });
    return null;
  })().finally(() => {
    if (!_rtpLoader) {
      _rtpPromise = null;
    }
  });

  return _rtpPromise;
}

/**
 * RTP 로더 인스턴스 반환 (미리 로드된 경우만)
 */
export function getRtpLoader(): IResourceLoader | null {
  return _rtpLoader;
}

export function getRtpSourceUrl(): string | null {
  return _rtpSourceUrl;
}
