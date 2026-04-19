/**
 * Graphics - RGSS 그래픽 시스템
 *
 * 트랜지션 구현:
 *   Graphics.freeze()  → 현재 화면을 _frozenSnap에 저장, 이후 렌더링이 새 씬을 _liveCanvas에 쌓음
 *   Graphics.transition(duration, filename, vague)
 *                      → duration 프레임 동안 frozen → live 알파 크로스페이드
 *                        filename이 있으면 마스크 이미지를 사용 (vague = 소프트 에지)
 */
import type { Bitmap } from './Bitmap';

export interface GraphicsConfig {
  width?: number;
  height?: number;
  frameRate?: number;
}

const DEFAULT_WIDTH = 544;
const DEFAULT_HEIGHT = 416;
const DEFAULT_FRAME_RATE = 60;

export type TransitionState = 'idle' | 'frozen' | 'transitioning';

class GraphicsImpl {
  private _width = DEFAULT_WIDTH;
  private _height = DEFAULT_HEIGHT;
  private _frameRate = DEFAULT_FRAME_RATE;
  private _frameCount = 0;
  private _brightness = 255;
  private _canvas: HTMLCanvasElement | null = null;

  /** fade 애니메이션 */
  private _fadeStartBrightness = 255;
  private _fadeTargetBrightness = 255;
  private _fadeDuration = 0;
  private _fadeElapsed = 0;

  /** 트랜지션 상태 */
  private _transitionState: TransitionState = 'idle';
  /** freeze 시점의 화면 스냅샷 */
  private _frozenSnap: HTMLCanvasElement | null = null;
  /** 트랜지션 진행도 (0~1) */
  private _transitionT = 0;
  /** 트랜지션 총 프레임 */
  private _transitionDuration = 0;
  /** 트랜지션 경과 프레임 */
  private _transitionElapsed = 0;
  /** 트랜지션 마스크 이미지 (선택) */
  private _transitionMask: HTMLImageElement | null = null;
  /** mask의 vague (소프트 에지 픽셀폭) */
  private _transitionVague = 40;

  /** 외부 렌더러가 트랜지션 합성을 수행하기 위한 접근자 */
  get transitionState(): TransitionState { return this._transitionState; }
  get transitionT(): number { return this._transitionT; }
  get frozenSnap(): HTMLCanvasElement | null { return this._frozenSnap; }
  get transitionMask(): HTMLImageElement | null { return this._transitionMask; }
  get transitionVague(): number { return this._transitionVague; }

  get width(): number { return this._width; }
  get height(): number { return this._height; }

  get frameRate(): number { return this._frameRate; }
  set frameRate(v: number) { this._frameRate = Math.max(1, Math.min(120, v)); }

  get frameCount(): number { return this._frameCount; }

  get brightness(): number { return this._brightness; }
  set brightness(v: number) { this._brightness = Math.max(0, Math.min(255, v)); }

  setCanvas(canvas: HTMLCanvasElement | null): void {
    this._canvas = canvas;
    if (canvas) {
      this._width = canvas.width;
      this._height = canvas.height;
    }
  }

  getCanvas(): HTMLCanvasElement | null { return this._canvas; }

  resizeScreen(width: number, height: number): void {
    this._width = width;
    this._height = height;
    if (this._canvas) {
      this._canvas.width = width;
      this._canvas.height = height;
    }
  }

  update(): void {
    this._frameCount++;

    // fade
    if (this._fadeDuration > 0) {
      this._fadeElapsed += 1;
      const t = Math.min(1, this._fadeElapsed / this._fadeDuration);
      const next = Math.round(
        this._fadeStartBrightness +
          (this._fadeTargetBrightness - this._fadeStartBrightness) * t
      );
      this._brightness = Math.max(0, Math.min(255, next));
      if (t >= 1) {
        this._fadeDuration = 0;
        this._fadeElapsed = 0;
        this._fadeStartBrightness = this._brightness;
      }
    }

    // transition
    if (this._transitionState === 'transitioning') {
      this._transitionElapsed++;
      this._transitionT = Math.min(1, this._transitionElapsed / this._transitionDuration);
      if (this._transitionT >= 1) {
        this._transitionState = 'idle';
        this._frozenSnap = null;
        this._transitionMask = null;
      }
    }
  }

  frameReset(): void { this._frameCount = 0; }

  async wait(duration: number): Promise<void> {
    await new Promise((r) => setTimeout(r, duration));
  }

  fadeout(duration: number): void { this.startFade(0, duration); }
  fadein(duration: number): void { this.startFade(255, duration); }

  private startFade(targetBrightness: number, duration: number): void {
    const d = Math.max(0, Math.floor(duration));
    this._fadeStartBrightness = this._brightness;
    this._fadeTargetBrightness = Math.max(0, Math.min(255, targetBrightness));
    if (d <= 0) {
      this._brightness = this._fadeTargetBrightness;
      this._fadeDuration = 0;
      this._fadeElapsed = 0;
      return;
    }
    this._fadeDuration = d;
    this._fadeElapsed = 0;
  }

  /**
   * 현재 렌더링 결과를 스냅샷으로 저장.
   * 이후 렌더러는 새 씬을 일반적으로 렌더하면서,
   * transition() 호출 전까지 스냅샷을 오버레이로 유지.
   */
  freeze(): void {
    if (this._transitionState !== 'idle') return;
    const src = this._canvas;
    if (!src || src.width <= 0 || src.height <= 0) {
      this._transitionState = 'frozen';
      return;
    }
    const snap = document.createElement('canvas');
    snap.width = src.width;
    snap.height = src.height;
    const snapCtx = snap.getContext('2d');
    if (snapCtx) snapCtx.drawImage(src, 0, 0);
    this._frozenSnap = snap;
    this._transitionState = 'frozen';
  }

  /**
   * freeze 이후 새 씬으로 크로스페이드 시작.
   * @param duration 총 프레임 수 (0 = 즉시)
   * @param filename 마스크 이미지 경로 (선택, 미지원 시 단순 알파 페이드)
   * @param vague 마스크 소프트 에지 픽셀 폭 (기본 40)
   */
  transition(duration = 10, filename?: string, vague = 40): void {
    if (this._transitionState === 'idle') return;

    if (!this._frozenSnap || duration <= 0) {
      this._transitionState = 'idle';
      this._frozenSnap = null;
      this._transitionMask = null;
      return;
    }

    this._transitionDuration = Math.max(1, duration);
    this._transitionElapsed = 0;
    this._transitionT = 0;
    this._transitionVague = vague;
    this._transitionState = 'transitioning';

    if (filename) {
      const img = new Image();
      img.src = filename;
      img.onload = () => { this._transitionMask = img; };
    }
  }

  get isFrozen(): boolean {
    return this._transitionState === 'frozen';
  }

  snapToBitmap(): Bitmap {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Bitmap: B } = require('./Bitmap');
    const bmp = new B(this._width, this._height);
    if (this._canvas && this._width > 0 && this._height > 0) {
      bmp.context.drawImage(this._canvas, 0, 0);
    }
    return bmp;
  }
}

export const Graphics = new GraphicsImpl();
