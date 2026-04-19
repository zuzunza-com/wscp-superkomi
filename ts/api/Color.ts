/**
 * Color - RGSS 색상 (red, green, blue, alpha)
 */
export class Color {
  red: number;
  green: number;
  blue: number;
  alpha: number;

  constructor(red = 0, green = 0, blue = 0, alpha = 255) {
    this.red = red;
    this.green = green;
    this.blue = blue;
    this.alpha = alpha;
  }

  set(arg1: number | Color, green?: number, blue?: number, alpha = 255): void {
    if (arg1 instanceof Color) {
      this.red = arg1.red;
      this.green = arg1.green;
      this.blue = arg1.blue;
      this.alpha = arg1.alpha;
    } else if (green !== undefined && blue !== undefined) {
      this.red = arg1;
      this.green = green;
      this.blue = blue;
      this.alpha = alpha;
    } else {
      this.red = arg1;
      this.green = green ?? this.green;
      this.blue = blue ?? this.blue;
      this.alpha = alpha;
    }
  }

  toCss(): string {
    return `rgba(${this.red},${this.green},${this.blue},${this.alpha / 255})`;
  }
}
