/**
 * Font - RGSS 폰트
 */
export class Font {
  name: string;
  size: number;
  bold: boolean;
  italic: boolean;
  outline: boolean;
  shadow: boolean;
  color: { red: number; green: number; blue: number; alpha: number } | null;
  outColor: { red: number; green: number; blue: number; alpha: number } | null;

  static defaultName = '"Nanum Gothic", "NanumGothic", "Malgun Gothic", sans-serif';
  static defaultSize = 24;
  static defaultBold = false;
  static defaultItalic = false;
  static defaultShadow = true;
  static defaultOutline = true;
  static defaultColor: { red: number; green: number; blue: number; alpha: number } | null = null;
  static defaultOutColor: { red: number; green: number; blue: number; alpha: number } | null = null;
  private static defaultFontLoadStarted = false;

  constructor(name?: string | null, size?: number | null) {
    this.name = name ?? Font.defaultName;
    this.size = size ?? Font.defaultSize;
    this.bold = Font.defaultBold;
    this.italic = Font.defaultItalic;
    this.outline = Font.defaultOutline;
    this.shadow = Font.defaultShadow;
    this.color = Font.defaultColor;
    this.outColor = Font.defaultOutColor;
  }

  toCss(): string {
    const parts: string[] = [];
    if (this.italic) parts.push('italic');
    if (this.bold) parts.push('bold');
    parts.push(`${this.size}px`);
    parts.push(this.name || 'sans-serif');
    return parts.join(' ');
  }

  static ensureDefaultFontLoaded(): void {
    if (typeof document === 'undefined' || Font.defaultFontLoadStarted) return;
    Font.defaultFontLoadStarted = true;

    const linkId = 'webrgss-font-nanum-gothic';
    if (document.getElementById(linkId)) return;

    const link = document.createElement('link');
    link.id = linkId;
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=Nanum+Gothic:wght@400;700;800&display=swap';
    document.head.appendChild(link);
  }
}
