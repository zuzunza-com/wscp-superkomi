/**
 * WasmRgssRuntime.ts - RGSS301.dll 기반 WebRGSS WASM 런타임
 *
 * RGSS301.dll (RPG Maker VX Ace)의 역할을 모사:
 * - Graphics, Input, Audio, Sprite, Bitmap, Window 등 RGSS3 표준 API 제공
 * - load_data / save_data (rvdata2) 처리
 * - 게임 루프 (SceneManager.update → update → Graphics.update)
 *
 * 스크립트는 Scripts.rvdata2에서 파싱된 순서 그대로 실행 (수정 없음).
 * mruby 호환성으로 인한 최소한의 패치만 적용 (defined?, @scene.main 등).
 *
 * 1. Emscripten 모듈(webrgss.mjs) 동적 임포트
 * 2. WasmRgssBridge로 JS import 객체 주입 (RGSS301.dll API)
 * 3. Scripts.rvdata2 기반 스크립트 목록을 WASM에 전달하여 실행
 * 4. 게임 루프 (requestAnimationFrame + wrgss_tick)
 */

import { WasmRgssBridge } from './WasmRgssBridge';
import { WasmMemory, type EmscriptenModule } from './WasmMemory';
import { acquireBootLock } from './boot-lock';
import { sanitizeModulePath } from './path-sanitize';
import { Graphics } from '../api/Graphics';
import { setAudioResourceLoader, preloadAudioUrl } from '../api/Audio';
import type { IRenderer } from '../renderer/IRenderer';
import type { IResourceLoader } from '../resources/types';

export interface RgssScript {
  index: number;
  title: string;
  /** Ruby 소스 (bytecode 미사용 시) */
  code: string;
  /** RITE 바이트코드 (JIT 모드, _wrgss_exec_bytecode 사용 시) */
  bytecode?: Uint8Array;
}

/** 고속 재생 배치 틱 상한 (메인 스레드 블로킹 방지) */
const MAX_TICKS_PER_FRAME = 16;

export interface WasmRgssRuntimeOptions {
  /** Emscripten WASM 글루 모듈 URL (webrgss.mjs) */
  wasmModuleUrl: string;
  renderer: IRenderer;
  loader: IResourceLoader;
  scripts: RgssScript[];
  /** RGSS3 기본 프레임레이트 (40=클래식 느낌, 60=표준). 게임 스크립트에서 Graphics.frame_rate 로 덮어씀 가능 */
  defaultFrameRate?: number;
  /** 고속 재생 배율 (1=일반, 2=2배속, 4=4배속). WASM mruby 틱을 배치 실행하여 V8/JS 한계 극복 */
  playbackSpeed?: number;
  onError?: (msg: string, diagnostics?: WasmRuntimeDiagnostics) => void;
  onStateChange?: (state: WasmRgssState) => void;
  onMsgbox?: (msg: string) => void;
}

export type WasmRgssState =
  | 'idle'
  | 'loading_wasm'
  | 'preloading_files'
  | 'executing_scripts'
  | 'running'
  | 'stopped'
  | 'error';

/** 런타임 진단 정보 — 오류 원인 가시화용 */
export interface WasmRuntimeDiagnostics {
  lastMsgbox: string[];
  lastPrintErr: string[];
  hasRgssMain: boolean;
  loopTickCounter: number;
  state: WasmRgssState;
  bootAttempt: number;
}

export class WasmRgssRuntime {
  private state: WasmRgssState = 'idle';
  private emMod: EmscriptenModule | null = null;
  private mem: WasmMemory | null = null;
  private bridge: WasmRgssBridge | null = null;
  private rafId: number | null = null;
  private lastTime = 0;
  private bootAttempt = 0;
  private loopTickCounter = 0;
  private loopFallbackInFlight = false;
  /** mruby stderr 캡처 — execBootstrap 실패 진단용 (최근 20줄) */
  private _lastPrintErr: string[] = [];
  /** js_msgbox 호출 캡처 — Fiber 예외 시 실제 Ruby 에러 메시지 (최근 10건) */
  private _lastMsgbox: string[] = [];
  /** 스크립트 중 rgss_main { } 블록 포함 여부 — tick 실패 시 진단용 */
  private _hasRgssMain = false;
  private loopWatchdogTimer: ReturnType<typeof setInterval> | null = null;
  private lastLoopProgressAt = 0;
  /** 고속 재생 배율 (1=일반, 2=2배속, 4=4배속). 런타임 변경 가능 */
  private _playbackSpeed = 1;
  /** RGSS3 기본 60, 일부 게임 40 — Graphics.frame_rate 반영 */
  private get frameIntervalMs(): number {
    const rate = Math.max(20, Math.min(120, Graphics.frameRate));
    return 1000 / rate;
  }

  /* WASM export 함수 래퍼 */
  private fnInit?: () => number;
  private fnExecScript?: (srcPtr: number, namePtr: number) => number;
  /** RGSS JIT: RITE 바이트코드 실행 (webrgss C에 _wrgss_exec_bytecode 있을 때) */
  private fnExecBytecode?: (bufPtr: number, bufLen: number, namePtr: number) => number;
  private fnTick?: () => number;
  private fnShutdown?: () => void;
  private fnDebugTickProbe?: () => number;
  private fnDebugGameRunning?: () => number;
  private fnDebugIsFiber?: () => number;

  private readonly opts: WasmRgssRuntimeOptions;

  constructor(opts: WasmRgssRuntimeOptions) {
    this.opts = opts;
    this._playbackSpeed = Math.max(1, Math.min(8, opts.playbackSpeed ?? 1));
  }

  private debug(msg: string): void {
    console.info(`[WasmRgssRuntime] ${msg}`);
  }

  /** 고속 재생 배율 설정 (1, 2, 4, 8). WASM 틱 배치 실행으로 V8/JS 한계 극복 */
  setPlaybackSpeed(speed: number): void {
    this._playbackSpeed = Math.max(1, Math.min(8, speed));
  }

  get playbackSpeed(): number {
    return this._playbackSpeed;
  }

  get currentState(): WasmRgssState {
    return this.state;
  }

  /** 런타임 진단 정보 반환 — 오류 원인 가시화용 */
  getDiagnostics(): WasmRuntimeDiagnostics {
    return {
      lastMsgbox: [...this._lastMsgbox],
      lastPrintErr: [...this._lastPrintErr],
      hasRgssMain: this._hasRgssMain,
      loopTickCounter: this.loopTickCounter,
      state: this.state,
      bootAttempt: this.bootAttempt,
    };
  }

  /** 런타임을 초기화하고 게임을 부트한다. */
  async boot(): Promise<void> {
    const release = await acquireBootLock();
    try {
      this.stop();
      let attempt = 0;
      const maxAttempts = 3; // 무한 루프 방지

      while (attempt < maxAttempts) {
        attempt++;
        this.bootAttempt = attempt;
        this.debug(`boot attempt ${attempt}/${maxAttempts} 시작 (scripts=${this.opts.scripts.length}, playbackSpeed=${this._playbackSpeed})`);
        this.setState('loading_wasm');
        await this.loadWasmModule();

        this.setState('preloading_files');
        await this.bridge!.preloadAll();
        this.debug(`preloadAll 완료 (files=${this.opts.loader.listFiles().length})`);

        // Audio 로더를 WASM 런타임에 연결 및 타이틀 BGM 미리 캐시
        setAudioResourceLoader((p) => this.opts.loader.getAudioUrl(p));
        await this._preloadAudioFiles();
        this.debug('audio preload 완료');

        const defRate = this.opts.defaultFrameRate ?? 40;
        if (Number.isFinite(defRate) && defRate >= 20 && defRate <= 120) {
          Graphics.frameRate = defRate;
        }

        this.setState('executing_scripts');
        this.debug('스크립트 실행 시작');
        const { failedIndices = [], failedDetails = [] } = (await this.executeScripts()) ?? {};
        this.debug(`스크립트 실행 종료 (failed=${failedIndices.length})`);

        if (failedIndices.length > 0) {
          this.stop();
          this.setState('error');
          const failedTitles = failedDetails
            .map((d) => `[${d.index}] ${d.title}: ${d.detail}`)
            .join('\n');
          const msg = `RGSS Runtime Error\n\n${failedIndices.length}개 스크립트 오류:\n${failedTitles}`;
          this.opts.onError?.(msg, this.getDiagnostics());
          throw new Error(msg);
        }

        // 성공적으로 모든 스크립트 실행 완료
        break;
      }

      this.setState('running');
      this.debug('running 상태 진입, 메인 루프 시작');
      this.bridge?.triggerRender();
      this.startLoop();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.opts.onError?.(msg, this.getDiagnostics());
      this.debug(`boot 실패: ${msg}`);
      this.setState('error');
      throw err;
    } finally {
      release();
    }
  }

  stop(): void {
    const wasRunning = this.state === 'running';
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.freeTickCache();
    if (this.loopWatchdogTimer) {
      clearInterval(this.loopWatchdogTimer);
      this.loopWatchdogTimer = null;
    }
    this.loopFallbackInFlight = false;
    this.fnShutdown?.();
    if (wasRunning) {
      console.warn('[WasmRgssRuntime] 게임이 running 상태에서 중단됨 (js_rgss_stop 호출 또는 tick 실패)');
    }
    this.bridge?.dispose();
    this.setState('stopped');
  }

  /**
   * 로더에서 Audio 파일 목록을 얻어 URL을 미리 캐시.
   * WASM은 동기 환경이라 bgm_play 호출 시 await 불가 → 사전 캐시 필요.
   */
  private async _preloadAudioFiles(): Promise<void> {
    const loader = this.opts.loader;
    if (!loader) return;
    try {
      const files = loader.listFiles ? loader.listFiles() : [];
      const audioFiles = files.filter((f: string) =>
        /^Audio\//i.test(f) &&
        /\.(ogg|mp3|wav|m4a|flac)$/i.test(f)
      );
      // 최대 20개 BGM/ME 파일을 우선 preload (BGS/SE는 지연 허용)
      const priority = audioFiles.filter((f: string) => /Audio\/(BGM|ME)\//i.test(f)).slice(0, 20);
      await Promise.allSettled(priority.map((f: string) => preloadAudioUrl(f)));
    } catch {
      // preload 실패는 무시 — 재생 시점에 재시도
    }
  }

  /* ====================================================
   * 내부 구현
   * ==================================================== */

  private async loadWasmModule(): Promise<void> {
    this.debug(`WASM 모듈 로딩: ${this.opts.wasmModuleUrl}`);
    this.bridge = new WasmRgssBridge({
      renderer: this.opts.renderer,
      loader: this.opts.loader,
    });
    const origMsgbox = this.opts.onMsgbox;
    this.bridge.setCallbacks({
      onMsgbox: (msg: string) => {
        this._lastMsgbox.push(msg);
        if (this._lastMsgbox.length > 10) this._lastMsgbox.shift();
        origMsgbox?.(msg);
      },
      onRgssStop: () => this.stop(),
    });

    /* Emscripten 모듈 팩토리를 동적 임포트 (캐시 우회) */
    const mjsUrl = this.opts.wasmModuleUrl + (this.opts.wasmModuleUrl.includes('?') ? '&' : '?') + `v=${Date.now()}`;
    const factory = await import(/* @vite-ignore */ /* webpackIgnore: true */ mjsUrl) as {
      default: (opts: Record<string, unknown>) => Promise<EmscriptenModule>
    };

    const jsImports = this.bridge.buildImports();

    this._lastPrintErr.length = 0;

    this.emMod = await factory.default({
      print: (text: string) => { this.debug(`[wasm stdout] ${text}`); },
      printErr: (text: string) => {
        console.warn(`[WasmRgssRuntime][stderr] ${text}`);
        this._lastPrintErr.push(text);
        if (this._lastPrintErr.length > 20) this._lastPrintErr.shift();
      },
      locateFile: (file: string) => {
        const base = sanitizeModulePath(this.opts.wasmModuleUrl).replace(/[^/]+$/, '') || '/';
        try {
          const u = new URL(this.opts.wasmModuleUrl, typeof window !== 'undefined' ? window.location.href : 'http://localhost');
          u.pathname = base + file;
          u.search = '';
          u.hash = '';
          return u.href;
        } catch {
          return base + file;
        }
      },
      /* Emscripten 내부 스텁을 우리의 js_* 구현으로 교체 */
      instantiateWasm: (
        wasmImports: Record<string, Record<string, unknown>>,
        successCallback: (instance: WebAssembly.Instance) => void,
      ) => {
        /* buildImports()는 { env: { js_msgbox: ..., ... } } 형태 반환 */
        const userEnv = (jsImports['env'] ?? {}) as Record<string, unknown>;

        /*
         * Emscripten은 -Os + Binaryen wasm-opt 단계에서 import 이름을 minify한다.
         * 예: `env.js_msgbox` → `a.j` (모듈/함수명 모두 단축).
         * 또한 대응하는 JS 구현이 JS library에 없으면 `_js_msgbox.stub=true`인
         * abort 스텁을 자동 생성해 `{a: {a:_malloc, ..., j:_js_msgbox_stub}}` 형태로 넘겨준다.
         *
         * 따라서 wasmImports 전체를 순회하며:
         *   1) stub 함수(toString에 "missing function: XXX" 포함)를 탐지하고
         *   2) XXX 풀네임과 일치하는 userEnv 구현으로 교체한다.
         *
         * 이는 minify 유무, 모듈 이름(env/a) 구분 없이 안전하게 동작한다.
         */
        const wasmImportsPatched: Record<string, Record<string, unknown>> = { ...wasmImports };
        const stubOverrideSummary: Record<string, string> = {};
        let unresolvedStubs = 0;
        for (const modName of Object.keys(wasmImportsPatched)) {
          const origMod = wasmImportsPatched[modName];
          if (!origMod) continue;
          const patchedMod: Record<string, unknown> = { ...origMod };
          for (const shortName of Object.keys(patchedMod)) {
            const fn = patchedMod[shortName];
            if (typeof fn !== 'function') continue;
            const stubFlag = (fn as { stub?: boolean }).stub === true;
            const src = stubFlag ? '' : Function.prototype.toString.call(fn);
            const m = stubFlag
              ? /* stub=true 표식이 붙은 함수는 name으로 원본 이름을 식별한다(_js_msgbox 등). */
                /^_?(js_[A-Za-z_][A-Za-z0-9_]*)$/.exec((fn as { name?: string }).name ?? '')
              : /missing function:\s*([\w$]+)/.exec(src);
            if (!m) continue;
            const longName = m[1];
            const impl = userEnv[longName];
            if (typeof impl === 'function') {
              patchedMod[shortName] = impl;
              stubOverrideSummary[`${modName}.${shortName}`] = longName;
            } else {
              unresolvedStubs++;
              console.warn(`[WasmRgssRuntime] 스텁 교체 실패 — ${modName}.${shortName} (원본 이름=${longName}) 에 대응하는 JS 구현이 없습니다.`);
            }
          }
          wasmImportsPatched[modName] = patchedMod;
        }

        /*
         * user가 제공했지만 wasm이 import하지 않은 함수(또는 minify 끈 빌드)의 경우
         * wasmImports[modName]에 해당 풀네임이 없을 수 있으니 env/모든 모듈에 풀네임도 병합해 둔다.
         * minify가 꺼진 빌드(env.js_msgbox 그대로)에서도 안전.
         */
        if (wasmImportsPatched['env']) {
          wasmImportsPatched['env'] = { ...wasmImportsPatched['env'], ...userEnv };
        } else {
          wasmImportsPatched['env'] = { ...userEnv };
        }

        const patchedCount = Object.keys(stubOverrideSummary).length;
        this.debug(`instantiateWasm: stub→impl 교체 ${patchedCount}건, 미해결 ${unresolvedStubs}건`);
        if (patchedCount === 0) {
          console.warn('[WasmRgssRuntime] wasmImports에서 교체할 stub을 찾지 못했습니다. Emscripten 빌드 옵션 변경/문자열 포맷 변경 가능성.');
        }

        const finalImports: Record<string, Record<string, unknown>> = wasmImportsPatched;
        const base = sanitizeModulePath(this.opts.wasmModuleUrl).replace(/[^/]+$/, '') || '/';
        let wasmUrl: string;
        const cacheBuster = `v=${Date.now()}`;
        try {
          const u = new URL(this.opts.wasmModuleUrl, typeof window !== 'undefined' ? window.location.href : 'http://localhost');
          u.pathname = base + 'webrgss.wasm';
          u.search = cacheBuster;
          u.hash = '';
          wasmUrl = u.href;
        } catch {
          const raw = this.opts.wasmModuleUrl.replace(/\.mjs$/, '.wasm');
          wasmUrl = raw + (raw.includes('?') ? '&' : '?') + cacheBuster;
        }
        this.debug(`WASM fetch: ${wasmUrl}`);
        fetch(wasmUrl)
          .then(r => r.arrayBuffer())
          .then(buf => WebAssembly.instantiate(buf, finalImports as WebAssembly.Imports))
          .then(r => successCallback(r.instance))
          .catch((e: unknown) => { throw e; });
        return {};
      },
    });

    this.mem = new WasmMemory(this.emMod);
    this.bridge.setMemory(this.mem);

    /* WASM export 함수 바인딩 */
    const em: any = this.emMod;
    this.fnInit         = em._wrgss_init as (() => number);
    this.fnExecScript   = em._wrgss_exec_script as ((a: number, b: number) => number);
    this.fnExecBytecode = typeof em._wrgss_exec_bytecode === 'function'
      ? em._wrgss_exec_bytecode as ((a: number, b: number, c: number) => number)
      : undefined;
    this.fnTick       = em._wrgss_tick as (() => number);
    this.fnShutdown   = em._wrgss_shutdown as (() => void);
    this.fnDebugTickProbe = typeof em._wrgss_debug_tick_probe === 'function'
      ? em._wrgss_debug_tick_probe as (() => number)
      : undefined;
    this.fnDebugGameRunning = typeof em._wrgss_debug_game_running === 'function'
      ? em._wrgss_debug_game_running as (() => number)
      : undefined;
    this.fnDebugIsFiber = typeof em._wrgss_debug_is_fiber === 'function'
      ? em._wrgss_debug_is_fiber as (() => number)
      : undefined;

    const initResult = this.fnInit();
    if (initResult !== 0) {
      throw new Error(`wrgss_init 실패: ${initResult}`);
    }
    this.debug('WASM init 성공');
  }

  /**
   * 스크립트 실행 — Scripts.rvdata2 순서대로 실행.
   *
   * 필수: Main 스크립트(가장 마지막)에 반드시 `rgss_main { SceneManager.run }` 가 있어야 함.
   * C 엔진의 wrgss_tick은 이 블록으로 생성된 Fiber를 resume하여 게임 루프를 구동한다.
   * rgss_main이 없으면 첫 tick에서 즉시 0 반환 → 게임 종료.
   */
  private async executeScripts(): Promise<{ failedIndices: number[]; failedDetails: Array<{ index: number; title: string; detail: string }> }> {
    if (!this.fnExecScript || !this.mem) return { failedIndices: [], failedDetails: [] };

    // 0) Object.defined? — woratana's Database Limit Breaker 등에서 Object.defined?(Const) 사용.
    //    반드시 다른 부트스트랩보다 먼저 단독 실행 (WASM_BOOTSTRAP_SCRIPT 내 다른 코드 실패 시에도 정의 유지).
    await this.execBootstrap('OBJECT_DEFINED_BOOTSTRAP', OBJECT_DEFINED_BOOTSTRAP);

    // mruby에 Marshal이 없으므로, load_data를 JSON.parse 기반으로 재정의하는 부트스트랩 주입
    await this.execBootstrap('WASM_BOOTSTRAP_SCRIPT', WASM_BOOTSTRAP_SCRIPT);

    const failedIndices: number[] = [];
    const failedDetails: Array<{ index: number; title: string; detail: string }> = [];

    const scripts = this.patchMainScriptLoops(this.opts.scripts);

    for (const script of scripts) {
      const orig = this.opts.scripts.find((s) => s.index === script.index);
      const needsPatch =
        orig &&
        (/rgss_main\s*\{/.test(orig.code) ||
          /Graphics\.transition\s*\(/.test(orig.code) ||
          /Graphics\.wait\s*\(/.test(orig.code));
      const useBytecode =
        script.bytecode &&
        script.bytecode.length > 0 &&
        this.fnExecBytecode &&
        !needsPatch;

      if (!useBytecode && !script.code.trim()) continue;

      if (needsPatch && script.bytecode?.length) {
        this.debug(`[${script.index}] ${script.title}: 패치 필요 → 바이트코드 대신 소스 실행`);
      }

      this._lastMsgbox.length = 0;
      const namePtr = this.mem.allocStr(`${script.index}_${script.title}`);

      let result: unknown;
      if (useBytecode && script.bytecode) {
        const [bufPtr, bufLen] = this.mem.allocBytes(script.bytecode);
        try {
          result = this.fnExecBytecode!(bufPtr, bufLen, namePtr);
          if (result != null && typeof (result as { then?: unknown }).then === 'function') {
            result = await (result as Promise<number>);
          }
        } finally {
          this.mem.freeBytes(bufPtr);
        }
      } else {
        const srcPtr = this.mem.allocStr(script.code);
        try {
          result = this.fnExecScript(srcPtr, namePtr);
          if (result != null && typeof (result as { then?: unknown }).then === 'function') {
            result = await (result as Promise<number>);
          }
        } finally {
          this.mem.freeStr(srcPtr);
        }
      }

      this.mem.freeStr(namePtr);

      if (result !== 0) {
        const detail = this._lastMsgbox.length > 0
          ? this._lastMsgbox.join(' | ')
          : '(상세 없음)';
        const isKnownCompatIssue =
          /String cannot be converted to Integer/i.test(detail) ||
          /private method 'initialize' called for (Module|Struct)/i.test(detail) ||
          /undefined method 'defined\?' for/i.test(detail) ||
          /compile/i.test(detail);
        if (isKnownCompatIssue) {
          console.warn(`[WasmRgssRuntime] mruby 호환성 경고 (게임 계속): [${script.index}] ${script.title} — ${detail}`);
        } else {
          failedIndices.push(script.index);
          failedDetails.push({ index: script.index, title: script.title, detail });
          this.opts.onError?.(`스크립트 실행 오류: [${script.index}] ${script.title} — ${detail}`, this.getDiagnostics());
        }
      }
    }

    // 프로젝트 스크립트 로드 이후(Window_Base 정의 이후) 텍스트 색 fallback 패치 적용.
    await this.execBootstrap('WINDOW_BASE_TEXT_COLOR_PATCH', WINDOW_BASE_TEXT_COLOR_PATCH);

    // Main 스크립트에 rgss_main { SceneManager.run } 존재 여부 검증
    this._hasRgssMain = this.opts.scripts.some((s) => /rgss_main\s*\{/.test(s.code));
    if (!this._hasRgssMain) {
      this.debug('경고: rgss_main { } 블록을 포함한 스크립트가 없습니다. Main 스크립트에 rgss_main { SceneManager.run } 이 필요합니다.');
    }

    // Main 실행 폴백 제거: SceneManager.run은 rgss_main Fiber 블록 내에서만 실행되어야 함.
    // fallback에서 직접 SceneManager.run 호출 시 Fiber.yield가 "attempt to yield on a not resumed fiber" 발생.
    // 첫 tick의 Fiber.resume이 SceneManager.run을 실행함.
    // this.execBootstrap(SCENE_MANAGER_RUN_FALLBACK);

    return { failedIndices, failedDetails };
  }

  /**
   * 게임 루프 — Fiber 전용 모드.
   *
   * 정책:
   * - 반드시 _wrgss_tick(Fiber.resume) 경로만 허용한다.
   * - FRAME_TICK_SCRIPT 폴백은 사용하지 않는다.
   */
  private _cachedTickPtr: number | null = null;
  private _cachedTickNamePtr: number | null = null;

  private startLoop(): void {
    const fnTick = this.fnTick;
    if (!fnTick) {
      this.opts.onError?.('[WasmRgssRuntime] Fiber tick 함수(_wrgss_tick)가 없어 실행 불가', this.getDiagnostics());
      this.setState('error');
      this.stop();
      return;
    }

    this.lastTime = performance.now();
    this.lastLoopProgressAt = this.lastTime;
    this.loopTickCounter = 0;

    let tickBusy = false;

    const tick1 = (now: number) => {
      this.rafId = requestAnimationFrame(tick1);
      if (tickBusy) return;
      const elapsed = now - this.lastTime;
      const interval = this.frameIntervalMs;
      if (elapsed < interval) return;

      const framesElapsed = Math.floor(elapsed / interval);
      const ticksToRun = Math.min(
        Math.max(1, framesElapsed) * this._playbackSpeed,
        MAX_TICKS_PER_FRAME
      );
      this.lastTime = now - (elapsed % interval);

      tickBusy = true;
      this.runTicks(fnTick, ticksToRun).finally(() => { tickBusy = false; });
    };

    this.loopWatchdogTimer = setInterval(() => {
      if (this.state !== 'running') return;
      const stalledFor = performance.now() - this.lastLoopProgressAt;
      if (stalledFor > 4000) {
        const base = `[WasmRgssRuntime] 루프 정지 감지: ${Math.round(stalledFor)}ms 동안 tick 진행 없음 (tickCount=${this.loopTickCounter}, state=${this.state}, attempt=${this.bootAttempt})`;
        const msgbox = this._lastMsgbox.length > 0
          ? `\n\n[Ruby 예외]\n${this._lastMsgbox.slice(-3).join('\n---\n')}`
          : '';
        const stderr = this._lastPrintErr.length > 0
          ? `\n\n[stderr]\n${this._lastPrintErr.slice(-5).join('\n')}`
          : '';
        this.opts.onError?.(`${base}${msgbox}${stderr}`, this.getDiagnostics());
      }
    }, 2000);

    this.rafId = requestAnimationFrame(tick1);
  }

  private async runFrameTickScript(): Promise<boolean> {
    if (!this.fnExecScript || !this.mem) return false;
    if (this._cachedTickPtr === null) {
      this._cachedTickPtr = this.mem.allocStr(FRAME_TICK_SCRIPT);
    }
    if (this._cachedTickNamePtr === null) {
      this._cachedTickNamePtr = this.mem.allocStr('__wrgss_frame_tick__');
    }

    try {
      let result: unknown = this.fnExecScript(this._cachedTickPtr, this._cachedTickNamePtr);
      if (result != null && typeof (result as { then?: unknown }).then === 'function') {
        result = await (result as Promise<number>);
      }
      if (result !== 0) {
        console.error(`[WasmRgssRuntime] FRAME_TICK_SCRIPT 실행 실패 (code=${String(result)})`);
        return false;
      }
      return true;
    } catch (err) {
      console.error(
        `[WasmRgssRuntime] FRAME_TICK_SCRIPT 예외: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
      return false;
    }
  }

  private async activateFrameTickFallback(): Promise<boolean> {
    if (this.loopFallbackInFlight) return true;

    this.loopFallbackInFlight = true;
    this._lastMsgbox.length = 0;
    const initOk = await this.execBootstrap('SCENE_MANAGER_INIT_FIRST_SCENE', SCENE_MANAGER_INIT_FIRST_SCENE);
    if (!initOk) {
      console.warn('[WasmRgssRuntime] SCENE_MANAGER_INIT_FIRST_SCENE 실패 — 기존 scene 상태로 fallback 진행');
    }
    const tickOk = await this.runFrameTickScript();
    if (!tickOk) {
      this.loopFallbackInFlight = false;
      return false;
    }
    this.debug('probe21 감지: FRAME_TICK_SCRIPT fallback 활성화');
    return true;
  }

  private async runTicks(fnTick: () => unknown, ticksToRun: number): Promise<void> {
    try {
      for (let i = 0; i < ticksToRun; i++) {
        this.bridge?.triggerRender();
        if (this.loopFallbackInFlight) {
          const frameOk = await this.runFrameTickScript();
          if (!frameOk) {
            const base = '[WasmRgssRuntime] FRAME_TICK_SCRIPT fallback 실행 실패';
            const msgbox = this._lastMsgbox.length > 0
              ? `\n\n[Ruby 예외]\n${this._lastMsgbox.slice(-3).join('\n---\n')}`
              : '';
            const stderr = this._lastPrintErr.length > 0
              ? `\n\n[stderr]\n${this._lastPrintErr.slice(-5).join('\n')}`
              : '';
            this.opts.onError?.(`${base}${msgbox}${stderr}`, this.getDiagnostics());
            this.setState('error');
            this.stop();
            return;
          }
          continue;
        }
        if (this.loopTickCounter === 0 && i === 0) {
          // #region agent log
          const probe = this.fnDebugTickProbe ? this.fnDebugTickProbe() : -1;
          const gameRunning = this.fnDebugGameRunning ? this.fnDebugGameRunning() : -1;
          const isFiber = this.fnDebugIsFiber ? this.fnDebugIsFiber() : -1;
          fetch('http://localhost:7661/ingest/16241cee-ac72-4c45-8a04-497970351cc7',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'634f61'},body:JSON.stringify({sessionId:'634f61',location:'WasmRgssRuntime.ts:runTicks:beforeFirstTick',message:'H2/H3: before first fnTick',data:{probe,gameRunning,isFiber,state:this.state},hypothesisId:'H2',timestamp:Date.now()})}).catch(()=>{});
          // #endregion
          console.log('[WasmRgssRuntime] first tick calling fnTick()...');
        }
        let running: unknown = fnTick();

        /* Asyncify wraps WASM exports — fnTick() may return a Promise */
        if (running != null && typeof (running as {then?: unknown}).then === 'function') {
          console.log('[WasmRgssRuntime] fnTick returned Promise — awaiting...');
          try {
            running = await (running as Promise<number>);
          } catch (e) {
            console.error('[WasmRgssRuntime] fnTick Promise rejected:', e);
            running = 0;
          }
        }

        if (this.loopTickCounter === 0 && i === 0) {
          console.log(`[WasmRgssRuntime] first tick result=${String(running)} (type=${typeof running})`);
        }

        if (!running) {
          const probe = this.fnDebugTickProbe ? this.fnDebugTickProbe() : -1;
          const gameRunning = this.fnDebugGameRunning ? this.fnDebugGameRunning() : -1;
          const isFiber = this.fnDebugIsFiber ? this.fnDebugIsFiber() : -1;
          const isFirstFiberDead =
            this.loopTickCounter === 0 &&
            i === 0 &&
            probe === 21 &&
            isFiber === 1;
          if (isFirstFiberDead) {
            const fallbackOk = await this.activateFrameTickFallback();
            if (fallbackOk) {
              console.warn('[WasmRgssRuntime] 첫 Fiber tick dead(probe=21) 감지 — FRAME_TICK_SCRIPT fallback으로 전환');
              continue;
            }
          }
          // #region agent log
          if (this.loopTickCounter === 0 && i === 0) {
            fetch('http://localhost:7661/ingest/16241cee-ac72-4c45-8a04-497970351cc7',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'634f61'},body:JSON.stringify({sessionId:'634f61',location:'WasmRgssRuntime.ts:runTicks:firstTickReturned0',message:'H3/H4: first tick returned 0',data:{probe,gameRunning,isFiber,probe21FiberDead:probe===21},hypothesisId:'H3',timestamp:Date.now()})}).catch(()=>{});
          }
          // #endregion
          console.error(
            `[WasmRgssRuntime] fnTick()=${String(running)} tick=${i} loopCounter=${this.loopTickCounter} probe=${probe} gameRunning=${gameRunning} isFiber=${isFiber}`
          );
          const base = i === 0
            ? '[WasmRgssRuntime] Fiber 초기 tick이 0을 반환했습니다. fallback 전환 실패로 종료합니다.'
            : '[WasmRgssRuntime] Fiber tick이 종료를 반환했습니다.';
          const rgssHint = !this._hasRgssMain
            ? '\n\n[진단] rgss_main { SceneManager.run } 이 Main 스크립트(마지막)에 없을 수 있습니다.'
            : '';
          const tickHint =
            `\n\n[진단] loopTickCounter=${this.loopTickCounter}, state=${this.state}, attempt=${this.bootAttempt}, ` +
            `tickProbe=${probe}, gameRunning=${gameRunning}, isFiber=${isFiber}`;
          const msgbox = this._lastMsgbox.length > 0
            ? `\n\n[Ruby 예외]\n${this._lastMsgbox.slice(-3).join('\n---\n')}`
            : '';
          const stderr = this._lastPrintErr.length > 0
            ? `\n\n[stderr]\n${this._lastPrintErr.slice(-5).join('\n')}`
            : '';
          const fullMsg = `${base}${rgssHint}${tickHint}${msgbox}${stderr}`;
          console.error('[WasmRgssRuntime] tick 실패:', fullMsg);
          this.opts.onError?.(fullMsg, this.getDiagnostics());
          this.setState('error');
          this.stop();
          return;
        }
      }
      if (this.loopTickCounter === 0 && ticksToRun > 0) {
        fetch('http://localhost:7661/ingest/16241cee-ac72-4c45-8a04-497970351cc7',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'634f61'},body:JSON.stringify({sessionId:'634f61',location:'WasmRgssRuntime.ts:runTicks:firstTickSuccess',message:'first tick returned 1 (running)',data:{ticksToRun},hypothesisId:'H6',timestamp:Date.now()})}).catch(()=>{});
      }
      this.loopTickCounter += ticksToRun;
      this.lastLoopProgressAt = performance.now();
      this.bridge?.triggerRender();
    } catch (err) {
      const base = err instanceof Error ? err.message : String(err);
      const msgbox = this._lastMsgbox.length > 0
        ? `\n\n[Ruby 예외]\n${this._lastMsgbox.slice(-3).join('\n---\n')}`
        : '';
      const stderr = this._lastPrintErr.length > 0
        ? `\n\n[stderr]\n${this._lastPrintErr.slice(-5).join('\n')}`
        : '';
      this.opts.onError?.(`${base}${msgbox}${stderr}`, this.getDiagnostics());
      this.setState('error');
      this.stop();
    }
  }

  private freeTickCache(): void {
    if (this.mem) {
      if (this._cachedTickPtr !== null) {
        this.mem.freeStr(this._cachedTickPtr);
        this._cachedTickPtr = null;
      }
      if (this._cachedTickNamePtr !== null) {
        this.mem.freeStr(this._cachedTickNamePtr);
        this._cachedTickNamePtr = null;
      }
    }
  }

  /**
   * RGSS3 전용: 무한 루프 제거 + mruby 호환성 패치.
   * SceneManager.run 내 @scene.main while @scene → 최초 씬 체인 start + post_start/perform_transition
   *
   * 핵심: Scene_Boot.start 내에서 SceneManager.goto(Scene_Title) 이 호출되어 @scene 이 바뀌면,
   * 바뀐 Scene_Title.start 도 반드시 호출해야 커맨드 윈도우 등 초기화가 된다.
   * → @scene 이 변경됐으면 새 씬의 start 까지 호출하는 체인 루프 사용.
   */
  private patchMainScriptLoops(scripts: RgssScript[]): RgssScript[] {
    // SceneManager.run의 @scene.main while @scene 계약은 원본 RGSS 흐름을 유지한다.
    // 해당 루프를 JS/부트스트랩에서 직접 재작성하면 Scene lifecycle(start/post_start/update)
    // 순서가 깨져 첫 tick 종료(Fiber dead)로 이어질 수 있으므로 치환하지 않는다.
    return scripts.map((s) => {
      let code = s.code;

      // 0) rgss_main { SceneManager.run } — 절대 수정/제거 금지.
      //    Main 스크립트(마지막 실행)에 필수. C가 이 블록으로 Fiber를 만들고 wrgss_tick이 resume함.
      //    패치 대상: SceneManager.run 내부의 @scene.main while @scene 만. rgss_main 호출은 그대로 둠.

      // 1) Graphics.transition: C 경계 yield 제거됨. 전환 프레임은 Ruby Fiber.yield로 처리.
      //     Graphics.transition(dur, ...) → Graphics.transition(dur, ...); dur.to_i.times { Fiber.yield }
      //     첫 번째 인자(지속 시간)만 사용. .to_i로 Float 대비.
      code = code.replace(
        /Graphics\.transition\s*\(\s*([^,)]+)((?:,[^)]*)?)\s*\)/g,
        (_m: string, dur: string, rest: string) =>
          `Graphics.transition(${dur}${rest}); ${dur}.to_i.times { Fiber.yield }`
      );
      // 1b) Graphics.wait: C 경계 yield 제거됨. 대기 프레임은 Ruby Fiber.yield로 처리.
      code = code.replace(
        /Graphics\.wait\s*\(\s*([^)]+)\s*\)/g,
        (_m: string, arg: string) => `Graphics.wait(${arg}); (${arg}).to_i.times { Fiber.yield }`
      );

      // 2) mruby String→Integer 호환: Integer("0xFF") 형태 → "0xFF".to_i(16) 등은 부트스트랩이 처리하므로
      //    compile-time 에러를 유발하는 문법 패턴만 제거.
      //    Regexp 리터럴을 String#[] 인덱스로 쓰는 패턴: str[/regex/] → mruby 미지원 → nil로 대체
      code = code.replace(/(\w+)\[\/([^/]+)\/\]/g, 'nil # wrgss_patched');

      // 2b) mruby에서 `defined?` 키워드는 미구현 (NameError).
      //     receiver.defined?(expr), bare defined?(expr) 모두 치환.
      //     instance_variable_defined?, method_defined? 등은 제외.
      const definedReplacer = (_m: string, arg: string) => {
        const trimmed = arg.trim();
        if (/^[\w:]+\.[\w?!]+$/.test(trimmed)) {
          const dot = trimmed.lastIndexOf('.');
          return `${trimmed.slice(0, dot)}.respond_to?(:${trimmed.slice(dot + 1)})`;
        }
        return `(Object.const_defined?(:${trimmed}) rescue false)`;
      };
      // receiver.defined?(expr)
      code = code.replace(
        /([\w:@]+)\.defined\?\s*\(\s*([^)]*?)\s*\)/g,
        (_m: string, _recv: string, arg: string) => definedReplacer(_m, arg)
      );
      // receiver.defined? expr (괄호 없는 형태)
      code = code.replace(
        /([\w:@]+)\.defined\?\s+([a-zA-Z0-9_:@.]+)/g,
        (_m: string, _recv: string, arg: string) => definedReplacer(_m, arg)
      );
      // bare defined?(expr) — 키워드 호출
      code = code.replace(
        /(?<![.\w])defined\?\s*\(\s*([^)]*?)\s*\)/g,
        (_m: string, arg: string) => definedReplacer(_m, arg)
      );

      // 2c) bitmap.font가 nil이거나 Font 클래스가 없을 때 NoMethodError/NameError 방지.
      //     mruby webrgss에서 Bitmap#font가 nil을 반환하거나 Font 상수가 없을 수 있음.
      //     obj.bitmap.font.size = N → rescue nil로 실패 시 무시 (draw_text는 기본값 사용)
      code = code.replace(
        /([\w@]+)\.bitmap\.font\.size\s*=\s*(\d+)/g,
        (_m: string, obj: string, n: string) =>
          `((${obj}).bitmap.font.size = ${n}) rescue nil`
      );

      // 3) Module에 직접 .new 를 호출하거나 initialize를 정의하는 패턴을 rescue로 감싸기.
      //    "private method 'initialize' called for Module" 에러 원인:
      //    mruby에서 Module/module 내에서 def initialize 를 정의하면 에러.
      //    → 해당 스크립트 전체를 rescue 블록으로 wrap.
      const hasModuleInitError =
        /module\s+\w+[\s\S]*def\s+initialize/.test(code) ||
        /class\s+\w+\s*<\s*Module\b/.test(code);
      if (hasModuleInitError) {
        code = `begin\n${code}\nrescue => __e\n  p "[WasmRgssRuntime] 호환성 경고 (skip): #{__e.message}"\nend`;
      }

      // 4) Ruby Traceback 출력 — 예외 발생 시 backtrace를 메시지에 포함해 재발생.
      //    C가 js_msgbox로 전달할 때 traceback이 포함된 전체 메시지가 전달됨.
      //    [RGSS Script Error] [index] title 헤더로 어느 스크립트 오류인지 명확히 출력.
      const titleEsc = String(s.title).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      code = `__RGSS_SCRIPT_INDEX = ${s.index}
__RGSS_SCRIPT_TITLE = "${titleEsc}"
begin
${code}
rescue => __rgss_err
  __header = "[RGSS Script Error] [#{__RGSS_SCRIPT_INDEX}] #{__RGSS_SCRIPT_TITLE}"
  __bt = (__rgss_err.backtrace rescue nil) || []
  __bt_str = __bt.respond_to?(:join) ? __bt.join("\\n") : __bt.to_s
  __full = __header + "\\n\\n" + __rgss_err.class.to_s + ": " + __rgss_err.message.to_s + "\\n\\nTraceback:\\n" + __bt_str
  raise RuntimeError.new(__full)
end`;

      return code !== s.code ? { ...s, code } : s;
    });
  }

  private async execBootstrap(name: string, code: string): Promise<boolean> {
    if (!this.fnExecScript || !this.mem) return false;
    const srcPtr = this.mem.allocStr(code);
    const namePtr = this.mem.allocStr('__wasm_bootstrap__');
    this._lastPrintErr.length = 0;
    try {
      let result: unknown = this.fnExecScript(srcPtr, namePtr);
      if (result != null && typeof (result as { then?: unknown }).then === 'function') {
        result = await (result as Promise<number>);
      }
      if (result !== 0) {
        const stderr = this._lastPrintErr.length > 0
          ? `\n  stderr: ${this._lastPrintErr.join(' | ')}`
          : '';
        console.error(`[WasmRgssRuntime] 부트스트랩 스크립트 실행 실패: ${name} (code=${String(result)})${stderr}`);
        return false;
      }
      return true;
    } catch (err) {
      const stderr = this._lastPrintErr.length > 0
        ? `\n  stderr: ${this._lastPrintErr.join(' | ')}`
        : '';
      console.error(
        `[WasmRgssRuntime] 부트스트랩 스크립트 예외: ${name} — ${
          err instanceof Error ? err.message : String(err)
        }${stderr}`
      );
      return false;
    } finally {
      this.mem.freeStr(srcPtr);
      this.mem.freeStr(namePtr);
    }
  }

  private setState(s: WasmRgssState): void {
    this.state = s;
    this.debug(`state -> ${s}`);
    this.opts.onStateChange?.(s);
  }
}

/**
 * WASM mruby 부트스트랩 스크립트.
 *
 * mruby에 Marshal이 없으므로 C 측 load_data가 원시 바이트를 String으로
 * 반환한다. JS 측 WasmRgssBridge는 rvdata2 파일을 미리 JSON으로 변환해둔다.
 *
 * 이 부트스트랩은:
 *  1) C 측 load_data를 alias로 보존 (__orig_load_data)
 *  2) load_data를 재정의: __orig_load_data 결과가 String이면 JSON 파싱 수행
 *  3) JSON 내 @ivar 키를 가진 Hash를 method_missing 기반 객체로 복원
 *
 * mruby에 JSON 모듈이 없을 수 있으므로 최소한의 JSON 파서를 Ruby로 내장.
 */
/**
 * mruby defined? 호환 부트스트랩.
 *
 * mruby 제한사항: defined? 키워드가 미구현이거나 파서 토큰으로만 존재.
 * `defined?`를 메서드 이름으로 사용하면 파싱 실패(code=-1)할 수 있으므로
 * wrgss_defined? 별도 이름으로 정의. 스크립트 패치에서 defined? 호출을
 * Object.const_defined? / respond_to? 로 치환하므로 이 메서드는 폴백 전용.
 */
const OBJECT_DEFINED_BOOTSTRAP = [
  'def Object.wrgss_defined?(arg)',
  '  return "constant" if arg.is_a?(Module) || arg.is_a?(Class)',
  '  if arg.is_a?(Symbol)',
  '    return "constant" if (Object.const_defined?(arg) rescue false)',
  '  end',
  '  if arg.is_a?(String)',
  '    sym = arg.to_sym rescue nil',
  '    return "constant" if sym && (Object.const_defined?(sym) rescue false)',
  '  end',
  '  nil',
  'end',
].join('\n');

const WASM_BOOTSTRAP_SCRIPT = [
  // ─── 전역 변수 (Project11 DataManager / SceneManager 호환) ─────────────────
  '$BTEST = false',
  '',
  // Dir.glob — C가 js_dir_glob 호출해 구현 시 Save*.rvdata2 반환. 미구현 시 [].
  'module Dir',
  '  def self.glob(pat); []; end',
  'end',
  '',
  // JSON parser — mruby core only (no string-ext gems)
  'module WrgssJsonParser',
  '  def self.parse(str)',
  '    ctx = [str, 0]',
  '    read_value(ctx)',
  '  end',
  '  def self.ws?(c)',
  '    c == " " || c == "\\t" || c == "\\n" || c == "\\r"',
  '  end',
  '  def self.skip_ws(ctx)',
  '    while ctx[1] < ctx[0].length',
  '      break unless ws?(ctx[0][ctx[1]])',
  '      ctx[1] += 1',
  '    end',
  '  end',
  '  def self.peek(ctx)',
  '    skip_ws(ctx)',
  '    ctx[1] < ctx[0].length ? ctx[0][ctx[1]] : nil',
  '  end',
  '  def self.read_value(ctx)',
  '    skip_ws(ctx)',
  '    return nil if ctx[1] >= ctx[0].length',
  '    c = ctx[0][ctx[1]]',
  '    if c == \'"\'; return read_string(ctx); end',
  '    if c == "{"; return read_object(ctx); end',
  '    if c == "["; return read_array(ctx); end',
  '    if c == "t"; ctx[1] += 4; return true; end',
  '    if c == "f"; ctx[1] += 5; return false; end',
  '    if c == "n"; ctx[1] += 4; return nil; end',
  '    read_number(ctx)',
  '  end',
  '  def self.read_string(ctx)',
  '    ctx[1] += 1',
  '    buf = ""',
  '    while ctx[1] < ctx[0].length',
  '      c = ctx[0][ctx[1]]',
  '      if c == "\\\\"',
  '        ctx[1] += 1',
  '        nc = ctx[0][ctx[1]]',
  '        if nc == "n"; buf = buf + "\\n"',
  '        elsif nc == "r"; buf = buf + "\\r"',
  '        elsif nc == "t"; buf = buf + "\\t"',
  '        elsif nc == "u"',
  '          ctx[1] += 1',
  '          hex = ctx[0][ctx[1], 4]',
  '          ctx[1] += 3',
  '          buf = buf + hex.to_i(16).chr',
  '        else',
  '          buf = buf + nc.to_s',
  '        end',
  '      elsif c == \'"\'',
  '        ctx[1] += 1',
  '        return buf',
  '      else',
  '        buf = buf + c',
  '      end',
  '      ctx[1] += 1',
  '    end',
  '    buf',
  '  end',
  '  def self.read_number(ctx)',
  '    start = ctx[1]',
  '    is_float = false',
  '    ctx[1] += 1 if ctx[0][ctx[1]] == "-"',
  '    while ctx[1] < ctx[0].length',
  '      c = ctx[0][ctx[1]]',
  '      if c >= "0" && c <= "9"',
  '        ctx[1] += 1',
  '      elsif c == "." || c == "e" || c == "E" || c == "+" || c == "-"',
  '        is_float = true',
  '        ctx[1] += 1',
  '      else',
  '        break',
  '      end',
  '    end',
  '    s = ctx[0][start, ctx[1] - start]',
  '    is_float ? s.to_f : s.to_i',
  '  end',
  '  def self.read_object(ctx)',
  '    ctx[1] += 1',
  '    hash = {}',
  '    skip_ws(ctx)',
  '    if peek(ctx) == "}"',
  '      ctx[1] += 1',
  '      return hash',
  '    end',
  '    while true',
  '      skip_ws(ctx)',
  '      key = read_string(ctx)',
  '      skip_ws(ctx)',
  '      ctx[1] += 1',
  '      val = read_value(ctx)',
  '      hash[key] = val',
  '      skip_ws(ctx)',
  '      c = ctx[0][ctx[1]]',
  '      ctx[1] += 1',
  '      break if c == "}"',
  '    end',
  '    hash',
  '  end',
  '  def self.read_array(ctx)',
  '    ctx[1] += 1',
  '    arr = []',
  '    skip_ws(ctx)',
  '    if peek(ctx) == "]"',
  '      ctx[1] += 1',
  '      return arr',
  '    end',
  '    while true',
  '      arr.push(read_value(ctx))',
  '      skip_ws(ctx)',
  '      c = ctx[0][ctx[1]]',
  '      ctx[1] += 1',
  '      break if c == "]"',
  '    end',
  '    arr',
  '  end',
  'end',
  '',
  // Data object: method_missing-based accessor for @ivar fields
  'class WrgssDataObject',
  '  def method_missing(name, *args)',
  '    s = name.to_s',
  '    if s[-1] == "=" && args.length == 1',
  '      attr = s[0, s.length - 1]',
  '      instance_variable_set(("@" + attr).to_sym, args[0])',
  '    else',
  '      ivar = ("@" + s).to_sym',
  '      if instance_variable_defined?(ivar)',
  '        instance_variable_get(ivar)',
  '      else',
  '        nil',
  '      end',
  '    end',
  '  end',
  '  def respond_to_missing?(name, priv = false)',
  '    ivar = ("@" + name.to_s).to_sym',
  '    instance_variable_defined?(ivar) || name.to_s[-1] == "=" || super',
  '  end',
  '  def [](key)',
  '    ivar = ("@" + key.to_s).to_sym',
  '    instance_variable_defined?(ivar) ? instance_variable_get(ivar) : nil',
  '  end',
  '  def []=(key, val)',
  '    instance_variable_set(("@" + key.to_s).to_sym, val)',
  '  end',
  'end',
  '',
  // Restore JSON hash → WrgssDataObject when keys have @ivar style
  'module WRGSS_JSON',
  '  META_KEYS = {"__ruby_class" => 1, "__ruby_type" => 1, "__ruby_extends" => 1,',
  '               "__ruby_dump_hex" => 1, "__ruby_dump_bytes" => 1}',
  '  def self.esc_json(s)',
  '    r = ""',
  '    i = 0',
  '    while i < s.length',
  '      c = s[i]',
  '      if c == "\\\\"',
  '        r = r + "\\\\\\\\"',
  '      elsif c == "\\""',
  '        r = r + "\\\\\\""',
  '      elsif c == "\\n"',
  '        r = r + "\\\\n"',
  '      elsif c == "\\r"',
  '        r = r + "\\\\r"',
  '      else',
  '        r = r + c',
  '      end',
  '      i = i + 1',
  '    end',
  '    r',
  '  end',
  '  def self.esc_key(s)',
  '    r = ""',
  '    i = 0',
  '    while i < s.length',
  '      c = s[i]',
  '      if c == "\\""',
  '        r = r + "\\\\\\""',
  '      else',
  '        r = r + c',
  '      end',
  '      i = i + 1',
  '    end',
  '    r',
  '  end',
  '  def self.deep_restore(obj)',
  '    if obj.is_a?(Hash)',
  '      restored = {}',
  '      obj.each do |k, v|',
  '        key = (k.is_a?(String) && k.length > 0 && k[0] == ":") ? k.slice(1, k.length - 1).to_sym : k',
  '        restored[key] = deep_restore(v)',
  '      end',
  '      has_class = restored.has_key?("__ruby_class")',
  '      has_ivar = false',
  '      restored.each_key { |k| has_ivar = true if k.to_s[0] == "@" } unless has_class',
  '      if has_class || has_ivar',
  '        if has_class',
  '          cls = restored["__ruby_class"].to_s rescue ""',
  '          if cls == "Tone"',
  '            return Tone.new(',
  '              (restored["@red"] || restored["red"] || 0).to_f,',
  '              (restored["@green"] || restored["green"] || 0).to_f,',
  '              (restored["@blue"] || restored["blue"] || 0).to_f,',
  '              (restored["@gray"] || restored["gray"] || 0).to_f',
  '            ) if Object.const_defined?(:Tone)',
  '          end',
  '          if cls == "Color"',
  '            return Color.new(',
  '              (restored["@red"] || restored["red"] || 0).to_f,',
  '              (restored["@green"] || restored["green"] || 0).to_f,',
  '              (restored["@blue"] || restored["blue"] || 0).to_f,',
  '              (restored["@alpha"] || restored["alpha"] || 255).to_f',
  '            ) if Object.const_defined?(:Color)',
  '          end',
  '          if cls == "Rect"',
  '            return Rect.new(',
  '              (restored["@x"] || restored["x"] || 0).to_i,',
  '              (restored["@y"] || restored["y"] || 0).to_i,',
  '              (restored["@width"] || restored["width"] || 0).to_i,',
  '              (restored["@height"] || restored["height"] || 0).to_i',
  '            ) if Object.const_defined?(:Rect)',
  '          end',
  '          if cls == "RPG::BGM" || cls == "RPG::BGS" || cls == "RPG::ME" || cls == "RPG::SE"',
  '            name = (restored["@name"] || restored["name"] || "").to_s',
  '            vol = (restored["@volume"] || restored["volume"] || 100).to_i',
  '            pitch = (restored["@pitch"] || restored["pitch"] || 100).to_i',
  '            return RPG::BGM.new(name, vol, pitch) if cls == "RPG::BGM"',
  '            return RPG::BGS.new(name, vol, pitch) if cls == "RPG::BGS"',
  '            return RPG::ME.new(name, vol, pitch) if cls == "RPG::ME"',
  '            return RPG::SE.new(name, vol, pitch) if cls == "RPG::SE"',
  '          end',
  '        end',
  '        wrap = WrgssDataObject.new',
  '        restored.each do |k, v|',
  '          next if META_KEYS.has_key?(k)',
  '          ks = k.to_s',
  '          attr = ks[0] == "@" ? ks[1, ks.length - 1] : ks',
  '          next if attr == nil || attr == ""',
  '          begin',
  '            wrap.instance_variable_set(("@" + attr).to_sym, v)',
  '          rescue',
  '          end',
  '        end',
  '        return wrap',
  '      end',
  '      return restored',
  '    elsif obj.is_a?(Array)',
  '      result = []',
  '      obj.each { |v| result.push(deep_restore(v)) }',
  '      return result',
  '    end',
  '    obj',
  '  end',
  '  def self.serialize(obj)',
  '    return "null" if obj == nil',
  '    return "true" if obj == true',
  '    return "false" if obj == false',
  '    return obj.to_s if obj.is_a?(Integer) || obj.is_a?(Float)',
  '    if obj.is_a?(String)',
  '      return \'"\' + esc_json(obj) + \'"\'',
  '    end',
  '    if obj.is_a?(Array)',
  '      return "[" + obj.map { |v| serialize(v) }.join(",") + "]"',
  '    end',
  '    if obj.is_a?(Hash)',
  '      pairs = obj.map do |k, v|',
  '        key = k.is_a?(Symbol) ? ":" + k.to_s : k.to_s',
  '        \'"\' + esc_key(key) + \'":\' + serialize(v)',
  '      end',
  '      return "{" + pairs.join(",") + "}"',
  '    end',
  '    h = {}',
  '    h["__ruby_class"] = obj.class.name rescue "Object"',
  '    obj.instance_variables.each do |iv|',
  '      k = iv.to_s',
  '      v = obj.instance_variable_get(iv) rescue nil',
  '      h[k] = serialize(v) rescue "null"',
  '    end rescue nil',
  '    "{" + h.map { |k, v| \'"\' + esc_key(k.to_s) + \'":\' + v.to_s }.join(",") + "}"',
  '  end',
  'end',
  '',
  'module Marshal',
  '  def self.dump(obj, io = nil)',
  '    s = WRGSS_JSON.serialize(obj)',
  '    if io != nil && io.respond_to?(:write)',
  '      io.write(s)',
  '      io',
  '    else',
  '      s',
  '    end',
  '  rescue => e',
  '    raise TypeError, "Marshal.dump: " + e.message',
  '  end',
  '  def self.load(obj)',
  '    str = obj.respond_to?(:read) ? obj.read : obj.to_s',
  '    return WRGSS_JSON.deep_restore(WrgssJsonParser.parse(str))',
  '  rescue => e',
  '    raise ArgumentError, "Marshal.load: " + e.message',
  '  end',
  'end',
  '',
  // RPG 모듈 — taroxd/RGSS3 (https://github.com/taroxd/RGSS3) 기반. C 측 Audio 모듈(bgm_stop 등)과 연동.
  'module RPG',
  '  def self.const_missing(name)',
  '    klass = Class.new(WrgssDataObject)',
  '    const_set(name, klass)',
  '    klass',
  '  end',
  '  class AudioFile < WrgssDataObject',
  '    def initialize(name = "", volume = 100, pitch = 100)',
  '      @name = name; @volume = volume; @pitch = pitch',
  '    end',
  '  end',
  '  class BGM < AudioFile',
  '    @@last = BGM.new',
  '    def play(pos = nil)',
  '      pos = 0 if pos == nil',
  '      if @name == nil || @name.length == 0',
  '        Audio.bgm_stop',
  '        @@last = BGM.new',
  '      else',
  '        Audio.bgm_play("Audio/BGM/" + @name.to_s, @volume || 100, @pitch || 100, pos)',
  '        @@last = BGM.new(@name, @volume, @pitch)',
  '        @@last.instance_variable_set(:@pos, pos)',
  '      end',
  '    end',
  '    def replay',
  '      play(@pos || 0)',
  '    end',
  '    def self.stop',
  '      Audio.bgm_stop',
  '      @@last = BGM.new',
  '    end',
  '    def self.fade(time)',
  '      Audio.bgm_fade(time)',
  '      @@last = BGM.new',
  '    end',
  '    def self.last',
  '      @@last.instance_variable_set(:@pos, Audio.bgm_pos)',
  '      @@last',
  '    end',
  '  end',
  '  class BGS < AudioFile',
  '    @@last = BGS.new',
  '    def play(pos = nil)',
  '      pos = 0 if pos == nil',
  '      if @name == nil || @name.length == 0',
  '        Audio.bgs_stop',
  '        @@last = BGS.new',
  '      else',
  '        Audio.bgs_play("Audio/BGS/" + @name.to_s, @volume || 100, @pitch || 100, pos)',
  '        @@last = BGS.new(@name, @volume, @pitch)',
  '        @@last.instance_variable_set(:@pos, pos)',
  '      end',
  '    end',
  '    def replay',
  '      play(@pos || 0)',
  '    end',
  '    def self.stop',
  '      Audio.bgs_stop',
  '      @@last = BGS.new',
  '    end',
  '    def self.fade(time)',
  '      Audio.bgs_fade(time)',
  '      @@last = BGS.new',
  '    end',
  '    def self.last',
  '      @@last.instance_variable_set(:@pos, Audio.bgs_pos)',
  '      @@last',
  '    end',
  '  end',
  '  class ME < AudioFile',
  '    def play',
  '      if @name != nil && @name.length > 0',
  '        Audio.me_play("Audio/ME/" + @name.to_s, @volume || 100, @pitch || 100)',
  '      else',
  '        Audio.me_stop',
  '      end',
  '    end',
  '    def self.stop',
  '      Audio.me_stop',
  '    end',
  '    def self.fade(time)',
  '      Audio.me_fade(time)',
  '    end',
  '  end',
  '  class SE < AudioFile',
  '    def play',
  '      if @name != nil && @name.length > 0',
  '        Audio.se_play("Audio/SE/" + @name.to_s, @volume || 100, @pitch || 100)',
  '      end',
  '    end',
  '    def self.stop',
  '      Audio.se_stop',
  '    end',
  '  end',
  'end',
  '',
  // OpenRGSS/RGSS3 기본 Font + Bitmap font proxy + native class initialize shim
  'unless Object.const_defined?(:Font)',
  '  class Font',
  '    class << self',
  '      attr_accessor :default_name, :default_size, :default_bold, :default_italic, :default_shadow, :default_outline, :default_color, :default_out_color',
  '    end',
  '    self.default_name = "VL Gothic"',
  '    self.default_size = 24',
  '    self.default_bold = false',
  '    self.default_italic = false',
  '    self.default_shadow = false',
  '    self.default_outline = true',
  '    self.default_color = Color.new(255, 255, 255, 255) rescue nil',
  '    self.default_out_color = Color.new(0, 0, 0, 255) rescue nil',
  '    attr_reader :name, :size, :bold, :italic, :shadow, :outline, :color, :out_color',
  '    def initialize(name = nil, size = nil)',
  '      @name = name || self.class.default_name',
  '      @size = size || self.class.default_size',
  '      @bold = self.class.default_bold',
  '      @italic = self.class.default_italic',
  '      @shadow = self.class.default_shadow',
  '      @outline = self.class.default_outline',
  '      @color = WrgssFontColor.new(self, false, self.class.default_color || Color.new(255, 255, 255, 255))',
  '      @out_color = WrgssFontColor.new(self, true, self.class.default_out_color || Color.new(0, 0, 0, 255))',
  '    end',
  '    def attach_bitmap(bitmap)',
  '      @__wrgss_bitmap = bitmap',
  '      sync!',
  '      self',
  '    end',
  '    def sync!',
  '      return self if @__wrgss_bitmap == nil',
  '      @__wrgss_bitmap.__wrgss_font_name = @name if @__wrgss_bitmap.respond_to?(:__wrgss_font_name=)',
  '      @__wrgss_bitmap.__wrgss_font_size = @size if @__wrgss_bitmap.respond_to?(:__wrgss_font_size=)',
  '      @__wrgss_bitmap.__wrgss_font_bold = @bold if @__wrgss_bitmap.respond_to?(:__wrgss_font_bold=)',
  '      @__wrgss_bitmap.__wrgss_font_italic = @italic if @__wrgss_bitmap.respond_to?(:__wrgss_font_italic=)',
  '      @__wrgss_bitmap.__wrgss_font_shadow = @shadow if @__wrgss_bitmap.respond_to?(:__wrgss_font_shadow=)',
  '      @__wrgss_bitmap.__wrgss_font_outline = @outline if @__wrgss_bitmap.respond_to?(:__wrgss_font_outline=)',
  '      @__wrgss_bitmap.__wrgss_font_color = @color if @__wrgss_bitmap.respond_to?(:__wrgss_font_color=) && @color != nil',
  '      @__wrgss_bitmap.__wrgss_font_out_color = @out_color if @__wrgss_bitmap.respond_to?(:__wrgss_font_out_color=) && @out_color != nil',
  '      self',
  '    end',
  '    def name=(value); @name = value; sync!; end',
  '    def size=(value); @size = value; sync!; end',
  '    def bold=(value); @bold = !!value; sync!; end',
  '    def italic=(value); @italic = !!value; sync!; end',
  '    def shadow=(value); @shadow = !!value; sync!; end',
  '    def outline=(value); @outline = !!value; sync!; end',
  '    def color=(value); @color = WrgssFontColor.new(self, false, value || Color.new(255,255,255,255)); sync!; end',
  '    def out_color=(value); @out_color = WrgssFontColor.new(self, true, value || Color.new(0,0,0,255)); sync!; end',
  '  end',
  'end',
  'module WrgssFontColorMethods',
  '  def __wrgss_sync_font!',
  '    @__wrgss_font.sync! if @__wrgss_font != nil && @__wrgss_font.respond_to?(:sync!)',
  '    self',
  '  end',
  '  def set(*args)',
  '    super(*args)',
  '    __wrgss_sync_font!',
  '    self',
  '  end',
  '  def red=(value)',
  '    super(value)',
  '    __wrgss_sync_font!',
  '    value',
  '  end',
  '  def green=(value)',
  '    super(value)',
  '    __wrgss_sync_font!',
  '    value',
  '  end',
  '  def blue=(value)',
  '    super(value)',
  '    __wrgss_sync_font!',
  '    value',
  '  end',
  '  def alpha=(value)',
  '    super(value)',
  '    __wrgss_sync_font!',
  '    value',
  '  end',
  'end',
  'class WrgssFontColor < Color',
  '  def self.new(font, outline, source = nil)',
  '    source = Color.new(0, 0, 0, 255) if source == nil',
  '    color = Color.new(source.red, source.green, source.blue, source.alpha)',
  '    color.extend(WrgssFontColorMethods)',
  '    color.instance_variable_set(:@__wrgss_font, font)',
  '    color.instance_variable_set(:@__wrgss_outline, outline)',
  '    color',
  '  end',
  'end',
  'class Bitmap',
  '  alias __wrgss_font_get_c font',
  '  alias __wrgss_font_set_c font=',
  '  def initialize(*args)',
  '    self.font = Font.new if __wrgss_font_get_c == nil',
  '  end',
  '  def font',
  '    raw = __wrgss_font_get_c',
  '    if raw == nil',
  '      raw = Font.new',
  '      self.font = raw',
  '    elsif raw.respond_to?(:attach_bitmap)',
  '      raw.attach_bitmap(self)',
  '    end',
  '    raw',
  '  end',
  '  def font=(value)',
  '    value = Font.new if value == nil',
  '    value.attach_bitmap(self) if value.respond_to?(:attach_bitmap)',
  '    __wrgss_font_set_c(value)',
  '    value.sync! if value.respond_to?(:sync!)',
  '    value',
  '  end',
  'end',
  '',
  // RGSS Window#set_handler / handle? + native initialize shim
  'class Window',
  '  def initialize(x = 0, y = 0, width = 160, height = 96)',
  '    self.x = x if respond_to?(:x=)',
  '    self.y = y if respond_to?(:y=)',
  '    self.width = width if respond_to?(:width=)',
  '    self.height = height if respond_to?(:height=)',
  '    @__wrgss_visible = true',
  '    if respond_to?(:__wrgss_visible_set)',
  '      __wrgss_visible_set(1)',
  '    else',
  '      self.visible = 1 if respond_to?(:visible=)',
  '    end',
  '    @__wrgss_active = true',
  '    if respond_to?(:__wrgss_active_set)',
  '      __wrgss_active_set(1)',
  '    else',
  '      self.active = 1 if respond_to?(:active=)',
  '    end',
  '    self.padding = 12 if respond_to?(:padding=)',
  '    self.padding_bottom = 12 if respond_to?(:padding_bottom=)',
  '    self.opacity = 255 if respond_to?(:opacity=)',
  '    self.back_opacity = 192 if respond_to?(:back_opacity=)',
  '    self.contents_opacity = 255 if respond_to?(:contents_opacity=)',
  '    self.ox = 0 if respond_to?(:ox=)',
  '    self.oy = 0 if respond_to?(:oy=)',
  '    self.z = 100 if respond_to?(:z=)',
  '    self.openness = 255 if respond_to?(:openness=)',
  '    self.tone = Tone.new(0, 0, 0, 0) if respond_to?(:tone=) && (tone.nil? rescue true)',
  '    self.cursor_rect = Rect.new(0, 0, 0, 0) if respond_to?(:cursor_rect=) && (cursor_rect.nil? rescue true)',
  '    if respond_to?(:contents=) && (contents.nil? rescue true)',
  '      cw = width - padding * 2',
  '      ch = height - padding - padding_bottom',
  '      self.contents = Bitmap.new(cw > 0 ? cw : 1, ch > 0 ? ch : 1)',
  '    end',
  '  end',
  '  def set_handler(sym, method)',
  '    @handler = {} if @handler == nil',
  '    @handler[sym] = method',
  '  end',
  '  def handle?(symbol)',
  '    return false if @handler == nil',
  '    @handler.include?(symbol)',
  '  end',
  '  def call_handler(sym)',
  '    return if @handler == nil',
  '    m = @handler[sym]',
  '    m.call if m != nil',
  '  end',
  '  def active',
  '    instance_variable_defined?(:@__wrgss_active) ? @__wrgss_active : true',
  '  end',
  '  alias __wrgss_active_set active=',
  '  def active=(value)',
  '    @__wrgss_active = !!value',
  '    __wrgss_active_set(@__wrgss_active ? 1 : 0)',
  '  end',
  '  def visible',
  '    instance_variable_defined?(:@__wrgss_visible) ? @__wrgss_visible : true',
  '  end',
  '  alias __wrgss_visible_set visible=',
  '  def visible=(value)',
  '    @__wrgss_visible = !!value',
  '    __wrgss_visible_set(@__wrgss_visible ? 1 : 0)',
  '  end',
  '  def padding',
  '    instance_variable_defined?(:@__wrgss_padding) ? @__wrgss_padding : 12',
  '  end',
  '  alias __wrgss_padding_set padding=',
  '  def padding=(value)',
  '    @__wrgss_padding = value',
  '    __wrgss_padding_set(value)',
  '  end',
  '  def padding_bottom',
  '    instance_variable_defined?(:@__wrgss_padding_bottom) ? @__wrgss_padding_bottom : 12',
  '  end',
  '  alias __wrgss_padding_bottom_set padding_bottom=',
  '  def padding_bottom=(value)',
  '    @__wrgss_padding_bottom = value',
  '    __wrgss_padding_bottom_set(value)',
  '  end',
  '  def opacity',
  '    instance_variable_defined?(:@__wrgss_opacity) ? @__wrgss_opacity : 255',
  '  end',
  '  alias __wrgss_opacity_set opacity=',
  '  def opacity=(value)',
  '    @__wrgss_opacity = value',
  '    __wrgss_opacity_set(value)',
  '  end',
  '  def back_opacity',
  '    instance_variable_defined?(:@__wrgss_back_opacity) ? @__wrgss_back_opacity : 192',
  '  end',
  '  alias __wrgss_back_opacity_set back_opacity=',
  '  def back_opacity=(value)',
  '    @__wrgss_back_opacity = value',
  '    __wrgss_back_opacity_set(value)',
  '  end',
  '  def contents_opacity',
  '    instance_variable_defined?(:@__wrgss_contents_opacity) ? @__wrgss_contents_opacity : 255',
  '  end',
  '  alias __wrgss_contents_opacity_set contents_opacity=',
  '  def contents_opacity=(value)',
  '    @__wrgss_contents_opacity = value',
  '    __wrgss_contents_opacity_set(value)',
  '  end',
  '  def ox',
  '    instance_variable_defined?(:@__wrgss_ox) ? @__wrgss_ox : 0',
  '  end',
  '  alias __wrgss_ox_set ox=',
  '  def ox=(value)',
  '    @__wrgss_ox = value',
  '    __wrgss_ox_set(value)',
  '  end',
  '  def oy',
  '    instance_variable_defined?(:@__wrgss_oy) ? @__wrgss_oy : 0',
  '  end',
  '  alias __wrgss_oy_set oy=',
  '  def oy=(value)',
  '    @__wrgss_oy = value',
  '    __wrgss_oy_set(value)',
  '  end',
  '  def z',
  '    instance_variable_defined?(:@__wrgss_z) ? @__wrgss_z : 100',
  '  end',
  '  alias __wrgss_z_set z=',
  '  def z=(value)',
  '    @__wrgss_z = value',
  '    __wrgss_z_set(value)',
  '  end',
  'end',
  'class Sprite',
  '  def initialize(viewport = nil)',
  '    @viewport = viewport',
  '    self.visible = 1 if respond_to?(:visible=)',
  '    self.x = 0 if respond_to?(:x=)',
  '    self.y = 0 if respond_to?(:y=)',
  '    self.z = 0 if respond_to?(:z=)',
  '    self.ox = 0 if respond_to?(:ox=)',
  '    self.oy = 0 if respond_to?(:oy=)',
  '    self.zoom_x = 1.0 if respond_to?(:zoom_x=)',
  '    self.zoom_y = 1.0 if respond_to?(:zoom_y=)',
  '    self.angle = 0.0 if respond_to?(:angle=)',
  '    self.opacity = 255 if respond_to?(:opacity=)',
  '    self.blend_type = 0 if respond_to?(:blend_type=)',
  '    self.mirror = false if respond_to?(:mirror=)',
  '    self.bush_depth = 0 if respond_to?(:bush_depth=)',
  '    self.bush_opacity = 128 if respond_to?(:bush_opacity=)',
  '    self.src_rect = Rect.new(0, 0, 0, 0) if respond_to?(:src_rect=) && (src_rect.nil? rescue true)',
  '    self.color = Color.new(0, 0, 0, 0) if respond_to?(:color=) && (color.nil? rescue true)',
  '    self.tone = Tone.new(0, 0, 0, 0) if respond_to?(:tone=) && (tone.nil? rescue true)',
  '  end',
  'end',
  'class Viewport',
  '  def initialize(*args)',
  '    self.visible = 1 if respond_to?(:visible=)',
  '    self.z = 0 if respond_to?(:z=)',
  '    self.ox = 0 if respond_to?(:ox=)',
  '    self.oy = 0 if respond_to?(:oy=)',
  '    self.color = Color.new(0, 0, 0, 0) if respond_to?(:color=)',
  '    self.tone = Tone.new(0, 0, 0, 0) if respond_to?(:tone=)',
  '    if respond_to?(:rect=) && args.length == 1 && args[0].is_a?(Rect)',
  '      self.rect = args[0]',
  '    elsif respond_to?(:rect=) && args.length == 4',
  '      self.rect = Rect.new(args[0], args[1], args[2], args[3])',
  '    end',
  '  end',
  'end',
  '',
  // Override load_data
  'begin',
  '  alias __orig_load_data load_data',
  'rescue',
  'end',
  '',
  'def load_data(filename)',
  '  begin',
  '    raw = __orig_load_data(filename)',
  '  rescue',
  '    raise RuntimeError, "load_data: cannot open file"',
  '  end',
  '  if raw.is_a?(String)',
  '    begin',
  '      parsed = WrgssJsonParser.parse(raw)',
  '      return WRGSS_JSON.deep_restore(parsed)',
  '    rescue => e',
  '      raise RuntimeError, "load_data: parse error: " + e.message',
  '    end',
  '  end',
  '  raw',
  'end',
  '',
  'def save_data(obj, filename)',
  'end',
  '',
  // ─── mruby 호환성 패치 ─────────────────────────────────────────────────────
  // 1) String#[] に Range/Regexp/Symbol 인덱스를 넘기면 mruby에서 TypeError.
  //    RGSS 스크립트는 종종 str[/regex/], str[n, len] 형태를 사용.
  //    String을 재오픈해 safe_aref 헬퍼 제공.
  'module WrgssCompat',
  '  def self.safe_int(v)',
  '    return v if v.is_a?(Integer)',
  '    return v.to_i if v.is_a?(String) || v.is_a?(Float)',
  '    0',
  '  end',
  'end',
  '',
  // 2) Integer() 전역 메서드 — mruby에서 "0x1F" や "0b10" 같은 문자열에 실패하는 경우를 대비.
  //    이미 Kernel#Integer가 있으면 덮어씌우지 않음.
  'unless respond_to?(:__orig_Integer)',
  '  begin',
  '    alias __orig_Integer Integer',
  '    def Integer(val, base = 0)',
  '      return val if val.is_a?(Integer)',
  '      return val.to_i if val.is_a?(Float)',
  '      if val.is_a?(String)',
  '        s = val.strip',
  '        if s.start_with?("0x") || s.start_with?("0X")',
  '          s[2, s.length].to_i(16)',
  '        elsif s.start_with?("0b") || s.start_with?("0B")',
  '          s[2, s.length].to_i(2)',
  '        elsif s.start_with?("0o") || s.start_with?("0O")',
  '          s[2, s.length].to_i(8)',
  '        elsif base > 0',
  '          s.to_i(base)',
  '        else',
  '          s.to_i',
  '        end',
  '      else',
  '        val.to_i rescue 0',
  '      end',
  '    end',
  '  rescue',
  '  end',
  'end',
  '',
  // 3) Struct をモジュールのように継承する RGSS プラグインに対応.
  //    Module に initialize が定義されていないときの fallback.
  //    mruby では Module.new { } が動かないプラグインのために noop を提供.
  'begin',
  '  if !Module.method_defined?(:initialize)',
  '    module ModuleInitializeCompat',
  '      def initialize(*); end',
  '    end',
  '    Module.prepend(ModuleInitializeCompat)',
  '  end',
  'rescue',
  'end',
  '',
  // 4) Struct.new の結果が Class であることを確認.
  //    RGSS プラグインが Struct 継承クラスに initialize を定義する際の互換.
  'begin',
  '  Struct',
  '  if !Struct.respond_to?(:__wrgss_patched)',
  '    class Struct',
  '      def self.__wrgss_patched; true; end',
  '    end',
  '  end',
  'rescue NameError',
  'end',
  '',
  // 5) Win32API stub — WASM 환경에 Windows DLL 호출이 없으므로 noop 클래스 제공.
  //    "Input Ex" 같은 RGSS 플러그인이 Win32API를 참조할 때 NameError 방지.
  //    call/Call은 0 반환 (키 미입력 상태).
  'begin',
  '  Win32API',
  'rescue NameError',
  '  class Win32API',
  '    def initialize(dll, func, args, ret); end',
  '    def call(*args); 0; end',
  '    alias Call call',
  '  end',
  'end',
  '',
  // 6) Font 기본값 — RGSS3 lib/font.rb 호환. Window_Base 등에서 Font.default_size 사용.
  'begin',
  '  if Object.const_defined?(:Font) && Font.respond_to?(:default_size)',
  '    Font.default_name = "VL Gothic" if Font.default_name.nil?',
  '    Font.default_size = 24 if Font.default_size.nil?',
  '    Font.default_bold = false if Font.default_bold.nil?',
  '    Font.default_italic = false if Font.default_italic.nil?',
  '    Font.default_shadow = false if Font.default_shadow.nil?',
  '    Font.default_outline = false if Font.default_outline.nil?',
  '  end',
  'rescue',
  'end',
  '',
  // 7) rgss_main / rgss_stop — OpenRGSS 흐름 유지.
  //    main.c prelude의 __wrgss_rgss_main_orig(C 엔진 원본)을 우선 복구해
  //    rgss_main 블록이 즉시 실행되지 않고 Fiber 등록되도록 고정.
  'begin',
  '  alias rgss_main __wrgss_rgss_main_orig',
  'rescue',
  '  def rgss_main(&block); block.call if block != nil; end unless respond_to?(:rgss_main)',
  'end',
  'def rgss_stop; end unless respond_to?(:rgss_stop)',
  '',
  // 8) msgbox / exit — C가 제공 시 래핑하여 인자 없음 허용. 미제공 시 폴백.
  //    alias 실패 시(일부 mruby) noop으로 폴백. JS bridge에서 empty/ArgumentError 필터링.
  'begin',
  '  if respond_to?(:msgbox)',
  '    alias __msgbox_c msgbox',
  '    def msgbox(msg = nil); __msgbox_c(msg.to_s) if msg != nil; end',
  '  else',
  '    def msgbox(msg = nil); end',
  '  end',
  'rescue => __e',
  '  def msgbox(msg = nil); end',
  'end',
  'def exit(code=0); rgss_stop; end',
  '',
  // 9) Audio.setup_midi — SceneManager에서 use_midi? 시 호출. 웹에서 MIDI 미지원 → noop.
  'begin',
  '  if Object.const_defined?(:Audio)',
  '    module Audio; def self.setup_midi; end; end unless Audio.respond_to?(:setup_midi)',
  '  end',
  'rescue',
  'end',
  '',
  // 10) Time.at — DataManager.savefile_time_stamp에서 File.mtime 실패 시 Time.at(0). C가 js_time_at 사용.
  'begin',
  '  if Object.const_defined?(:Time) && !Time.respond_to?(:at)',
  '    def Time.at(sec); sec; end',
  '  end',
  'rescue',
  'end',
  '',
  // 11) Fiber 분할 실행 보장: Graphics.update/wait 후 Fiber.yield
  //     C 경계에서 직접 mrb_fiber_yield가 불안정한 환경을 우회.
  'begin',
  '  module Graphics',
  '    class << self',
  '      if method_defined?(:update)',
  '        alias __wrgss_update_c update',
  '        def update(*args)',
  '          r = __wrgss_update_c(*args)',
  '          begin',
  '            Fiber.yield',
  '          rescue FiberError',
  '          end',
  '          r',
  '        end',
  '      end',
  '      if method_defined?(:wait)',
  '        alias __wrgss_wait_c wait',
  '        def wait(*args)',
  '          r = __wrgss_wait_c(*args)',
  '          begin',
  '            Fiber.yield',
  '          rescue FiberError',
  '          end',
  '          r',
  '        end',
  '      end',
  '    end',
  '  end',
  'rescue',
  'end',
  '',
].join("\n");

/**
 * 스크립트 실행 후 SceneManager.run 폴백.
 * SceneManager.scene이 nil이면 Main의 rgss_main 블록이 실행되지 않은 것이므로,
 * SceneManager.run을 호출하여 Scene_Boot → Scene_Title 체인 시작.
 * defined?는 mruby에서 Object.defined?로 해석될 수 있으므로 사용하지 않음.
 */
const SCENE_MANAGER_RUN_FALLBACK = [
  'begin',
  '  if SceneManager.respond_to?(:run) && SceneManager.scene.nil?',
  '    SceneManager.run',
  '  end',
  'rescue NameError',
  'end',
].join('; ');

/** Window skin 비동기 로드 시점에 text_color가 0 alpha를 반환하는 경우를 방어. */
const WINDOW_BASE_TEXT_COLOR_PATCH = [
  'begin',
  '  if Object.const_defined?(:Window_Base)',
  '    class Window_Base',
  '      unless method_defined?(:__wrgss_text_color_orig)',
  '        alias __wrgss_text_color_orig text_color',
  '      end',
  '      def text_color(n)',
  '        ws = windowskin rescue nil',
  '        if ws == nil || (ws.respond_to?(:width) && ws.width.to_i <= 1) || (ws.respond_to?(:height) && ws.height.to_i <= 1)',
  '          return Color.new(255, 255, 255, 255)',
  '        end',
  '        c = __wrgss_text_color_orig(n)',
  '        if c == nil || (c.respond_to?(:alpha) && c.alpha.to_i <= 0)',
  '          return Color.new(255, 255, 255, 255)',
  '        end',
  '        c',
  '      rescue',
  '        Color.new(255, 255, 255, 255)',
  '      end',
  '    end',
  '  end',
  'rescue',
  'end',
].join('; ');

/** Fiber 없이 첫 씬만 초기화 (폴백용). run()은 Fiber.yield 포함이라 JS에서 직접 호출 시 FiberError. */
const SCENE_MANAGER_INIT_FIRST_SCENE = [
  'begin',
  '  if SceneManager.respond_to?(:scene) && SceneManager.scene.nil? && SceneManager.respond_to?(:first_scene_class)',
  '    DataManager.init if Object.const_defined?(:DataManager) && DataManager.respond_to?(:init)',
  '    if Object.const_defined?(:Audio) && Audio.respond_to?(:setup_midi) && SceneManager.respond_to?(:use_midi?) && SceneManager.use_midi?',
  '      Audio.setup_midi',
  '    end',
  '    SceneManager.instance_variable_set(:@scene, SceneManager.first_scene_class.new)',
  '    __wrgss_s1 = SceneManager.scene',
  '    __wrgss_s1.start if __wrgss_s1.respond_to?(:start)',
  '    if SceneManager.scene != __wrgss_s1 && !SceneManager.scene.nil?',
  '      SceneManager.scene.start if SceneManager.scene.respond_to?(:start)',
  '    end',
  '    __wrgss_s = SceneManager.scene',
  '    if !__wrgss_s.nil?',
  '      __wrgss_s.post_start if __wrgss_s.respond_to?(:post_start)',
  '      __wrgss_s.update if __wrgss_s.respond_to?(:update)',
  '    end',
  '  end',
  'rescue => __e',
  '  p "[WasmRgssRuntime] SCENE_MANAGER_INIT_FIRST_SCENE: " + __e.message.to_s',
  'end',
].join('; ');

/**
 * 매 프레임 실행 — RGSS3(SceneManager) 기준.
 * OpenRGSS/RGSS 표준 계약에 맞춰 Scene#update만 호출한다.
 * Graphics/Input/window 갱신은 각 Scene의 update_basic 내부에서 처리되어야 한다.
 *
 * 씬 전환 시: 이전 씬은 pre_terminate → terminate 순으로 정리하고,
 * 새 씬은 start → post_start → update 순으로 첫 프레임을 진행한다.
 * (post_start 내부에서 perform_transition을 호출하므로 중복 호출하지 않는다.)
 */
const FRAME_TICK_SCRIPT = [
  'cur = SceneManager.scene',
  'if cur == nil',
  '  if SceneManager.respond_to?(:first_scene_class)',
  '    SceneManager.instance_variable_set(:@scene, SceneManager.first_scene_class.new) if SceneManager.scene.nil?',
  '    __wrgss_s1 = SceneManager.scene',
  '    __wrgss_s1.start if __wrgss_s1.respond_to?(:start)',
  '    if SceneManager.scene != __wrgss_s1 && !SceneManager.scene.nil?',
  '      SceneManager.scene.start if SceneManager.scene.respond_to?(:start)',
  '    end',
  '    cur = SceneManager.scene',
  '    if cur != nil',
  '      cur.post_start if cur.respond_to?(:post_start)',
  '      cur.update if cur.respond_to?(:update)',
  '    end',
  '  end',
  'elsif cur != nil',
  '  cur.update if cur.respond_to?(:update)',
  '  nxt = SceneManager.scene',
  '  if nxt != cur',
  '    cur.pre_terminate if cur.respond_to?(:pre_terminate)',
  '    cur.terminate if cur.respond_to?(:terminate)',
  '    if nxt != nil',
  '      nxt.start if nxt.respond_to?(:start)',
  '      nxt.post_start if nxt.respond_to?(:post_start)',
  '      nxt.update if nxt.respond_to?(:update)',
  '    end',
  '  end',
  'end',
].join('; ');
