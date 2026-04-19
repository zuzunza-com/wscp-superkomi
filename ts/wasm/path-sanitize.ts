/**
 * Emscripten FS "Unable to add filesystem: <illegal path>" 방지.
 * URL/경로에서 쿼리·해시·불법 문자 제거.
 */
export function sanitizeModulePath(url: string): string {
  if (!url || typeof url !== 'string') return '';
  try {
    const u = new URL(url, typeof window !== 'undefined' ? window.location.origin : 'http://localhost');
    return u.pathname.replace(/\/+$/, '') || '/';
  } catch {
    return url.replace(/[?#].*$/, '').replace(/\\/g, '/').replace(/\/+$/, '') || '/';
  }
}

/** FS에 사용할 수 없는 문자 제거 (Emscripten MEMFS/NODEFS 등) */
const ILLEGAL_FS_CHARS = /[\0?:*"<>|]/g;

export function sanitizeFsPath(path: string): string {
  if (!path || typeof path !== 'string') return '';
  return path
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/^\/+/, '')
    .replace(ILLEGAL_FS_CHARS, '_');
}
