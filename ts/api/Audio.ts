/**
 * Audio - RGSS 오디오 (Web Audio API + blob URL 기반 재생)
 *
 * 핵심 설계:
 * - WASM 동기 환경에서 bgm_play 등이 호출됨 → async 불가
 * - preloadAudioUrl()로 미리 URL을 동기 캐시에 저장해두고,
 *   play 시 캐시에서 즉시 참조
 * - 브라우저 autoplay 정책: 첫 사용자 입력 이후 play() 허용
 *   → 실패 시 'pending' 큐에 쌓아 다음 Graphics.update() 에서 재시도
 */

export type GetAudioUrl = (path: string) => Promise<string | null>;

let _getAudioUrl: GetAudioUrl | null = null;

/** 경로 → blob URL 동기 캐시 */
const _urlCache = new Map<string, string>();

/** autoplay 대기 큐 */
let _pendingPlay: (() => void) | null = null;
let _autoplayUnlockInstalled = false;

function getEventTarget(): Pick<Window, 'addEventListener' | 'removeEventListener'> | null {
  if (typeof window !== 'undefined' && window && typeof window.addEventListener === 'function') {
    return window;
  }
  return null;
}

function flushPendingPlay(): void {
  if (!_pendingPlay) return;
  const fn = _pendingPlay;
  _pendingPlay = null;
  try {
    fn();
  } catch {
    // no-op
  }
}

function ensureAutoplayUnlockListener(): void {
  if (_autoplayUnlockInstalled) return;
  const target = getEventTarget();
  if (!target) return;
  const unlock = () => flushPendingPlay();
  target.addEventListener('pointerdown', unlock);
  target.addEventListener('keydown', unlock);
  _autoplayUnlockInstalled = true;
}

export function setAudioResourceLoader(fn: GetAudioUrl | null): void {
  _getAudioUrl = fn;
  _urlCache.clear();
  _pendingPlay = null;
}

/** preloadAll 단계에서 오디오 파일 URL을 미리 캐시 */
export async function preloadAudioUrl(path: string): Promise<void> {
  if (!_getAudioUrl || _urlCache.has(path)) return;
  try {
    const url = await _getAudioUrl(path);
    if (url) {
      _urlCache.set(path, url);
      const withoutExt = path.replace(/\.(ogg|mp3|m4a|wav|flac)$/i, '');
      if (withoutExt !== path) _urlCache.set(withoutExt, url);
    }
  } catch {
    // no-op
  }
}

/** Graphics.update() 에서 호출 — autoplay 재시도 */
export function audioPumpPending(): void {
  flushPendingPlay();
}

const AUDIO_EXTENSIONS = ['.ogg', '.mp3', '.m4a', '.wav'];

function resolveUrl(path: string): string | null {
  // 1) 동기 캐시 우선 (경로 그대로)
  const cached = _urlCache.get(path);
  if (cached) return cached;

  // 2) 확장자 없으면 후보 경로로 캐시 조회 (RGSS가 "Audio/BGM/Title" 형태로 넘기는 경우)
  if (!/\.(ogg|mp3|m4a|wav|flac)$/i.test(path)) {
    for (const ext of AUDIO_EXTENSIONS) {
      const withExt = path + ext;
      const c = _urlCache.get(withExt);
      if (c) return c;
    }
  }

  // 3) 캐시 미스 → 비동기로 가져와서 캐시 후 재시도 트리거
  if (_getAudioUrl) {
    _getAudioUrl(path).then((url) => {
      if (url) _urlCache.set(path, url);
    }).catch(() => {});
  }
  return null;
}

function tryPlay(el: HTMLAudioElement): void {
  ensureAutoplayUnlockListener();
  const promise = el.play();
  if (promise) {
    promise.catch(() => {
      // autoplay 차단 → pending에 등록, 다음 사용자 입력/update 시 재시도
      _pendingPlay = () => { el.play().catch(() => {}); };
    });
  }
}

function createAudio(url: string, volume: number, loop: boolean): HTMLAudioElement {
  const el = document.createElement('audio');
  el.preload = 'auto';
  el.src = url;
  el.volume = Math.max(0, Math.min(1, volume / 100));
  el.loop = loop;
  return el;
}

let _currentBgm: HTMLAudioElement | null = null;
let _currentBgs: HTMLAudioElement | null = null;
let _currentMe: HTMLAudioElement | null = null;

export const Audio = {
  setupMidi(): void {},

  bgmPlay(filename: string, volume = 100, _pitch = 100, pos = 0): void {
    if (!filename) return;
    Audio.bgmStop();
    const url = resolveUrl(filename);
    if (!url) {
      // URL 미캐시 → 비동기 대기 후 재생
      if (_getAudioUrl) {
        _getAudioUrl(filename).then((u) => {
          if (!u) return;
          _urlCache.set(filename, u);
          const a = createAudio(u, volume, true);
          a.currentTime = pos;
          _currentBgm = a;
          tryPlay(a);
        }).catch(() => {});
      }
      return;
    }
    const a = createAudio(url, volume, true);
    a.currentTime = pos;
    _currentBgm = a;
    tryPlay(a);
  },

  bgmStop(): void {
    if (_currentBgm) {
      _currentBgm.pause();
      _currentBgm.src = '';
      _currentBgm = null;
    }
  },

  bgmFade(time: number): void {
    if (!_currentBgm) return;
    const el = _currentBgm;
    const startVol = el.volume;
    const steps = Math.max(1, Math.round(time / 16));
    let step = 0;
    const id = setInterval(() => {
      step++;
      el.volume = Math.max(0, startVol * (1 - step / steps));
      if (step >= steps) {
        clearInterval(id);
        el.pause();
        el.src = '';
        if (_currentBgm === el) _currentBgm = null;
      }
    }, 16);
  },

  bgmPos(): number {
    return _currentBgm?.currentTime ?? 0;
  },

  bgsPlay(filename: string, volume = 100, _pitch = 100, pos = 0): void {
    if (!filename) return;
    Audio.bgsStop();
    const url = resolveUrl(filename);
    if (!url) {
      if (_getAudioUrl) {
        _getAudioUrl(filename).then((u) => {
          if (!u) return;
          _urlCache.set(filename, u);
          const a = createAudio(u, volume, true);
          a.currentTime = pos;
          _currentBgs = a;
          tryPlay(a);
        }).catch(() => {});
      }
      return;
    }
    const a = createAudio(url, volume, true);
    a.currentTime = pos;
    _currentBgs = a;
    tryPlay(a);
  },

  bgsStop(): void {
    if (_currentBgs) {
      _currentBgs.pause();
      _currentBgs.src = '';
      _currentBgs = null;
    }
  },

  bgsFade(time: number): void {
    if (!_currentBgs) return;
    const el = _currentBgs;
    const startVol = el.volume;
    const steps = Math.max(1, Math.round(time / 16));
    let step = 0;
    const id = setInterval(() => {
      step++;
      el.volume = Math.max(0, startVol * (1 - step / steps));
      if (step >= steps) {
        clearInterval(id);
        el.pause();
        el.src = '';
        if (_currentBgs === el) _currentBgs = null;
      }
    }, 16);
  },

  bgsPos(): number {
    return _currentBgs?.currentTime ?? 0;
  },

  mePlay(filename: string, volume = 100, _pitch = 100): void {
    if (!filename) return;
    Audio.meStop();
    const url = resolveUrl(filename);
    if (!url) {
      if (_getAudioUrl) {
        _getAudioUrl(filename).then((u) => {
          if (!u) return;
          _urlCache.set(filename, u);
          const a = createAudio(u, volume, false);
          _currentMe = a;
          a.onended = () => { if (_currentMe === a) _currentMe = null; };
          tryPlay(a);
        }).catch(() => {});
      }
      return;
    }
    const a = createAudio(url, volume, false);
    _currentMe = a;
    a.onended = () => { if (_currentMe === a) _currentMe = null; };
    tryPlay(a);
  },

  meStop(): void {
    if (_currentMe) {
      _currentMe.pause();
      _currentMe.src = '';
      _currentMe = null;
    }
  },

  meFade(_time: number): void {
    Audio.meStop();
  },

  sePlay(filename: string, volume = 100, _pitch = 100): void {
    if (!filename) return;
    const url = resolveUrl(filename);
    if (!url) {
      if (_getAudioUrl) {
        _getAudioUrl(filename).then((u) => {
          if (!u) return;
          _urlCache.set(filename, u);
          const a = createAudio(u, volume, false);
          tryPlay(a);
        }).catch(() => {});
      }
      return;
    }
    const a = createAudio(url, volume, false);
    tryPlay(a);
  },

  seStop(): void {},
};
