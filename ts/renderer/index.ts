/**
 * 렌더러 barrel — 클라이언트 Canvas/WebGPU 표출 계층.
 *
 * 컨텍스트 획득(canvas.getContext('2d'|'webgpu')), 백엔드 폴백,
 * Sprite/Bitmap의 프레임 합성을 담당합니다.
 */

export type { IRenderer } from "./IRenderer";
export { CanvasRenderer } from "./CanvasRenderer";
export { WebGPURenderer } from "./WebGPURenderer";
