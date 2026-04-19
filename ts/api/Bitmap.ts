/**
 * Bitmap - RGSS 비트맵 (Canvas 기반)
 * 이미지 로드, 텍스트 그리기, 픽셀 조작
 */
import { Rect } from './Rect';
import { Color } from './Color';
import { Font } from './Font';

export class Bitmap {
  private _width: number;
  private _height: number;
  private _canvas: HTMLCanvasElement;
  private _ctx: CanvasRenderingContext2D;
  private _disposed = false;
  font: Font;

  get width(): number {
    return this._width;
  }
  get height(): number {
    return this._height;
  }

  constructor(arg1: number | string, height?: number) {
    if (typeof arg1 === 'number' && height !== undefined) {
      this._width = arg1;
      this._height = height;
    } else if (typeof arg1 === 'string') {
      this._width = 1;
      this._height = 1;
    } else {
      this._width = arg1 ?? 1;
      this._height = height ?? 1;
    }

    this._canvas = document.createElement('canvas');
    this._canvas.width = this._width;
    this._canvas.height = this._height;
    const ctx = this._canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Canvas 2d context unavailable');
    this._ctx = ctx;
    this.font = new Font();
  }

  get canvas(): HTMLCanvasElement {
    return this._canvas;
  }

  get context(): CanvasRenderingContext2D {
    return this._ctx;
  }

  dispose(): void {
    if (!this._disposed) {
      this._disposed = true;
    }
  }

  get disposed(): boolean {
    return this._disposed;
  }

  rect(): Rect {
    return new Rect(0, 0, this.width, this.height);
  }

  /** Bitmap#clone — Cache.hue_changed_bitmap 등에서 사용. 새 Bitmap에 drawImage로 복사. */
  clone(): Bitmap {
    if (this._disposed) throw new Error('Bitmap is disposed');
    const cloned = new Bitmap(this._width, this._height);
    cloned.font.name = this.font.name;
    cloned.font.size = this.font.size;
    cloned.font.bold = this.font.bold;
    cloned.font.italic = this.font.italic;
    cloned.font.outline = this.font.outline;
    cloned.font.shadow = this.font.shadow;
    const c = this.font.color;
    if (c) cloned.font.color = c instanceof Color ? new Color(c.red, c.green, c.blue, c.alpha) : { ...c };
    const oc = this.font.outColor;
    if (oc) cloned.font.outColor = oc instanceof Color ? new Color(oc.red, oc.green, oc.blue, oc.alpha) : { ...oc };
    cloned._ctx.drawImage(this._canvas, 0, 0);
    return cloned;
  }

  /** 경로 로드 후 1x1 플레이스홀더를 실제 이미지로 교체 (WasmRgssBridge에서 사용) */
  replaceFromLoaded(loaded: Bitmap): void {
    if (this._disposed || loaded.disposed) return;
    if (!loaded.canvas || loaded.width <= 0 || loaded.height <= 0) return;
    this._width = loaded.width;
    this._height = loaded.height;
    this._canvas.width = this._width;
    this._canvas.height = this._height;
    this._ctx.drawImage(loaded.canvas, 0, 0);
  }

  blt(
    x: number,
    y: number,
    srcBitmap: Bitmap,
    srcRect: Rect,
    opacity = 255
  ): void {
    if (this._disposed || srcBitmap.disposed) return;
    if (!srcBitmap.canvas || srcBitmap.canvas.width <= 0 || srcBitmap.canvas.height <= 0) return;
    if (srcRect.width <= 0 || srcRect.height <= 0) return;
    this._ctx.globalAlpha = opacity / 255;
    this._ctx.drawImage(
      srcBitmap.canvas,
      srcRect.x,
      srcRect.y,
      srcRect.width,
      srcRect.height,
      x,
      y,
      srcRect.width,
      srcRect.height
    );
    this._ctx.globalAlpha = 1;
  }

  stretchBlt(
    destRect: Rect,
    srcBitmap: Bitmap,
    srcRect: Rect,
    opacity = 255
  ): void {
    if (this._disposed || srcBitmap.disposed) return;
    if (!srcBitmap.canvas || srcBitmap.canvas.width <= 0 || srcBitmap.canvas.height <= 0) return;
    this._ctx.globalAlpha = opacity / 255;
    this._ctx.drawImage(
      srcBitmap.canvas,
      srcRect.x,
      srcRect.y,
      srcRect.width,
      srcRect.height,
      destRect.x,
      destRect.y,
      destRect.width,
      destRect.height
    );
    this._ctx.globalAlpha = 1;
  }

  fillRect(
    x: number,
    y: number,
    width: number,
    height: number,
    color?: Color
  ): void;
  fillRect(rect: Rect, color?: Color): void;
  fillRect(
    arg1: number | Rect,
    arg2?: number | Color,
    width?: number,
    height?: number,
    color?: Color
  ): void {
    let x: number;
    let y: number;
    let w: number;
    let h: number;
    let c: Color | undefined;
    if (arg1 instanceof Rect) {
      x = arg1.x;
      y = arg1.y;
      w = arg1.width;
      h = arg1.height;
      c = arg2 as Color | undefined;
    } else {
      x = arg1;
      y = (arg2 as number) ?? 0;
      w = width ?? 0;
      h = height ?? 0;
      c = color;
    }
    if (c) {
      this._ctx.fillStyle = c.toCss();
    }
    this._ctx.fillRect(x, y, w, h);
  }

  clear(): void {
    this._ctx.clearRect(0, 0, this.width, this.height);
  }

  clearRect(x: number, y?: number, width?: number, height?: number): void {
    if (y === undefined) {
      this._ctx.clearRect(x, 0, this.width, this.height);
    } else {
      this._ctx.clearRect(x, y, width ?? this.width, height ?? this.height);
    }
  }

  drawText(
    x: number,
    y: number,
    width: number,
    height: number,
    text: string,
    align?: number
  ): void;
  drawText(rect: Rect, text: string, align?: number): void;
  drawText(
    arg1: number | Rect,
    arg2: number | string,
    arg3?: number | string,
    height?: number,
    arg5?: string | number,
    align?: number
  ): void {
    let x: number;
    let y: number;
    let w: number;
    let h: number;
    let text: string;
    let alignVal: number;
    if (arg1 instanceof Rect) {
      x = arg1.x;
      y = arg1.y;
      w = arg1.width;
      h = arg1.height;
      text = arg2 as string;
      alignVal = (arg3 as number) ?? 0;
    } else {
      x = arg1;
      y = arg2 as number;
      w = arg3 as number;
      h = height ?? 0;
      text = arg5 as string;
      alignVal = align ?? 0;
    }
    this._ctx.font = this.font.toCss();
    this._ctx.fillStyle = this.font.color
      ? `rgba(${this.font.color.red},${this.font.color.green},${this.font.color.blue},${(this.font.color.alpha ?? 255) / 255})`
      : '#ffffff';
    this._ctx.textBaseline = 'top';
    const metrics = this._ctx.measureText(text);
    const ascent = (metrics as { actualBoundingBoxAscent?: number }).actualBoundingBoxAscent ?? this.font.size * 0.8;
    const descent = (metrics as { actualBoundingBoxDescent?: number }).actualBoundingBoxDescent ?? this.font.size * 0.2;
    const textHeight = Math.max(1, ascent + descent);
    const drawHeight = h > 0 ? h : this.font.size + 4;
    const ty = y + Math.max(0, (drawHeight - textHeight) / 2);
    let tx = x;
    if (alignVal === 1) tx = x + (w - metrics.width) / 2;
    else if (alignVal === 2) tx = x + w - metrics.width;
    this._ctx.fillText(text, tx, ty, w);
  }

  textSize(str: string): { width: number; height: number } {
    this._ctx.font = this.font.toCss();
    const m = this._ctx.measureText(str);
    return {
      width: m.width,
      height: this.font.size + 4,
    };
  }

  /**
   * Bitmap#hue_change — mkxp bitmap.cpp hueChange() 참고.
   * HSV hue 회전. hue: 0–359 (RGSS), 360의 배수면 no-op.
   */
  hueChange(hue: number): void {
    if (this._disposed) return;
    const h = ((hue % 360) + 360) % 360;
    if (h === 0) return;
    const tmp = document.createElement('canvas');
    tmp.width = this._width;
    tmp.height = this._height;
    const tctx = tmp.getContext('2d');
    if (!tctx) return;
    tctx.filter = `hue-rotate(${h}deg)`;
    tctx.drawImage(this._canvas, 0, 0);
    this._ctx.clearRect(0, 0, this._width, this._height);
    this._ctx.drawImage(tmp, 0, 0);
  }

  /**
   * Bitmap#radial_blur — mkxp bitmap.cpp radialBlur() 참고.
   * angle: 0–359, divisions: 2–100. 회전된 복사본을 additive blend로 합성.
   */
  radialBlur(angle: number, divisions: number): void {
    if (this._disposed) return;
    const a = Math.max(0, Math.min(359, angle));
    const d = Math.max(2, Math.min(100, divisions));
    const opacity = 1 / d;
    const cx = this._width / 2;
    const cy = this._height / 2;
    const baseAngle = (-a * Math.PI) / 360;
    const angleStep = d > 1 ? (a * Math.PI) / 180 / (d - 1) : 0;
    const tmp = document.createElement('canvas');
    tmp.width = this._width;
    tmp.height = this._height;
    const tctx = tmp.getContext('2d');
    if (!tctx) return;
    tctx.clearRect(0, 0, this._width, this._height);
    for (let i = 0; i < d; i++) {
      tctx.save();
      tctx.globalAlpha = opacity;
      tctx.translate(cx, cy);
      tctx.rotate(baseAngle + i * angleStep);
      tctx.translate(-cx, -cy);
      tctx.drawImage(this._canvas, 0, 0);
      tctx.restore();
    }
    this._ctx.clearRect(0, 0, this._width, this._height);
    this._ctx.drawImage(tmp, 0, 0);
  }

  /** URL(또는 blob URL)로 비트맵 로드 */
  static async load(url: string): Promise<Bitmap> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const w = Math.max(1, img.width || 1);
        const h = Math.max(1, img.height || 1);
        const bmp = new Bitmap(w, h);
        if (img.width > 0 && img.height > 0) {
          bmp.context.drawImage(img, 0, 0);
        }
        resolve(bmp);
      };
      img.onerror = () => reject(new Error(`Bitmap load failed: ${url}`));
      img.src = url;
    });
  }

  /** ResourceLoader를 통한 경로 로드 (zip 내 이미지) */
  static async loadFromResource(
    getImageUrl: (path: string) => Promise<string | null>,
    path: string
  ): Promise<Bitmap | null> {
    const url = await getImageUrl(path);
    if (!url) return null;
    try {
      return await Bitmap.load(url);
    } catch {
      return null;
    }
  }
}
