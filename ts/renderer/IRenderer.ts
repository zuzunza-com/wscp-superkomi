/**
 * IRenderer - RGSS 렌더러 공통 인터페이스
 *
 * CanvasRenderer, WebGPURenderer 등이 구현.
 */
import type { Sprite } from '../api/Sprite';
import type { Tilemap } from '../api/Tilemap';
import type { Plane } from '../api/Plane';

export interface IRenderer {
  setSize(width: number, height: number): void;
  setBackgroundColor(color: string): void;
  addSprite(s: Sprite): void;
  removeSprite(s: Sprite): void;
  addTilemap(t: Tilemap): void;
  removeTilemap(t: Tilemap): void;
  addPlane(p: Plane): void;
  removePlane(p: Plane): void;
  clearSprites(): void;
  markSortDirty(): void;
  update(): void;
  render(): void;
  readonly canvas: HTMLCanvasElement;
}
