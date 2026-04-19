/**
 * Canvas 기반 RGSS 렌더러
 *
 * 트랜지션 합성:
 *   Graphics.freeze()         → 스냅샷 저장 (Graphics.frozenSnap)
 *   Graphics.transition(dur)  → dur 프레임 동안 frozen→live 크로스페이드
 *
 *   render() 시:
 *     - state === 'frozen'       : 스냅샷만 표시 (새 씬 렌더는 오프스크린에)
 *     - state === 'transitioning': 스냅샷(1-t) + 새 씬(t) 알파 합성
 *     - state === 'idle'         : 일반 렌더
 */
import { Graphics } from '../api/Graphics';
import type { Sprite } from '../api/Sprite';
import type { Tilemap } from '../api/Tilemap';
import type { Plane } from '../api/Plane';
import type { IRenderer } from './IRenderer';

export class CanvasRenderer implements IRenderer {
  private _canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;

  /** 트랜지션 중 "새 씬"을 먼저 그릴 오프스크린 캔버스 */
  private offscreen: HTMLCanvasElement;
  private offCtx: CanvasRenderingContext2D;

  private sprites: Sprite[] = [];
  private sortedSprites: Sprite[] = [];
  private tilemaps: Tilemap[] = [];
  private planes: Plane[] = [];
  private sortDirty = true;
  private backgroundColor = '#000000';

  constructor(canvas: HTMLCanvasElement) {
    this._canvas = canvas;
    const ctx = canvas.getContext('2d', { alpha: false }) as CanvasRenderingContext2D | null;
    if (!ctx) throw new Error('Canvas 2d context unavailable');
    this.ctx = ctx;

    this.offscreen = document.createElement('canvas');
    this.offscreen.width = this._canvas.width;
    this.offscreen.height = this._canvas.height;
    const offCtx = this.offscreen.getContext('2d') as CanvasRenderingContext2D | null;
    if (!offCtx) throw new Error('Offscreen 2d context unavailable');
    this.offCtx = offCtx;

    Graphics.setCanvas(canvas);
  }

  get canvas(): HTMLCanvasElement {
    return this._canvas;
  }

  setSize(width: number, height: number): void {
    this._canvas.width = width;
    this._canvas.height = height;
    this.offscreen.width = width;
    this.offscreen.height = height;
    Graphics.resizeScreen(width, height);
  }

  setBackgroundColor(color: string): void {
    this.backgroundColor = color;
  }

  addSprite(sprite: Sprite): void {
    if (!this.sprites.includes(sprite)) {
      this.sprites.push(sprite);
      sprite._renderer = this;
      this.sortDirty = true;
    }
  }

  removeSprite(sprite: Sprite): void {
    const i = this.sprites.indexOf(sprite);
    if (i >= 0) {
      sprite._renderer = null;
      this.sprites.splice(i, 1);
      this.sortDirty = true;
    }
  }

  addTilemap(tilemap: Tilemap): void {
    if (!this.tilemaps.includes(tilemap)) this.tilemaps.push(tilemap);
  }

  removeTilemap(tilemap: Tilemap): void {
    const i = this.tilemaps.indexOf(tilemap);
    if (i >= 0) this.tilemaps.splice(i, 1);
  }

  addPlane(plane: Plane): void {
    if (!this.planes.includes(plane)) this.planes.push(plane);
  }

  removePlane(plane: Plane): void {
    const i = this.planes.indexOf(plane);
    if (i >= 0) this.planes.splice(i, 1);
  }

  clearSprites(): void {
    for (const s of this.sprites) s._renderer = null;
    this.sprites = [];
    this.sortedSprites = [];
    this.tilemaps = [];
    this.planes = [];
    this.sortDirty = false;
  }

  markSortDirty(): void {
    this.sortDirty = true;
  }

  /** 정렬된 스프라이트 목록 갱신 */
  private ensureSorted(): void {
    if (!this.sortDirty) return;
    this.sortedSprites = [...this.sprites].sort((a, b) => {
      const dz = a.z - b.z;
      if (dz !== 0) return dz;
      return a.y - b.y;
    });
    this.sortDirty = false;
  }

  /** 지정 컨텍스트에 씬 드로우 (배경 + Plane + Tilemap + Sprite) */
  private drawScene(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    ctx.fillStyle = this.backgroundColor;
    ctx.fillRect(0, 0, w, h);
    const sortedPlanes = [...this.planes].sort((a, b) => a.z - b.z);
    for (const p of sortedPlanes) p.render(ctx, 0, 0);
    for (const t of this.tilemaps) t.render(ctx, 0, 0);
    const n = this.sortedSprites.length;
    for (let i = 0; i < n; i++) {
      this.sortedSprites[i]!.render(ctx, 0, 0);
    }
  }

  render(): void {
    this.ensureSorted();

    const { width: w, height: h } = this._canvas;
    const ctx = this.ctx;
    const state = Graphics.transitionState;

    if (state === 'frozen') {
      // 새 씬 렌더를 억제 — 스냅샷만 표시
      const snap = Graphics.frozenSnap;
      if (snap) {
        ctx.drawImage(snap, 0, 0);
      } else {
        ctx.fillStyle = this.backgroundColor;
        ctx.fillRect(0, 0, w, h);
      }
    } else if (state === 'transitioning') {
      const t = Graphics.transitionT;
      const snap = Graphics.frozenSnap;
      const mask = Graphics.transitionMask;

      // 오프스크린에 새 씬 그리기
      if (this.offscreen.width !== w || this.offscreen.height !== h) {
        this.offscreen.width = w;
        this.offscreen.height = h;
      }
      this.offCtx.clearRect(0, 0, w, h);
      this.drawScene(this.offCtx, w, h);

      // 메인 캔버스: 스냅샷 → 새씬 알파 크로스페이드
      ctx.clearRect(0, 0, w, h);

      if (snap) {
        ctx.globalAlpha = 1 - t;
        ctx.drawImage(snap, 0, 0);
      }

      if (mask) {
        // 마스크 기반 와이프: destination-in + source-over
        this.offCtx.save();
        this.offCtx.globalCompositeOperation = 'destination-in';
        this.offCtx.globalAlpha = 1;
        this.offCtx.drawImage(mask, 0, 0, w, h);
        this.offCtx.restore();
      }

      ctx.globalAlpha = t;
      ctx.drawImage(this.offscreen, 0, 0);
      ctx.globalAlpha = 1;
    } else {
      // idle — 일반 렌더
      this.drawScene(ctx, w, h);
    }

    // brightness 페이드 오버레이
    const brightness = Graphics.brightness;
    if (brightness < 255) {
      ctx.globalAlpha = (255 - brightness) / 255;
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, w, h);
      ctx.globalAlpha = 1;
    }
  }

  update(): void {
    Graphics.update();
    const n = this.sprites.length;
    for (let i = 0; i < n; i++) {
      this.sprites[i]!.update();
    }
  }
}
