/**
 * RgssEmulator - RGSS3 게임 웹 에뮬레이터
 *
 * Game.exe + RGSS301.dll 흐름을 Web에서 에뮬레이션:
 *   LoadLibrary(RGSS301.dll) → RGSSInitialize3 → RGSSSetupRTP → RGSSSetupFonts
 *   → RGSSEval(Scripts.rvdata2) → RGSSGameMain → RGSSFinalize
 *
 * @see lib/webrgss/docs/RGSS301_DLL_ANALYSIS.md
 */
import { WebRGSS } from "./WebRGSS";
import type { WasmRuntimeDiagnostics } from "./wasm/WasmRgssRuntime";
import { loadRtp } from "./resources/RtpLoader";
import { StreamPackLoader } from "./resources/StreamPackLoader";
import { loadGameFromLoader } from "./loadGameFromZip";
import { ResourceLoader } from "./resources/ResourceLoader";
import JSZip from "jszip";
import type { IResourceLoader } from "./resources/types";
import type { RgssScript } from "./rvdata2/parseScripts";

/**
 * Result of preparing an RPG Maker VX Ace `Game.exe` bundle for streaming.
 *
 * In the host application this is produced by a Next.js server action (e.g.
 * `prepareExePackage` in `wscp-frontend/lib/actions/rgss-file.ts`), which
 * materializes the SFX-archive embedded inside the EXE into a cached pack
 * and returns a lightweight stream URL. wscp-superkomi is framework- and
 * server-agnostic, so callers must inject the preparer function through
 * `RgssEmulatorConfig.prepareExePackage`.
 */
export type PrepareExePackageResult =
  | { ok: true; packUrl: string; cacheKey: string }
  | { ok: false; error: string };

export type PrepareExePackageFn = (gameUrl: string) => Promise<PrepareExePackageResult>;

export type RgssEmulatorState =
  | "idle"
  | "rtp_loading"
  | "game_loading"
  | "wasm_loading"
  | "running"
  | "stopped"
  | "error";

export interface RgssEmulatorConfig {
  canvas: HTMLCanvasElement;
  width?: number;
  height?: number;
  frameRate?: number;
  /** 고속 재생 배율 (1=일반, 2=2배속, 4=4배속). WASM mruby 틱 배치 실행 */
  playbackSpeed?: number;
  wasmBundleUrl?: string;
  wasmModuleUrl?: string;
  onStateChange?: (state: RgssEmulatorState) => void;
  onProgress?: (phase: string, detail?: string) => void;
  onError?: (message: string) => void;
  /**
   * 심각도 error 미만(warning/info)의 런타임 진단 훅.
   * WebGPU fallback, 스켈레톤 경고 등은 여기로 전달되며 `onError` 를 트리거하지 않는다.
   * (생략 시 콘솔로만 출력)
   */
  onRuntimeWarning?: (d: { severity: 'warning' | 'info'; code: string; message: string }) => void;
  onMsgbox?: (msg: string) => void;
  /** WASM 런타임 오류 시 진단 정보 (lastMsgbox, lastPrintErr, loopTickCounter 등) */
  onWasmDiagnostics?: (d: WasmRuntimeDiagnostics) => void;
  /**
   * Injected EXE→pack preparer. Required when `run(gameUrl)` is called with
   * a `.exe` URL; omit for pure `.zip`/`.rgss3a`/prepared pack URLs.
   */
  prepareExePackage?: PrepareExePackageFn;
}

export interface RgssEmulatorRunResult {
  scripts: RgssScript[];
  resourceCount: number;
}

const RGSS_WIDTH = 544;
const RGSS_HEIGHT = 416;

function isExeUrl(url: string): boolean {
  return /\.exe(?:[?#].*)?$/i.test(url);
}

function isPreparedPackUrl(url: string): boolean {
  return /\/api\/rgss\/exe-package\?file=/.test(url);
}

/**
 * RGSS3 게임을 웹에서 실행하기 위한 에뮬레이터.
 * Game.exe 흐름을 따르며 WebRGSS 기반으로 동작.
 */
export class RgssEmulator {
  private webRgss: WebRGSS | null = null;
  private readonly config: RgssEmulatorConfig;
  private state: RgssEmulatorState = "idle";
  private runInProgress = false;

  constructor(config: RgssEmulatorConfig) {
    this.config = {
      width: RGSS_WIDTH,
      height: RGSS_HEIGHT,
      frameRate: 60,
      ...config,
    };
  }

  getState(): RgssEmulatorState {
    return this.state;
  }

  private setState(s: RgssEmulatorState): void {
    this.state = s;
    this.config.onStateChange?.(s);
  }

  /**
   * 게임 URL(ZIP/EXE)로 실행.
   * Game.exe 흐름: RTP 설정 → 게임 로드 → Scripts 실행 → 메인 루프
   */
  async run(gameUrl: string): Promise<RgssEmulatorRunResult> {
    if (this.runInProgress) {
      throw new Error("RgssEmulator.run: 이미 실행 중입니다. 이전 실행이 완료될 때까지 대기하세요.");
    }
    this.runInProgress = true;
    try {
      return await this._run(gameUrl);
    } finally {
      this.runInProgress = false;
    }
  }

  private async _run(gameUrl: string): Promise<RgssEmulatorRunResult> {
    this.setState("rtp_loading");
    this.config.onProgress?.("RTP 로드", "RGSSSetupRTP 에뮬레이션");

    const rtpLoader = await loadRtp({
      onStatus: (status) => {
        this.config.onProgress?.("RTP", status.phase);
      },
    });

    this.config.onProgress?.("게임 패키지 준비");

    let packUrl: string;
    if (isPreparedPackUrl(gameUrl)) {
      packUrl = gameUrl;
    } else if (isExeUrl(gameUrl)) {
      if (!this.config.prepareExePackage) {
        throw new Error(
          "RgssEmulator: .exe URL received but RgssEmulatorConfig.prepareExePackage was not supplied. " +
          "Inject a server-side preparer (e.g. prepareExePackage from the host app's server actions)."
        );
      }
      const prepared = await this.config.prepareExePackage(gameUrl);
      if (!prepared.ok) throw new Error(prepared.error);
      packUrl = prepared.packUrl;
    } else {
      packUrl = gameUrl;
    }

    this.setState("game_loading");
    this.config.onProgress?.("게임 로드", "Data/Scripts.rvdata2 파싱");

    let loader: IResourceLoader;
    if (isPreparedPackUrl(gameUrl) || isExeUrl(gameUrl)) {
      loader = await StreamPackLoader.createBulk(packUrl, {
        maxBytes: 256 * 1024 * 1024,
        onProgress: (loaded, total) => {
          if (total != null && total > 0) {
            const pct = Math.round((loaded / total) * 100);
            this.config.onProgress?.("패키지 다운로드", `${pct}%`);
          }
        },
      });
    } else {
      const res = await fetch(packUrl);
      if (!res.ok) throw new Error(`게임 패키지 다운로드 실패 (${res.status})`);
      const zipBlob = await res.blob();
      const zip = await JSZip.loadAsync(zipBlob);
      loader = new ResourceLoader(zip);
    }

    this.setState("wasm_loading");
    this.config.onProgress?.("WASM 런타임", "RGSSInitialize3 + RGSSEval 에뮬레이션");

    const wasmBundleUrl =
      this.config.wasmBundleUrl ??
      `/api/rgss/wasm-bundle?url=${encodeURIComponent(gameUrl)}`;

    try {
      this.webRgss = await WebRGSS.create({
        canvas: this.config.canvas,
        width: this.config.width ?? RGSS_WIDTH,
        height: this.config.height ?? RGSS_HEIGHT,
        frameRate: this.config.frameRate ?? 60,
        playbackSpeed: this.config.playbackSpeed ?? 1,
        bootMode: "wasm_mruby",
        useWebGPU: true,
        onRuntimeDiagnostic: (d) => {
          if (d.severity === 'error') {
            this.config.onError?.(`[${d.code}] ${d.message}`);
          } else {
            this.config.onRuntimeWarning?.({
              severity: d.severity === 'info' ? 'info' : 'warning',
              code: d.code,
              message: d.message,
            });
            console.warn(`[RgssEmulator][${d.code}] ${d.message}`);
          }
        },
        onRuntimeStateChange: (s) => {
          this.config.onProgress?.("런타임", s);
        },
        onMsgbox: this.config.onMsgbox,
        onWasmDiagnostics: this.config.onWasmDiagnostics,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.config.onError?.(msg);
      throw err;
    }

    const loaded = await this.webRgss.loadFromLoader(loader, rtpLoader, {
      skipLegacyTitle: true,
    });

    const wasmLoader = this.webRgss.getResourceLoader();
    if (!wasmLoader) throw new Error("WASM용 리소스 로더 초기화 실패");

    await this.webRgss.bootWasmGame({
      loader: wasmLoader,
      wasmBundleUrl,
      wasmModuleUrl: this.config.wasmModuleUrl,
    });

    if (!this.webRgss) return { scripts: loaded.scripts, resourceCount: loaded.resourceCount };
    this.webRgss.start();
    this.setState("running");
    this.config.onProgress?.("실행 중", "RGSSGameMain 루프");
    this.config.canvas.focus({ preventScroll: true });

    return {
      scripts: loaded.scripts,
      resourceCount: loaded.resourceCount,
    };
  }

  /**
   * Blob(ZIP/rgss3a)으로 직접 실행.
   * wasmBundleUrl은 필수 (Blob은 URL이 없어 서버가 fetch할 수 없음).
   * Blob을 먼저 업로드해 번들 URL을 받은 뒤 호출하거나, wasmBundleUrl을 명시 지정.
   */
  async runFromBlob(
    blob: Blob,
    options?: { wasmBundleUrl: string }
  ): Promise<RgssEmulatorRunResult> {
    if (this.runInProgress) {
      throw new Error("RgssEmulator.runFromBlob: 이미 실행 중입니다.");
    }
    this.runInProgress = true;
    try {
      return await this._runFromBlob(blob, options);
    } finally {
      this.runInProgress = false;
    }
  }

  private async _runFromBlob(
    blob: Blob,
    options?: { wasmBundleUrl: string }
  ): Promise<RgssEmulatorRunResult> {
    const wasmBundleUrl = options?.wasmBundleUrl ?? this.config.wasmBundleUrl;
    if (!wasmBundleUrl) {
      throw new Error(
        "runFromBlob: wasmBundleUrl 필요 (Blob은 URL이 없어 서버가 fetch할 수 없음)"
      );
    }

    this.setState("rtp_loading");
    const rtpLoader = await loadRtp({});

    this.setState("game_loading");
    const zip = await import("jszip").then((m) => m.default.loadAsync(blob));
    const { ResourceLoader } = await import("./resources/ResourceLoader");
    const gameLoader = new ResourceLoader(zip);

    this.setState("wasm_loading");

    try {
      this.webRgss = await WebRGSS.create({
        canvas: this.config.canvas,
        width: this.config.width ?? RGSS_WIDTH,
        height: this.config.height ?? RGSS_HEIGHT,
        frameRate: this.config.frameRate ?? 60,
        playbackSpeed: this.config.playbackSpeed ?? 1,
        bootMode: "wasm_mruby",
        useWebGPU: true,
        onRuntimeDiagnostic: (d) => {
          if (d.severity === 'error') {
            this.config.onError?.(`[${d.code}] ${d.message}`);
          } else {
            this.config.onRuntimeWarning?.({
              severity: d.severity === 'info' ? 'info' : 'warning',
              code: d.code,
              message: d.message,
            });
            console.warn(`[RgssEmulator][${d.code}] ${d.message}`);
          }
        },
        onMsgbox: this.config.onMsgbox,
        onWasmDiagnostics: this.config.onWasmDiagnostics,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.config.onError?.(msg);
      throw err;
    }

    const loaded = await this.webRgss.loadFromLoader(gameLoader, rtpLoader, {
      skipLegacyTitle: true,
    });

    const wasmLoader = this.webRgss.getResourceLoader();
    if (!wasmLoader) throw new Error("WASM용 리소스 로더 초기화 실패");

    await this.webRgss.bootWasmGame({
      loader: wasmLoader,
      wasmBundleUrl,
      wasmModuleUrl: this.config.wasmModuleUrl,
    });

    if (!this.webRgss) return { scripts: loaded.scripts, resourceCount: loaded.resourceCount };
    this.webRgss.start();
    this.setState("running");
    return {
      scripts: loaded.scripts,
      resourceCount: loaded.resourceCount,
    };
  }

  /** 게임 중지 (RGSSFinalize 에뮬레이션). runInProgress는 run/_run finally에서 해제되므로 stop만 호출. */
  stop(): void {
    this.webRgss?.stop();
    this.webRgss = null;
    this.runInProgress = false;
    this.setState("stopped");
  }

  /** WebRGSS 인스턴스 (실행 중일 때만) */
  getWebRGSS(): WebRGSS | null {
    return this.webRgss;
  }

  /** 고속 재생 배율 설정 (1, 2, 4, 8). WASM mruby 틱 배치 실행 */
  setPlaybackSpeed(speed: number): void {
    this.webRgss?.setPlaybackSpeed(speed);
  }
}
