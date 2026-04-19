/**
 * wscp-superkomi — WebRGSS WASM mruby 런타임 + TypeScript 클라이언트.
 *
 * 이 모듈은 RPG Maker VX Ace (RGSS3) 게임을 브라우저에서 실행하기 위한
 * 전체 런타임 스택을 제공합니다:
 *
 *  - `wasm/*` : Emscripten + mruby 코어(js_* 바인딩)
 *  - `api/*`  : RGSS3 공개 API (Graphics, Input, Bitmap, Sprite, Window ...)
 *  - `renderer/*` : Canvas 2D / WebGPU 백엔드
 *  - `runtime/*`  : 스크립트/씬/데이터 브리지
 *  - `rvdata2/*`  : Ruby Marshal + Scripts.rvdata2 파서
 *  - `resources/*`: .zip / .rgss3a / RTP / StreamPack 로더
 *  - `rpg/*`      : RPG::System 등 데이터 클래스
 *  - `game/*`     : TitleScene 등 기본 씬
 *
 * 라이선스/참조 고지: NOTICE.md
 *   - mkxp-z (GPL-2.0+) : 행위 기준 참조 (clean-room 재구현)
 *   - mkxp-web (GPL-2.0+) : WASM 로더/캔버스 부착 원리 참조
 */

// ─── 최상위 파사드 ───────────────────────────────────────────────────────────

export { WebRGSS } from "./WebRGSS";
export type { WebRGSSConfig } from "./WebRGSS";
export {
  RgssEmulator,
} from "./RgssEmulator";
export type {
  RgssEmulatorConfig,
  RgssEmulatorState,
  RgssEmulatorRunResult,
  PrepareExePackageResult,
  PrepareExePackageFn,
} from "./RgssEmulator";

export {
  loadGameFromLoader,
  loadGameFromZip,
  loadGameFromRgss3a,
} from "./loadGameFromZip";
export type { LoadedGame } from "./loadGameFromZip";

// ─── WASM 런타임 (저수준) ───────────────────────────────────────────────────

export { WasmRgssRuntime } from "./wasm/WasmRgssRuntime";
export type {
  WasmRgssRuntimeOptions,
  WasmRgssState,
  WasmRuntimeDiagnostics,
  RgssScript as WasmRgssScript,
} from "./wasm/WasmRgssRuntime";
export { WasmRgssBridge } from "./wasm/WasmRgssBridge";
export { WasmMemory } from "./wasm/WasmMemory";

// ─── RGSS3 API (공식 표면) ──────────────────────────────────────────────────

export {
  Audio,
  setAudioResourceLoader,
  audioPumpPending,
  Bitmap,
  Color,
  Font,
  Graphics,
  Input,
  InputState,
  resolveInputKey,
  Plane,
  Rect,
  Sprite,
  Table,
  Tilemap,
  Tone,
  Viewport,
  Window,
} from "./api";
export type { GraphicsConfig, TransitionState, GetAudioUrl } from "./api";

// ─── 렌더러 ──────────────────────────────────────────────────────────────────

export {
  CanvasRenderer,
  WebGPURenderer,
} from "./renderer";
export type { IRenderer } from "./renderer";

// ─── 런타임 브리지 ───────────────────────────────────────────────────────────

export {
  DataManagerBridge,
  RgssHostBridge,
  SceneManagerBridge,
  TranspiledScriptRuntime,
} from "./runtime";
export type { RegisteredScript, RuntimeBundleModule } from "./runtime";

// ─── rvdata2 / Marshal ──────────────────────────────────────────────────────

export {
  parseScriptsRvdata2,
  parseScriptsRvdata2Detailed,
  parseScriptsFromZip,
  parseScriptsFromZipDetailed,
  getScriptsFromZip,
  parseRvdata2,
  parseRvdata2FromZip,
  RubyMarshalDecodeError,
  parseRubyMarshalRich,
  decodeRubyMarshalToJs,
  decodeRgssScriptsFromMarshal,
} from "./rvdata2";
export type {
  RgssScript,
  ParseScriptsDetailedResult,
  TextQualityResult,
} from "./rvdata2";

// ─── 리소스 로더 ─────────────────────────────────────────────────────────────

export {
  ResourceLoader,
  Rgss3aLoader,
  tryLoadRgssArchive,
  RouteRtpLoader,
  RtpBackedResourceLoader,
  loadRtp,
  getRtpLoader,
  getRtpSourceUrl,
  StreamPackLoader,
} from "./resources";
export type {
  IResourceLoader,
  IResourceResolver,
  RtpLoadStatus,
  LoadRtpOptions,
  StreamPackBulkOptions,
} from "./resources";

// ─── RPG:: 데이터 클래스 ────────────────────────────────────────────────────

export { normalizeRPGSystem, normalizeRPGAudioFile } from "./rpg";
export type { RPGSystem, RPGAudioFile } from "./rpg";

// ─── 스크립트 파서 / UX / 게임 ───────────────────────────────────────────────

export { parseRgssScript } from "./rgss";
export type { ParsedScriptBlock } from "./rgss";
export { parseRgssScriptError } from "./utils";
export { formatMsgboxForDisplay } from "./ux";
export type { MsgboxAlertVariant, MsgboxDisplayInfo } from "./ux";
export { TitleScene } from "./game";

// ─── 진단 타입 ───────────────────────────────────────────────────────────────

export type {
  RgssTranspileDiagnostic,
  RgssRuntimeBundleManifest,
  RgssRuntimeBundleResponse,
  RgssScriptLike,
} from "./types";
