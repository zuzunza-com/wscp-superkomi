/**
 * Tone - RGSS 색조 (red, green, blue, gray)
 */
export class Tone {
  red: number;
  green: number;
  blue: number;
  gray: number;

  constructor(red = 0, green = 0, blue = 0, gray = 0) {
    this.red = red;
    this.green = green;
    this.blue = blue;
    this.gray = gray;
  }

  set(arg1: number | Tone, green?: number, blue?: number, gray?: number): void {
    if (arg1 instanceof Tone) {
      this.red = arg1.red;
      this.green = arg1.green;
      this.blue = arg1.blue;
      this.gray = arg1.gray;
    } else if (green !== undefined && blue !== undefined && gray !== undefined) {
      this.red = arg1;
      this.green = green;
      this.blue = blue;
      this.gray = gray;
    } else {
      this.red = arg1;
      this.green = green ?? this.green;
      this.blue = blue ?? this.blue;
      this.gray = gray ?? this.gray;
    }
  }
}
