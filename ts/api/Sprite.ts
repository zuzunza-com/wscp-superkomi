/**
 * Sprite - RGSS 스프라이트 (Canvas 렌더링용)
 */
import type { Bitmap } from './Bitmap';
import type { Viewport } from './Viewport';
import type { IRenderer } from '../renderer/IRenderer';
import { Rect } from './Rect';
import { Color } from './Color';
import { Tone } from './Tone';

export class Sprite {
  bitmap: Bitmap | null = null;
  srcRect: Rect = new Rect(0, 0, 0, 0);
  viewport: Viewport | null = null;
  visible = true;
  ox = 0;
  oy = 0;
  zoomX = 1;
  zoomY = 1;
  angle = 0;
  opacity = 255;
  blendType = 0; // 0=normal, 1=add, 2=sub
  color: Color = new Color(0, 0, 0, 0);
  tone: Tone = new Tone(0, 0, 0, 0);
  /** mkxp Sprite mirror: 좌우 반전 */
  mirror = false;
  /** mkxp Sprite bush_depth: 덤불에 가려지는 하단 픽셀 수 */
  bushDepth = 0;
  /** mkxp Sprite bush_opacity: 덤불 영역 불투명도 0–255 */
  bushOpacity = 128;

  /** z/y 변경 시 렌더러에 sort dirty 알림용 */
  _renderer: IRenderer | null = null;

  private _x = 0;
  private _y = 0;
  private _z = 0;
  private _disposed = false;

  constructor(viewport?: Viewport | null) {
    this.viewport = viewport ?? null;
  }

  get x(): number { return this._x; }
  set x(v: number) { this._x = v; }

  get y(): number { return this._y; }
  set y(v: number) {
    if (this._y !== v) {
      this._y = v;
      this._renderer?.markSortDirty();
    }
  }

  get z(): number { return this._z; }
  set z(v: number) {
    if (this._z !== v) {
      this._z = v;
      this._renderer?.markSortDirty();
    }
  }

  dispose(): void {
    this.bitmap = null;
    this.viewport = null;
    this._renderer = null;
    this._disposed = true;
  }

  get disposed(): boolean {
    return this._disposed;
  }

  get width(): number {
    if (!this.bitmap) return 0;
    return (this.srcRect.width || this.bitmap.width) * this.zoomX;
  }

  get height(): number {
    if (!this.bitmap) return 0;
    return (this.srcRect.height || this.bitmap.height) * this.zoomY;
  }

  flash(_color: Color | null, _duration: number): void {
    // 플래시 효과 (현재 미구현 — 시각적 차이 없이 통과)
  }

  update(): void {
    // 애니메이션 등
  }

  /** Canvas에 그리기 */
  render(ctx: CanvasRenderingContext2D, baseX: number, baseY: number): void {
    if (!this.visible || this._disposed || !this.bitmap || this.bitmap.disposed)
      return;
    if (!this.bitmap.canvas || this.bitmap.canvas.width <= 0 || this.bitmap.canvas.height <= 0)
      return;

    const src = this.srcRect;
    const sw = src.width || this.bitmap.width;
    const sh = src.height || this.bitmap.height;
    if (sw <= 0 || sh <= 0) return;

    let dw = sw * this.zoomX;
    let dh = sh * this.zoomY;
    let dx = this._x - this.ox * this.zoomX + baseX;
    let dy = this._y - this.oy * this.zoomY + baseY;

    const alpha = this.opacity / 255;
    const mirror = this.mirror;
    const bushDepth = Math.max(0, this.bushDepth);
    const bushOpacity = Math.max(0, Math.min(255, this.bushOpacity)) / 255;

    const drawRect = (sx: number, sy: number, swr: number, shr: number, dx2: number, dy2: number, dwr: number, dhr: number): void => {
      ctx.drawImage(this.bitmap!.canvas!, sx, sy, swr, shr, dx2, dy2, dwr, dhr);
    };

    const draw = (sx: number, sy: number, swr: number, shr: number, dx2: number, dy2: number, dwr: number, dhr: number): void => {
      if (mirror) {
        ctx.save();
        ctx.translate(dx2 + dwr, dy2);
        ctx.scale(-1, 1);
        ctx.translate(-dx2, -dy2);
      }
      drawRect(sx, sy, swr, shr, dx2, dy2, dwr, dhr);
      if (mirror) ctx.restore();
    };

    ctx.save();
    ctx.globalAlpha = alpha;

    if (this.angle !== 0) {
      ctx.translate(dx + dw / 2, dy + dh / 2);
      ctx.rotate((this.angle * Math.PI) / 180);
      ctx.translate(-dw / 2, -dh / 2);
      dx = 0;
      dy = 0;
    }

    if (bushDepth > 0 && bushOpacity > 0 && sh > 0) {
      const bushPx = Math.min(sh, bushDepth);
      const bushNorm = bushPx / sh;
      const topH = sh - bushPx;
      const topDh = dh * (1 - bushNorm);
      const bushDh = dh * bushNorm;
      if (topH > 0) {
        draw(src.x, src.y, sw, topH, dx, dy, dw, topDh);
      }
      if (bushPx > 0) {
        ctx.globalAlpha = alpha * (1 - bushOpacity);
        draw(src.x, src.y + topH, sw, bushPx, dx, dy + topDh, dw, bushDh);
      }
    } else {
      draw(src.x, src.y, sw, sh, dx, dy, dw, dh);
    }

    ctx.restore();
  }
}
