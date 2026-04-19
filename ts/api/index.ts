/**
 * RGSS3 API barrel — RPG Maker VX Ace 공식 API 표면.
 * 클래스와 싱글턴 모듈을 통합 export합니다.
 */

export { Audio, setAudioResourceLoader, audioPumpPending } from "./Audio";
export type { GetAudioUrl } from "./Audio";
export { Bitmap } from "./Bitmap";
export { Color } from "./Color";
export { Font } from "./Font";
export { Graphics } from "./Graphics";
export type { GraphicsConfig, TransitionState } from "./Graphics";
export { Input, InputState, resolveInputKey } from "./Input";
export { Plane } from "./Plane";
export { Rect } from "./Rect";
export { Sprite } from "./Sprite";
export { Table } from "./Table";
export { Tilemap } from "./Tilemap";
export { Tone } from "./Tone";
export { Viewport } from "./Viewport";
export { Window } from "./Window";
