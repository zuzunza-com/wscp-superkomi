/**
 * Plane - RGSS3 무한 스크롤 배경 (맵 배경 등)
 * Viewport에 바인딩, bitmap, ox, oy, z
 * @see Spriteset_Map create_parallax
 */
import type { Viewport } from './Viewport';
import type { Bitmap } from './Bitmap';

export class Plane {
  viewport: Viewport | null;
  bitmap: Bitmap | null = null;
  ox = 0;
  oy = 0;
  z = 0;
  zoomX = 1;
  zoomY = 1;
  opacity = 255;
  blendType = 0;
  private _disposed = false;
  private _renderer: { addPlane: (p: Plane) => void; removePlane: (p: Plane) => void } | null = null;

  constructor(viewport: Viewport | null) {
    this.viewport = viewport;
  }

  dispose(): void {
    this._disposed = true;
    this._renderer?.removePlane(this);
    this._renderer = null;
  }

  get disposed(): boolean {
    return this._disposed;
  }

  update(): void {
    // 효과 업데이트 (필요 시)
  }

  setRenderer(r: { addPlane: (p: Plane) => void; removePlane: (p: Plane) => void } | null): void {
    if (this._renderer) this._renderer.removePlane(this);
    this._renderer = r;
    if (r) r.addPlane(this);
  }

  render(ctx: CanvasRenderingContext2D, baseX: number, baseY: number): void {
    if (this._disposed || !this.bitmap || this.bitmap.disposed || !this.bitmap.canvas) return;
    const vp = this.viewport;
    const vx = vp ? vp.rect.x : 0;
    const vy = vp ? vp.rect.y : 0;
    const vw = vp ? vp.rect.width : ctx.canvas.width;
    const vh = vp ? vp.rect.height : ctx.canvas.height;
    const ox = this.ox + (vp ? vp.ox : 0);
    const oy = this.oy + (vp ? vp.oy : 0);

    const bw = this.bitmap.width * this.zoomX;
    const bh = this.bitmap.height * this.zoomY;
    const startX = vx + baseX - (ox % bw);
    const startY = vy + baseY - (oy % bh);

    ctx.save();
    ctx.globalAlpha = this.opacity / 255;
    if (vp) {
      ctx.beginPath();
      ctx.rect(vx, vy, vw, vh);
      ctx.clip();
    }

    for (let dy = startY; dy < vy + vh + bh; dy += bh) {
      for (let dx = startX; dx < vx + vw + bw; dx += bw) {
        ctx.drawImage(
          this.bitmap.canvas,
          0, 0, this.bitmap.width, this.bitmap.height,
          dx, dy,
          bw,
          bh
        );
      }
    }

    ctx.restore();
  }
}
