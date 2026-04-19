/**
 * Rect - RGSS 사각형
 */
export class Rect {
  x: number;
  y: number;
  width: number;
  height: number;

  constructor(x = 0, y = 0, width = 0, height = 0) {
    this.x = x;
    this.y = y;
    this.width = width;
    this.height = height;
  }

  set(arg1: number | Rect, y?: number, width?: number, height?: number): void {
    if (arg1 instanceof Rect) {
      this.x = arg1.x;
      this.y = arg1.y;
      this.width = arg1.width;
      this.height = arg1.height;
    } else if (y !== undefined && width !== undefined && height !== undefined) {
      this.x = arg1;
      this.y = y;
      this.width = width;
      this.height = height;
    } else if (arg1 !== undefined) {
      this.x = arg1;
      this.y = y ?? this.y;
      this.width = width ?? this.width;
      this.height = height ?? this.height;
    }
  }

  empty(): void {
    this.x = this.y = this.width = this.height = 0;
  }
}
