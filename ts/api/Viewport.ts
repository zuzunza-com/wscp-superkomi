/**
 * Viewport - RGSS 뷰포트 (화면 영역 클리핑)
 */
import { Rect } from './Rect';
import { Color } from './Color';
import { Tone } from './Tone';
import { Graphics } from './Graphics';

export class Viewport {
  rect: Rect;
  visible: boolean;
  z: number;
  ox: number;
  oy: number;
  color: Color;
  tone: Tone;
  private _disposed = false;

  constructor(x?: number, y?: number, width?: number, height?: number);
  constructor(rect?: Rect);
  constructor(
    arg1?: number | Rect,
    y?: number,
    width?: number,
    height?: number
  ) {
    if (arg1 instanceof Rect) {
      this.rect = new Rect(arg1.x, arg1.y, arg1.width, arg1.height);
    } else {
      const hasExplicitRect =
        typeof arg1 === 'number' ||
        typeof y === 'number' ||
        typeof width === 'number' ||
        typeof height === 'number';
      this.rect = hasExplicitRect
        ? new Rect(arg1 ?? 0, y ?? 0, width ?? 0, height ?? 0)
        : new Rect(0, 0, Graphics.width, Graphics.height);
    }
    this.visible = true;
    this.z = 0;
    this.ox = 0;
    this.oy = 0;
    this.color = new Color(0, 0, 0, 0);
    this.tone = new Tone(0, 0, 0, 0);
  }

  dispose(): void {
    this._disposed = true;
  }

  get disposed(): boolean {
    return this._disposed;
  }

  flash(_color: Color | null, _duration: number): void {
    // 플래시 효과 (미구현)
  }

  update(): void {
    // 효과 업데이트
  }
}
