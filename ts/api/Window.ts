/**
 * Window - RGSS 스타일 윈도우 (Window_Base 호환)
 * - 배경/테두리 렌더링, contents(Bitmap), 커서 하이라이트
 * - open/close 애니메이션: update_open(+48/frame), update_close(-48/frame)
 * - openness 렌더링: mkxp WindowVX 방식 (중심에서 수직 확장)
 * @see http://lib.orzfly.com/sites/rpgmaker-default-scripts-docs/docs/rpgmaker-vxace.ja/classes/Window_Base.html
 * @see https://github.com/mkxp-z/mkxp-z/blob/dev/src/display/windowvx.cpp (openness, isOpen, isClosed)
 */
import { Bitmap } from "./Bitmap";
import { Rect } from "./Rect";
import { Sprite } from "./Sprite";

/** Window_Base 호환: openness 변화량 (def update_open/update_close) */
const OPENNESS_STEP = 48;

/** RGSS3 기본값 (mkxp-z DEF_PADDING, DEF_BACK_OPAC) */
const RGSS3_PADDING = 12;
const RGSS3_BACK_OPACITY = 192;

export class Window extends Sprite {
  contents: Bitmap;
  /** Window_Base: Cache.system("Window") — text_color(n)에서 get_pixel로 색상 추출 */
  windowskin: Bitmap | null = null;
  padding = RGSS3_PADDING;
  /** mkxp WindowVX padding_bottom: 하단 패딩 (RGSS3 Window_Base) */
  paddingBottom = RGSS3_PADDING;
  backOpacity = RGSS3_BACK_OPACITY;
  contentsOpacity = 255;
  active = true;
  openness = 255;
  cursorRect: Rect = new Rect(0, 0, 0, 0);

  private _framePhase = 0;
  private _opening = false;
  private _closing = false;

  constructor(x = 0, y = 0, width = 160, height = 96) {
    super();
    const w = Math.max(1, Number(width) || 0);
    const h = Math.max(1, Number(height) || 0);
    this.x = x;
    this.y = y;
    this.z = 100;
    this.bitmap = new Bitmap(w, h);
    this.contents = new Bitmap(
      Math.max(1, w - this.padding * 2),
      Math.max(1, h - this.padding - this.paddingBottom)
    );
    this.redrawWindow();
  }

  get windowWidth(): number {
    return this.bitmap?.width ?? 0;
  }

  set windowWidth(w: number) {
    if (w <= 0 || w === this.windowWidth) return;
    this.bitmap?.dispose();
    this.bitmap = new Bitmap(w, this.windowHeight || 1);
    this.contents?.dispose();
    this.contents = new Bitmap(Math.max(1, w - this.padding * 2), Math.max(1, this.windowHeight - this.padding - this.paddingBottom));
    this.redrawWindow();
  }

  get windowHeight(): number {
    return this.bitmap?.height ?? 0;
  }

  set windowHeight(h: number) {
    if (h <= 0 || h === this.windowHeight) return;
    this.bitmap?.dispose();
    this.bitmap = new Bitmap(this.windowWidth || 1, h);
    this.contents?.dispose();
    this.contents = new Bitmap(Math.max(1, this.windowWidth - this.padding * 2), Math.max(1, h - this.padding - this.paddingBottom));
    this.redrawWindow();
  }

  setCursorRect(x: number, y: number, width: number, height: number): void {
    this.cursorRect.x = x;
    this.cursorRect.y = y;
    this.cursorRect.width = width;
    this.cursorRect.height = height;
  }

  clearContents(): void {
    this.contents.clear();
  }

  private redrawWindowFromSkin(): boolean {
    if (!this.bitmap || !this.windowskin || this.windowskin.disposed || !this.windowskin.canvas) return false;

    const skinCanvas = this.windowskin.canvas;
    const skinW = this.windowskin.width;
    const skinH = this.windowskin.height;
    if (skinW < 128 || skinH < 64) return false;

    const dstW = this.bitmap.width;
    const dstH = this.bitmap.height;
    const ctx = this.bitmap.context;
    const border = 16;
    const innerX = border;
    const innerY = border;
    const innerW = Math.max(0, dstW - border * 2);
    const innerH = Math.max(0, dstH - border * 2);

    if (innerW > 0 && innerH > 0) {
      const srcBgX = 0;
      const srcBgY = 0;
      const srcBgW = 64;
      const srcBgH = 64;
      const alpha = Math.max(0, Math.min(255, this.backOpacity)) / 255;
      ctx.save();
      ctx.globalAlpha = alpha;
      for (let y = 0; y < innerH; y += srcBgH) {
        const tileH = Math.min(srcBgH, innerH - y);
        for (let x = 0; x < innerW; x += srcBgW) {
          const tileW = Math.min(srcBgW, innerW - x);
          ctx.drawImage(
            skinCanvas,
            srcBgX,
            srcBgY,
            tileW,
            tileH,
            innerX + x,
            innerY + y,
            tileW,
            tileH
          );
        }
      }
      ctx.restore();
    }

    const srcFrameX = 64;
    const srcFrameY = 0;
    const srcFrameSize = 64;
    const edge = border;
    const centerW = Math.max(0, dstW - edge * 2);
    const centerH = Math.max(0, dstH - edge * 2);
    const srcCenter = Math.max(0, srcFrameSize - edge * 2);

    // corners
    ctx.drawImage(skinCanvas, srcFrameX, srcFrameY, edge, edge, 0, 0, edge, edge);
    ctx.drawImage(skinCanvas, srcFrameX + srcFrameSize - edge, srcFrameY, edge, edge, Math.max(0, dstW - edge), 0, edge, edge);
    ctx.drawImage(skinCanvas, srcFrameX, srcFrameY + srcFrameSize - edge, edge, edge, 0, Math.max(0, dstH - edge), edge, edge);
    ctx.drawImage(
      skinCanvas,
      srcFrameX + srcFrameSize - edge,
      srcFrameY + srcFrameSize - edge,
      edge,
      edge,
      Math.max(0, dstW - edge),
      Math.max(0, dstH - edge),
      edge,
      edge
    );

    // edges + center
    if (centerW > 0 && srcCenter > 0) {
      ctx.drawImage(skinCanvas, srcFrameX + edge, srcFrameY, srcCenter, edge, edge, 0, centerW, edge);
      ctx.drawImage(
        skinCanvas,
        srcFrameX + edge,
        srcFrameY + srcFrameSize - edge,
        srcCenter,
        edge,
        edge,
        Math.max(0, dstH - edge),
        centerW,
        edge
      );
    }
    if (centerH > 0 && srcCenter > 0) {
      ctx.drawImage(skinCanvas, srcFrameX, srcFrameY + edge, edge, srcCenter, 0, edge, edge, centerH);
      ctx.drawImage(
        skinCanvas,
        srcFrameX + srcFrameSize - edge,
        srcFrameY + edge,
        edge,
        srcCenter,
        Math.max(0, dstW - edge),
        edge,
        edge,
        centerH
      );
    }
    return true;
  }

  redrawWindow(): void {
    if (!this.bitmap) return;
    const bmp = this.bitmap;
    bmp.clear();

    const w = bmp.width;
    const h = bmp.height;
    const ctx = bmp.context;

    if (this.redrawWindowFromSkin()) return;

    // outer frame
    ctx.fillStyle = "rgba(0,0,0,0.75)";
    ctx.fillRect(0, 0, w, h);

    // inner panel
    ctx.fillStyle = `rgba(18,22,34,${Math.max(0, Math.min(255, this.backOpacity)) / 255})`;
    ctx.fillRect(2, 2, Math.max(0, w - 4), Math.max(0, h - 4));

    // border
    ctx.strokeStyle = "rgba(220,228,255,0.85)";
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, Math.max(0, w - 1), Math.max(0, h - 1));
    ctx.strokeStyle = "rgba(120,140,190,0.8)";
    ctx.strokeRect(2.5, 2.5, Math.max(0, w - 5), Math.max(0, h - 5));
  }

  /** Window_Base#open — 열기 애니메이션 시작 (def open; @opening = true unless open?; @closing = false; self; end) */
  open(): this {
    if (!this.isOpen()) {
      this._opening = true;
      this._closing = false;
    }
    return this;
  }

  /** Window_Base#close — 닫기 애니메이션 시작 (def close; @closing = true unless close?; @opening = false; self; end) */
  close(): this {
    if (!this.isClosed()) {
      this._closing = true;
      this._opening = false;
    }
    return this;
  }

  /** open? — mkxp WindowVX::isOpen(): openness == 255 */
  isOpen(): boolean {
    return this.openness === 255;
  }

  /** close? — mkxp WindowVX::isClosed(): openness == 0 */
  isClosed(): boolean {
    return this.openness === 0;
  }

  /** def update_open; self.openness += 48; @opening = false if open?; end */
  private updateOpen(): void {
    this.openness = Math.min(255, this.openness + OPENNESS_STEP);
    if (this.isOpen()) this._opening = false;
  }

  /** def update_close; self.openness -= 48; @closing = false if close?; end */
  private updateClose(): void {
    this.openness = Math.max(0, this.openness - OPENNESS_STEP);
    if (this.isClosed()) this._closing = false;
  }

  /** Window_Base#update — def update; super; update_tone; update_open if @opening; update_close if @closing; end */
  override update(): void {
    super.update();
    this._framePhase += 1;
    if (this._opening) this.updateOpen();
    if (this._closing) this.updateClose();
  }

  /**
   * mkxp WindowVX 방식 openness 렌더링:
   * - openness <= 0: 미렌더
   * - openness < 255: 베이스(프레임)만 수직 클리핑으로 표시 (중심에서 확장)
   * - openness >= 255: 베이스 + contents + 커서 전체 표시
   * @see mkxp-z windowvx.cpp updateBaseQuad(), draw()
   */
  override render(ctx: CanvasRenderingContext2D, baseX: number, baseY: number): void {
    if (!this.visible) return;
    if (this.openness <= 0) return;

    const w = this.bitmap?.width ?? 0;
    const h = this.bitmap?.height ?? 0;
    if (w <= 0 || h <= 0) return;

    const frameX = this.x + baseX;
    const frameY = this.y + baseY;
    const contentsX = frameX + this.padding - this.ox;
    const contentsY = frameY + this.padding - this.oy;
    const openNorm = this.openness / 255;

    ctx.save();
    ctx.globalAlpha = this.opacity / 255;

    /* 베이스(윈도우 프레임): mkxp updateBaseQuad() - pos(0, (h/2)*(1-norm), w, h*norm) */
    if (this.bitmap && !this.bitmap.disposed && this.bitmap.canvas) {
      if (this.openness < 255) {
        const posY = (h / 2) * (1 - openNorm);
        const dispH = h * openNorm;
        ctx.drawImage(this.bitmap.canvas, 0, 0, w, h, frameX, frameY + posY, w, dispH);
      } else {
        ctx.drawImage(this.bitmap.canvas, 0, 0, w, h, frameX, frameY, w, h);
      }
    }

    /* contents + 커서: mkxp는 openness < 255일 때 early return으로 생략 */
    if (this.openness >= 255 && !this.contents.disposed && this.contents.canvas) {
      if (this.contents.width > 0 && this.contents.height > 0) {
        ctx.globalAlpha = (this.opacity / 255) * (this.contentsOpacity / 255);
        ctx.drawImage(
          this.contents.canvas,
          contentsX,
          contentsY,
          this.contents.width,
          this.contents.height
        );
      }

      if (this.active && this.cursorRect.width > 0 && this.cursorRect.height > 0) {
        const pulse = 0.22 + (Math.sin(this._framePhase * 0.12) + 1) * 0.10;
        ctx.globalAlpha = pulse * (this.opacity / 255);
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(
          contentsX + this.cursorRect.x,
          contentsY + this.cursorRect.y,
          this.cursorRect.width,
          this.cursorRect.height
        );
        ctx.globalAlpha = 0.55 * (this.opacity / 255);
        ctx.strokeStyle = "#dbe7ff";
        ctx.strokeRect(
          contentsX + this.cursorRect.x + 0.5,
          contentsY + this.cursorRect.y + 0.5,
          Math.max(0, this.cursorRect.width - 1),
          Math.max(0, this.cursorRect.height - 1)
        );
      }
    }

    ctx.restore();
  }

  override dispose(): void {
    this.contents.dispose();
    super.dispose();
  }
}
