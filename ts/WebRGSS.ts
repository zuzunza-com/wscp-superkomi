/**
 * WebRGSS - RPG Maker RGSS 웹 런타임
 *
 * - zip 내 .rvdata2 파싱 (Scripts, Map, System 등)
 * - RGSS API (Graphics, Input, Bitmap, Sprite 등) JavaScript 구현
 * - Canvas 렌더링
 * - 리소스 로딩 (zip blob 기반)
 */
import { parseScriptsRvdata2, parseScriptsFromZip } from './rvdata2/parseScripts';
import { parseRvdata2, parseRvdata2FromZip } from './rvdata2/parseRvdata2';
import { loadGameFromLoader, loadGameFromZip } from './loadGameFromZip';
import { Graphics } from './api/Graphics';
import { Font } from './api/Font';
import { Input, InputState, resolveInputKey } from './api/Input';
import { setAudioResourceLoader } from './api/Audio';
import { Bitmap } from './api/Bitmap';
import { Color } from './api/Color';
import { Sprite } from './api/Sprite';
import { CanvasRenderer } from './renderer/CanvasRenderer';
import { WebGPURenderer } from './renderer/WebGPURenderer';
import type { IRenderer } from './renderer/IRenderer';
import { TitleScene } from './game/TitleScene';
import { TranspiledScriptRuntime } from './runtime/ScriptRuntime';
import { WasmRgssRuntime } from './wasm/WasmRgssRuntime';
import type { WasmRgssState, WasmRuntimeDiagnostics } from './wasm/WasmRgssRuntime';
import type { RtpBackedResourceLoader } from './resources/RtpBackedResourceLoader';
import type { IResourceLoader } from './resources/types';
import type { RgssTranspileDiagnostic } from './types/diagnostics';

export type { RgssScript } from './rvdata2/parseScripts';

export { parseScriptsRvdata2, parseScriptsFromZip };
export { parseRvdata2, parseRvdata2FromZip };

export { Graphics, Input, InputState, resolveInputKey };
export { CanvasRenderer, WebGPURenderer };

export { Table } from './api/Table';
export { Rect } from './api/Rect';
export { Color } from './api/Color';
export { Tone } from './api/Tone';
export { Font } from './api/Font';
export { Bitmap } from './api/Bitmap';
export { Window } from './api/Window';
export { Viewport } from './api/Viewport';
export { Sprite } from './api/Sprite';
export { Audio, setAudioResourceLoader, audioPumpPending } from './api/Audio';

export interface WebRGSSConfig {
  canvas: HTMLCanvasElement;
  width?: number;
  height?: number;
  frameRate?: number;
  /** 고속 재생 배율 (1=일반, 2=2배속, 4=4배속). WASM mruby 틱 배치 실행으로 V8/JS 한계 극복 */
  playbackSpeed?: number;
  /** 부트 모드 (기본값: "wasm_mruby"):
   *  - "wasm_mruby": 자체 WASM + mruby (webrgss.mjs) [기본]
   *  - "transpiled_rgss3": JS 트랜스파일 런타임 (Opal)
   *  - "legacy_title_demo": 정적 타이틀 화면
   */
  bootMode?: "legacy_title_demo" | "transpiled_rgss3" | "wasm_mruby";
  /** WebGPU 하드웨어 가속 사용 시도 (기본 true). 미지원 시 Canvas 2D fallback */
  useWebGPU?: boolean;
  onRuntimeDiagnostic?: (d: RgssTranspileDiagnostic) => void;
  onRuntimeStateChange?: (state: string) => void;
  onMsgbox?: (msg: string) => void;
  /** WASM 런타임 오류 시 진단 정보 (lastMsgbox, lastPrintErr, loopTickCounter 등) */
  onWasmDiagnostics?: (d: WasmRuntimeDiagnostics) => void;
}

export class WebRGSS {
  private renderer: IRenderer;
  private rafId: number | null = null;
  private lastTime = 0;
  private frameRate: number;
  private _loader: IResourceLoader | RtpBackedResourceLoader | null = null;
  private readonly canvasEl: HTMLCanvasElement;
  private readonly onKeyDown: (e: KeyboardEvent) => void;
  private readonly onKeyUp: (e: KeyboardEvent) => void;
  private readonly onPointerDown: () => void;
  private readonly onWindowBlur: () => void;
  private inputListenersAttached = false;
  private scriptRuntime: TranspiledScriptRuntime | null = null;
  private wasmRuntime: WasmRgssRuntime | null = null;
  private readonly bootMode: "legacy_title_demo" | "transpiled_rgss3" | "wasm_mruby";
  private readonly playbackSpeed: number;
  private readonly onRuntimeDiagnostic?: (d: RgssTranspileDiagnostic) => void;
  private readonly onRuntimeStateChange?: (state: string) => void;
  private readonly onMsgbox?: (msg: string) => void;
  private readonly onWasmDiagnostics?: (d: WasmRuntimeDiagnostics) => void;
  private skeletonMapState: {
    sprite: Sprite;
    bitmap: Bitmap;
    mapWidth: number;
    mapHeight: number;
    tileSize: number;
    tiles: number[];
    playerX: number;
    playerY: number;
    cameraX: number;
    cameraY: number;
    dirty: boolean;
    lastInteractionMessage: string | null;
  } | null = null;

  /**
   * WebGPU 지원 시 WebGPU 렌더러로 초기화.
   * useWebGPU=true(기본)일 때 WebGPU 초기화 실패/미지원이면 Canvas 2D로 fallback.
   * useWebGPU=false면 Canvas 2D 사용.
   */
  static async create(config: WebRGSSConfig): Promise<WebRGSS> {
    const useWebGPU = config.useWebGPU !== false;
    const { canvas, width = 544, height = 416 } = config;
    console.info(`[WebRGSS] create start (useWebGPU=${useWebGPU}, size=${width}x${height})`);

    let renderer: IRenderer;
    if (useWebGPU) {
      const wgpu = await WebGPURenderer.create(canvas);
      if (!wgpu) {
        console.warn('[WebRGSS] WebGPU init 실패, CanvasRenderer fallback');
        config.onRuntimeDiagnostic?.({
          severity: 'warning',
          code: 'WEBGPU_FALLBACK_CANVAS',
          message:
            'WebGPU 초기화에 실패하여 Canvas 렌더러로 폴백합니다. (브라우저/드라이버 이슈 가능)',
          scriptIndex: -1,
          scriptTitle: '(renderer)',
        });
        renderer = new CanvasRenderer(canvas);
      } else {
        console.info('[WebRGSS] WebGPU renderer 활성화');
        renderer = wgpu;
      }
    } else {
      console.info('[WebRGSS] CanvasRenderer 강제 사용');
      renderer = new CanvasRenderer(canvas);
    }
    renderer.setSize(width, height);

    return new WebRGSS(config, renderer);
  }

  constructor(config: WebRGSSConfig, existingRenderer?: IRenderer) {
    const { canvas, width = 544, height = 416, frameRate = 60, bootMode = "wasm_mruby", playbackSpeed = 1 } = config;
    this.frameRate = frameRate;
    this.bootMode = bootMode;
    this.playbackSpeed = Math.max(1, Math.min(8, playbackSpeed));
    this.onRuntimeDiagnostic = config.onRuntimeDiagnostic;
    this.onRuntimeStateChange = config.onRuntimeStateChange;
    this.onMsgbox = config.onMsgbox;
    this.onWasmDiagnostics = config.onWasmDiagnostics;
    this.canvasEl = canvas;
    Font.ensureDefaultFontLoaded();
    this.renderer = existingRenderer ?? new CanvasRenderer(canvas);
    if (!existingRenderer) {
      this.renderer.setSize(width, height);
    }

    this.onKeyDown = (e: KeyboardEvent) => {
      const t = e.target as Node;
      if (t && (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement)) return;
      const sym = resolveInputKey(e);
      if (sym) {
        InputState.keyDown(sym);
        if (sym === Input.F12) {
          e.preventDefault();
          e.stopPropagation();
          window.setTimeout(() => window.location.reload(), 0);
          return;
        }
        e.preventDefault();
      }
    };
    this.onKeyUp = (e: KeyboardEvent) => {
      const t = e.target as Node;
      if (t && (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement)) return;
      const sym = resolveInputKey(e);
      if (sym) {
        InputState.keyUp(sym);
        e.preventDefault();
      }
    };
    this.onPointerDown = () => {
      this.canvasEl.focus({ preventScroll: true });
    };
    this.onWindowBlur = () => {
      InputState.clear();
    };

    canvas.tabIndex = 0;
    canvas.setAttribute('tabindex', '0');
    this.attachInputListeners();
    this.canvasEl.focus({ preventScroll: true });
  }

  get canvas(): HTMLCanvasElement {
    return this.renderer.canvas;
  }

  getRenderer(): IRenderer {
    return this.renderer;
  }

  /** zip에서 게임 로드 (리소스, 스크립트).
   * skipLegacyTitle: true 시 JS 레거시 TitleScene을 건너뛰고, Scripts.rvdata2 내 스크립트가 씬을 구성하도록 함.
   */
  async loadFromZip(
    zipBlob: Blob,
    rtpLoader?: IResourceLoader | null,
    options?: { skipLegacyTitle?: boolean }
  ): Promise<{
    scripts: import('./rvdata2/parseScripts').RgssScript[];
    resourceCount: number;
  }> {
    if (this._loader && 'dispose' in this._loader) {
      this._loader.dispose();
    }
    const { loader, scripts, system } = await loadGameFromZip(zipBlob, rtpLoader ?? undefined);
    this._loader = loader;

    setAudioResourceLoader((p) => loader.getAudioUrl(p));

    if (!options?.skipLegacyTitle) {
      const title = new TitleScene(loader);
      title.setSystem(system);
      await title.load();
      this.renderer.clearSprites();
      for (const s of title.getSprites()) {
        this.renderer.addSprite(s);
      }
      this.renderer.render();
    }

    return {
      scripts,
      resourceCount: loader.listFiles().length,
    };
  }

  /** 스트림 패키지/원격 파일맵 등 임의의 ResourceLoader에서 게임 로드.
   * skipLegacyTitle: true 시 JS 레거시 TitleScene을 건너뛰고, Scripts.rvdata2 내 스크립트가 씬을 구성하도록 함.
   */
  async loadFromLoader(
    gameLoader: IResourceLoader,
    rtpLoader?: IResourceLoader | null,
    options?: { skipLegacyTitle?: boolean }
  ): Promise<{
    scripts: import('./rvdata2/parseScripts').RgssScript[];
    resourceCount: number;
  }> {
    if (this._loader && 'dispose' in this._loader) {
      this._loader.dispose();
    }
    const { loader, scripts, system } = await loadGameFromLoader(gameLoader, rtpLoader ?? undefined);
    this._loader = loader;

    setAudioResourceLoader((p) => loader.getAudioUrl(p));

    if (!options?.skipLegacyTitle) {
      const title = new TitleScene(loader);
      title.setSystem(system);
      await title.load();
      this.renderer.clearSprites();
      for (const s of title.getSprites()) {
        this.renderer.addSprite(s);
      }
      this.renderer.render();
    }

    return {
      scripts,
      resourceCount: loader.listFiles().length,
    };
  }

  getResourceLoader(): IResourceLoader | RtpBackedResourceLoader | null {
    return this._loader;
  }

  async loadRuntimeBundle(bundleUrl: string): Promise<void> {
    this.onRuntimeStateChange?.("runtime_bundle_loading");
    const rt = new TranspiledScriptRuntime();
    await rt.load(bundleUrl);
    this.scriptRuntime = rt;
    this.onRuntimeStateChange?.("runtime_bundle_loaded");
  }

  /**
   * WASM mruby 런타임으로 게임을 부트한다.
   * wasmBundleUrl: /api/rgss/wasm-bundle?file=<key> 등에서 받은 JSON
   * wasmModuleUrl: /player/wasm/webrgss.mjs
   */
  async bootWasmGame(options: {
    loader: IResourceLoader;
    wasmBundleUrl: string;
    wasmModuleUrl?: string;
  }): Promise<void> {
    console.info(`[WebRGSS] bootWasmGame start (bundle=${options.wasmBundleUrl})`);
    this.onRuntimeStateChange?.("wasm_bundle_fetching");

    /* 1단계: ?url=... → WasmGameBundleResponse (scripts 없음, bundleUrl 있음)
     * 2단계: ?file=<key> → WasmGameBundle (scripts 포함)
     * 이미 ?file=... URL이면 바로 번들 fetch */
    const firstRes = await fetch(options.wasmBundleUrl);
    const firstJson = await firstRes.json().catch(() => ({})) as {
      scripts?: { index: number; title: string; code: string }[];
      bundleUrl?: string;
      wasmModuleUrl?: string;
      ok?: boolean;
      error?: string;
    };

    if (!firstRes.ok) {
      const detail = firstJson.error || (firstRes.status === 403
        ? 'URL 검증 실패 (호스트 미허용·비HTTPS·사설IP). RGSS_EXE_ALLOWED_HOSTS 확인.'
        : '');
      throw new Error(`WASM 번들 다운로드 실패: ${firstRes.status}${detail ? ` - ${detail}` : ''}`);
    }
    if (firstJson.ok === false && firstJson.error) {
      throw new Error(`WASM 번들 생성 실패: ${firstJson.error}`);
    }

    let bundle: { scripts: Array<{ index: number; title: string; code: string; bytecodeBase64?: string }>; wasmModuleUrl?: string };

    if (Array.isArray(firstJson.scripts)) {
      /* 이미 scripts 포함된 응답 */
      bundle = firstJson as typeof bundle;
    } else if (firstJson.bundleUrl) {
      /* WasmGameBundleResponse → 실제 번들 fetch */
      this.onRuntimeStateChange?.("wasm_bundle_downloading");
      const bundleRes = await fetch(firstJson.bundleUrl);
      if (!bundleRes.ok) throw new Error(`WASM 번들 파일 다운로드 실패: ${bundleRes.status}`);
      bundle = await bundleRes.json() as typeof bundle;
    } else {
      throw new Error('WASM 번들 응답에 scripts 또는 bundleUrl이 없습니다');
    }

    const wasmModuleUrl = options.wasmModuleUrl ?? bundle.wasmModuleUrl ?? '/player/wasm/webrgss.mjs';

    this.onRuntimeStateChange?.("wasm_runtime_loading");

    // 레거시 TitleScene 스프라이트 제거 — WASM 게임이 깨끗한 캔버스에서 렌더링
    this.renderer.clearSprites();

    /* bytecodeBase64 → Uint8Array 변환 (JIT 번들) */
    const scripts = bundle.scripts.map((s) => {
      const out: { index: number; title: string; code: string; bytecode?: Uint8Array } = {
        index: s.index,
        title: s.title,
        code: s.code ?? '',
      };
      if (s.bytecodeBase64) {
        try {
          const bin = atob(s.bytecodeBase64);
          out.bytecode = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) out.bytecode[i] = bin.charCodeAt(i);
        } catch {
          /* base64 디코드 실패 시 bytecode 생략 */
        }
      }
      return out;
    });

    this.wasmRuntime = new WasmRgssRuntime({
      wasmModuleUrl,
      renderer: this.renderer,
      loader: options.loader,
      scripts,
      playbackSpeed: this.playbackSpeed,
      onError: (msg, diagnostics) => {
        this.onRuntimeDiagnostic?.({
          severity: 'error',
          code: 'WASM_RUNTIME_ERROR',
          message: msg,
          scriptIndex: -1,
          scriptTitle: '(wasm)',
        });
        if (diagnostics) this.onWasmDiagnostics?.(diagnostics);
      },
      onStateChange: (state: WasmRgssState) => {
        this.onRuntimeStateChange?.(`wasm_${state}`);
      },
      onMsgbox: this.onMsgbox,
    });

    await this.wasmRuntime.boot();
    console.info('[WebRGSS] bootWasmGame complete');
  }

  /**
   * 스크립트를 직접 주입하여 WASM 게임 부트.
   * .rgss3a / .zip 등 로컬 아카이브에서 파싱한 scripts를 서버 API 없이 바로 실행.
   */
  async bootWasmGameWithScripts(options: {
    loader: IResourceLoader;
    scripts: { index: number; title: string; code: string }[];
    wasmModuleUrl?: string;
  }): Promise<void> {
    console.info(`[WebRGSS] bootWasmGameWithScripts start (scripts=${options.scripts.length})`);
    const wasmModuleUrl = options.wasmModuleUrl ?? '/player/wasm/webrgss.mjs';
    this.onRuntimeStateChange?.('wasm_runtime_loading');

    this.wasmRuntime = new WasmRgssRuntime({
      wasmModuleUrl,
      renderer: this.renderer,
      loader: options.loader,
      scripts: options.scripts,
      playbackSpeed: this.playbackSpeed,
      onError: (msg, diagnostics) => {
        this.onRuntimeDiagnostic?.({
          severity: 'error',
          code: 'WASM_RUNTIME_ERROR',
          message: msg,
          scriptIndex: -1,
          scriptTitle: '(wasm)',
        });
        if (diagnostics) this.onWasmDiagnostics?.(diagnostics);
      },
      onStateChange: (state: WasmRgssState) => {
        this.onRuntimeStateChange?.(`wasm_${state}`);
      },
      onMsgbox: this.onMsgbox,
    });

    await this.wasmRuntime.boot();
    console.info('[WebRGSS] bootWasmGameWithScripts complete');
  }

  async bootRgssGame(options: { loader: IResourceLoader; runtimeBundleUrl?: string }): Promise<void> {
    if (options.runtimeBundleUrl) {
      await this.loadRuntimeBundle(options.runtimeBundleUrl);
    }
    if (!this.scriptRuntime) {
      throw new Error("RGSS runtime bundle is not loaded");
    }
    this.onRuntimeStateChange?.("runtime_booting");
    const result = await this.scriptRuntime.boot(options.loader);
    const hostBridge = this.scriptRuntime.getHostBridge();
    hostBridge?.sceneManager?.update();
    if (result.mode === "skeleton" || result.mode.includes("skeleton")) {
      this.onRuntimeDiagnostic?.({
        severity: "warning",
        code: "RGSS_RUNTIME_SKELETON",
        message: "스크립트 런타임 번들은 생성되었지만 실제 RGSS 실행 엔진은 아직 스켈레톤 단계입니다. legacy 타이틀 렌더러로 폴백합니다.",
        scriptIndex: -1,
        scriptTitle: "(runtime)",
      });
      if (hostBridge?.sceneManager?.currentSceneName) {
        this.onRuntimeDiagnostic?.({
          severity: "warning",
          code: "RGSS_SCENE_MANAGER_SKELETON",
          message: `스크립트 런타임 스켈레톤이 SceneManager를 ${hostBridge?.sceneManager?.currentSceneName} 로 설정했습니다 (실제 씬 실행은 미구현).`,
          scriptIndex: -1,
          scriptTitle: "(runtime)",
        });
      }
      await this.tryRenderSkeletonMapPreview();
      this.onRuntimeStateChange?.("runtime_skeleton_fallback");
      return;
    }
    this.onRuntimeStateChange?.("runtime_booted");
  }

  private async tryRenderSkeletonMapPreview(): Promise<void> {
    try {
      const host = this.scriptRuntime?.getHostBridge();
      if (!host) return;
      const mapInfos = await host.dataManager.loadMapInfos();
      const firstMapId = this.pickFirstMapId(mapInfos);
      if (!firstMapId) return;
      const map = await host.dataManager.loadMap(firstMapId);
      if (!map || typeof map !== "object") return;

      const dims = this.extractMapDimensions(map as Record<string, unknown>);
      if (!dims) return;
      const sample = this.extractMapTileSample(map as Record<string, unknown>, dims);

      const preview = this.buildMapPreviewSprite(dims.width, dims.height, sample);
      this.renderer.clearSprites();
      this.renderer.addSprite(preview);
      this.renderer.render();

      this.onRuntimeDiagnostic?.({
        severity: "warning",
        code: "RGSS_MAP_PREVIEW_SKELETON",
        message: `스켈레톤 모드 맵 플레이 프리뷰 준비 완료 (Map${String(firstMapId).padStart(3, "0")}, ${dims.width}x${dims.height}). 방향키 이동/Enter/Esc 입력 반응 가능.`,
        scriptIndex: -1,
        scriptTitle: "(runtime)",
      });
    } catch (error) {
      this.onRuntimeDiagnostic?.({
        severity: "warning",
        code: "RGSS_MAP_PREVIEW_FAILED",
        message: `스켈레톤 맵 프리뷰 생성 실패: ${error instanceof Error ? error.message : String(error)}`,
        scriptIndex: -1,
        scriptTitle: "(runtime)",
      });
    }
  }

  private pickFirstMapId(mapInfos: unknown): number | null {
    if (!Array.isArray(mapInfos)) {
      if (mapInfos && typeof mapInfos === "object") {
        const obj = mapInfos as Record<string, unknown>;
        const keys = Object.keys(obj)
          .map((k) => Number.parseInt(k, 10))
          .filter((n) => Number.isFinite(n) && n > 0)
          .sort((a, b) => a - b);
        return keys[0] ?? null;
      }
      return null;
    }
    for (let i = 1; i < mapInfos.length; i += 1) {
      if (mapInfos[i]) return i;
    }
    return null;
  }

  private extractMapDimensions(map: Record<string, unknown>): { width: number; height: number } | null {
    const width = this.readNumericField(map, "width");
    const height = this.readNumericField(map, "height");
    if (!width || !height) return null;
    if (width <= 0 || height <= 0 || width > 500 || height > 500) return null;
    return { width, height };
  }

  private readNumericField(obj: Record<string, unknown>, key: string): number | null {
    const direct = obj[key];
    const ivar = obj[`@${key}`];
    const v = typeof direct === "number" ? direct : typeof ivar === "number" ? ivar : null;
    return v != null && Number.isFinite(v) ? Math.floor(v) : null;
  }

  private extractMapTileSample(
    map: Record<string, unknown>,
    dims: { width: number; height: number }
  ): number[] {
    const raw = (map.data ?? map["@data"]) as Record<string, unknown> | undefined;
    if (!raw || typeof raw !== "object") return [];
    const values = (raw.values ?? raw["@values"]) as unknown;
    if (!Array.isArray(values)) return [];
    const need = dims.width * dims.height;
    const out: number[] = new Array(need).fill(0);
    for (let i = 0; i < need && i < values.length; i += 1) {
      const n = values[i];
      out[i] = typeof n === "number" && Number.isFinite(n) ? n : 0;
    }
    return out;
  }

  private buildMapPreviewSprite(mapWidth: number, mapHeight: number, tileSample: number[]): Sprite {
    const bmp = new Bitmap(Graphics.width, Graphics.height);
    const spr = new Sprite();
    spr.bitmap = bmp;
    spr.z = 0;
    const tileSize = 32;
    const playerX = Math.floor(mapWidth / 2);
    const playerY = Math.floor(mapHeight / 2);
    this.skeletonMapState = {
      sprite: spr,
      bitmap: bmp,
      mapWidth,
      mapHeight,
      tileSize,
      tiles: tileSample,
      playerX: Math.max(0, Math.min(mapWidth - 1, playerX)),
      playerY: Math.max(0, Math.min(mapHeight - 1, playerY)),
      cameraX: 0,
      cameraY: 0,
      dirty: true,
      lastInteractionMessage: null,
    };
    this.renderSkeletonMapState();
    return spr;
  }

  private colorFromTileId(id: number): Color {
    if (!id) return new Color(16, 20, 28, 255);
    const v = Math.abs(id) % 360;
    const hue = v / 60;
    const c = 0.65;
    const x = c * (1 - Math.abs((hue % 2) - 1));
    let r = 0, g = 0, b = 0;
    if (hue < 1) [r, g, b] = [c, x, 0];
    else if (hue < 2) [r, g, b] = [x, c, 0];
    else if (hue < 3) [r, g, b] = [0, c, x];
    else if (hue < 4) [r, g, b] = [0, x, c];
    else if (hue < 5) [r, g, b] = [x, 0, c];
    else [r, g, b] = [c, 0, x];
    const m = 0.15;
    return new Color(
      Math.round((r + m) * 255),
      Math.round((g + m) * 255),
      Math.round((b + m) * 255),
      255
    );
  }

  /** 고속 재생 배율 설정 (1, 2, 4, 8). WASM 런타임에서 틱 배치 실행 */
  setPlaybackSpeed(speed: number): void {
    this.wasmRuntime?.setPlaybackSpeed(speed);
  }

  start(): void {
    if (this.rafId !== null) return;
    this.attachInputListeners();
    this.canvasEl.focus({ preventScroll: true });
    this.lastTime = performance.now();

    const tick = (now: number) => {
      this.rafId = requestAnimationFrame(tick);
      const elapsed = now - this.lastTime;
      const frameInterval = 1000 / this.frameRate;
      if (elapsed >= frameInterval) {
        this.lastTime = now - (elapsed % frameInterval);
        InputState.update();
        this.updateSkeletonMapState();
        this.renderer.update();
        this.renderer.render();
      }
    };

    this.rafId = requestAnimationFrame(tick);
  }

  stop(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (this.wasmRuntime) {
      this.wasmRuntime.stop();
      this.wasmRuntime = null;
    }
    setAudioResourceLoader(null);
    this._loader?.dispose();
    this._loader = null;
    this.scriptRuntime = null;
    this.skeletonMapState = null;
    this.detachInputListeners();
    InputState.clear();
  }

  private updateSkeletonMapState(): void {
    const st = this.skeletonMapState;
    if (!st) return;

    let dx = 0;
    let dy = 0;
    if (InputState.repeat(Input.LEFT)) dx = -1;
    else if (InputState.repeat(Input.RIGHT)) dx = 1;
    else if (InputState.repeat(Input.UP)) dy = -1;
    else if (InputState.repeat(Input.DOWN)) dy = 1;

    if (dx !== 0 || dy !== 0) {
      const nx = Math.max(0, Math.min(st.mapWidth - 1, st.playerX + dx));
      const ny = Math.max(0, Math.min(st.mapHeight - 1, st.playerY + dy));
      if (nx !== st.playerX || ny !== st.playerY) {
        st.playerX = nx;
        st.playerY = ny;
        st.dirty = true;
      }
    }

    if (InputState.trigger(Input.C)) {
      const idx = st.playerX + st.playerY * st.mapWidth;
      const tileId = st.tiles[idx] ?? 0;
      st.lastInteractionMessage = `Enter(C): tile=${tileId} pos=(${st.playerX},${st.playerY})`;
      st.dirty = true;
    }
    if (InputState.trigger(Input.B)) {
      st.lastInteractionMessage = `Esc(B): cancel/menu placeholder`;
      st.dirty = true;
    }

    const visibleTilesX = Math.max(1, Math.floor(Graphics.width / st.tileSize));
    const visibleTilesY = Math.max(1, Math.floor(Graphics.height / st.tileSize));
    const maxCamX = Math.max(0, st.mapWidth - visibleTilesX);
    const maxCamY = Math.max(0, st.mapHeight - visibleTilesY);
    const targetCamX = Math.max(0, Math.min(maxCamX, st.playerX - Math.floor(visibleTilesX / 2)));
    const targetCamY = Math.max(0, Math.min(maxCamY, st.playerY - Math.floor(visibleTilesY / 2)));
    if (targetCamX !== st.cameraX || targetCamY !== st.cameraY) {
      st.cameraX = targetCamX;
      st.cameraY = targetCamY;
      st.dirty = true;
    }

    if (st.dirty) this.renderSkeletonMapState();
  }

  private renderSkeletonMapState(): void {
    const st = this.skeletonMapState;
    if (!st) return;
    st.dirty = false;

    const bmp = st.bitmap;
    bmp.fillRect(0, 0, Graphics.width, Graphics.height, new Color(0, 0, 0, 255));

    const tileSize = st.tileSize;
    const visibleTilesX = Math.ceil(Graphics.width / tileSize);
    const visibleTilesY = Math.ceil(Graphics.height / tileSize);

    for (let sy = 0; sy < visibleTilesY; sy += 1) {
      for (let sx = 0; sx < visibleTilesX; sx += 1) {
        const mx = st.cameraX + sx;
        const my = st.cameraY + sy;
        const px = sx * tileSize;
        const py = sy * tileSize;
        if (mx < 0 || my < 0 || mx >= st.mapWidth || my >= st.mapHeight) {
          bmp.fillRect(px, py, tileSize, tileSize, new Color(6, 8, 12, 255));
          continue;
        }
        const idx = mx + my * st.mapWidth;
        const id = st.tiles[idx] ?? 0;
        bmp.fillRect(px, py, tileSize, tileSize, this.colorFromTileId(id));
        bmp.context.strokeStyle = "rgba(0,0,0,0.15)";
        bmp.context.strokeRect(px + 0.5, py + 0.5, tileSize - 1, tileSize - 1);
      }
    }

    const playerScreenX = (st.playerX - st.cameraX) * tileSize;
    const playerScreenY = (st.playerY - st.cameraY) * tileSize;
    bmp.fillRect(playerScreenX + 6, playerScreenY + 4, tileSize - 12, tileSize - 8, new Color(255, 255, 255, 230));
    bmp.fillRect(playerScreenX + 10, playerScreenY + 8, tileSize - 20, tileSize - 16, new Color(60, 90, 200, 255));

    bmp.font.size = 14;
    bmp.font.bold = true;
    bmp.drawText(8, 8, Graphics.width - 16, 20, "RGSS Skeleton Map (Playable Preview)", 0);
    bmp.font.size = 11;
    bmp.font.bold = false;
    bmp.drawText(
      8,
      28,
      Graphics.width - 16,
      16,
      `Map ${st.mapWidth}x${st.mapHeight}  Player=(${st.playerX},${st.playerY})  Camera=(${st.cameraX},${st.cameraY})`,
      0
    );
    bmp.drawText(8, 44, Graphics.width - 16, 16, "Arrows: move | Enter: interact placeholder | Esc: cancel placeholder | F12: reload", 0);
    if (st.lastInteractionMessage) {
      bmp.drawText(8, 60, Graphics.width - 16, 16, st.lastInteractionMessage, 0);
    }
  }

  private attachInputListeners(): void {
    if (this.inputListenersAttached) return;
    // capture: true로 Enter/Space 등이 버튼·광고 등에 가로채이기 전에 수신
    window.addEventListener('keydown', this.onKeyDown, { capture: true });
    window.addEventListener('keyup', this.onKeyUp, { capture: true });
    window.addEventListener('blur', this.onWindowBlur);
    this.canvasEl.addEventListener('pointerdown', this.onPointerDown);
    this.inputListenersAttached = true;
  }

  private detachInputListeners(): void {
    if (!this.inputListenersAttached) return;
    window.removeEventListener('keydown', this.onKeyDown, { capture: true });
    window.removeEventListener('keyup', this.onKeyUp, { capture: true });
    window.removeEventListener('blur', this.onWindowBlur);
    this.canvasEl.removeEventListener('pointerdown', this.onPointerDown);
    this.inputListenersAttached = false;
  }
}
