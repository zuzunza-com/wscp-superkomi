/**
 * Tilemap - RGSS3 타일맵 (맵 화면 배경)
 * map_data(Table 3D), bitmaps[], flags(Table), ox, oy
 * @see Spriteset_Map, mkxp-z tilemap.cpp
 */
import type { Viewport } from './Viewport';
import type { Bitmap } from './Bitmap';
import type { Table } from './Table';

const TILE_SIZE = 32;

export class Tilemap {
  viewport: Viewport | null;
  mapData: Table | null = null;
  flashData: Table | null = null;
  bitmaps: (Bitmap | null)[] = [];
  flags: Table | null = null;
  visible = true;
  ox = 0;
  oy = 0;
  private _disposed = false;
  private _renderer: { addTilemap: (t: Tilemap) => void; removeTilemap: (t: Tilemap) => void } | null = null;

  constructor(viewport: Viewport | null) {
    this.viewport = viewport;
  }

  dispose(): void {
    this._disposed = true;
    this._renderer?.removeTilemap(this);
    this._renderer = null;
  }

  get disposed(): boolean {
    return this._disposed;
  }

  update(): void {
    // 효과 업데이트 (필요 시)
  }

  /** 렌더러에 등록 (CanvasRenderer.addTilemap) */
  setRenderer(r: { addTilemap: (t: Tilemap) => void; removeTilemap: (t: Tilemap) => void } | null): void {
    if (this._renderer) this._renderer.removeTilemap(this);
    this._renderer = r;
    if (r) r.addTilemap(this);
  }

  /**
   * 타일 ID → 비트맵 인덱스 및 소스 좌표.
   * RGSS3: 0-2047 = A1, 2048-4095 = A2, ... (타일셋 레이아웃에 따라 다름)
   */
  private tileIdToSource(tileId: number): { bmpIdx: number; sx: number; sy: number } {
    if (tileId <= 0 || !this.bitmaps.length) return { bmpIdx: 0, sx: 0, sy: 0 };
    const id = tileId & 0x3ff;
    const bmpIdx = Math.min(Math.floor(tileId / 2048), this.bitmaps.length - 1);
    const bmp = this.bitmaps[Math.max(0, bmpIdx)];
    if (!bmp || bmp.disposed) return { bmpIdx: 0, sx: 0, sy: 0 };
    const tilesPerRow = Math.floor(bmp.width / TILE_SIZE) || 1;
    const row = Math.floor(id / tilesPerRow);
    const col = id % tilesPerRow;
    return { bmpIdx, sx: col * TILE_SIZE, sy: row * TILE_SIZE };
  }

  render(ctx: CanvasRenderingContext2D, baseX: number, baseY: number): void {
    if (this._disposed || !this.mapData || !this.visible) return;
    const vp = this.viewport;
    const vx = vp ? vp.rect.x : 0;
    const vy = vp ? vp.rect.y : 0;
    const vw = vp ? vp.rect.width : ctx.canvas.width;
    const vh = vp ? vp.rect.height : ctx.canvas.height;
    const ox = this.ox + (vp ? vp.ox : 0);
    const oy = this.oy + (vp ? vp.oy : 0);

    const xsize = this.mapData.xsize;
    const ysize = this.mapData.ysize;
    const zsize = Math.min(this.mapData.zsize, 3);

    const startX = Math.floor((-vx - baseX + ox) / TILE_SIZE);
    const startY = Math.floor((-vy - baseY + oy) / TILE_SIZE);
    const endX = Math.ceil((vw - vx - baseX + ox) / TILE_SIZE) + 1;
    const endY = Math.ceil((vh - vy - baseY + oy) / TILE_SIZE) + 1;

    ctx.save();
    if (vp) {
      ctx.beginPath();
      ctx.rect(vx, vy, vw, vh);
      ctx.clip();
    }

    for (let z = 0; z < zsize; z++) {
      for (let y = startY; y < endY; y++) {
        for (let x = startX; x < endX; x++) {
          const gx = ((x + xsize) % xsize + xsize) % xsize;
          const gy = ((y + ysize) % ysize + ysize) % ysize;
          const tileId = this.mapData.get(gx, gy, z);
          if (tileId <= 0) continue;
          const { bmpIdx, sx, sy } = this.tileIdToSource(tileId);
          const bmp = this.bitmaps[bmpIdx];
          if (!bmp || bmp.disposed || !bmp.canvas) continue;
          const dx = vx + baseX + x * TILE_SIZE - ox;
          const dy = vy + baseY + y * TILE_SIZE - oy;
          ctx.drawImage(bmp.canvas, sx, sy, TILE_SIZE, TILE_SIZE, dx, dy, TILE_SIZE, TILE_SIZE);
        }
      }
    }

    ctx.restore();
  }
}
