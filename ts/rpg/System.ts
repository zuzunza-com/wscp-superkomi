/**
 * RPG module (subset) for RGSS3 marshal payloads.
 * Ruby Marshal 결과는 인스턴스 변수명이 "@foo" 형태로 남을 수 있어
 * plain object / ivar object 양쪽을 정규화한다.
 */

export interface RPGAudioFile {
  name: string;
  volume: number;
  pitch: number;
}

export interface RPGSystem {
  title1_name: string;
  title2_name: string;
  title_bgm?: RPGAudioFile;
  game_title: string;
  opt_draw_title?: boolean;
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readString(obj: Record<string, unknown> | null, key: string): string {
  if (!obj) return "";
  const direct = obj[key];
  if (typeof direct === "string") return direct;
  const ivar = obj[`@${key}`];
  return typeof ivar === "string" ? ivar : "";
}

function readNumber(obj: Record<string, unknown> | null, key: string, fallback: number): number {
  if (!obj) return fallback;
  const direct = obj[key];
  if (typeof direct === "number" && Number.isFinite(direct)) return direct;
  const ivar = obj[`@${key}`];
  return typeof ivar === "number" && Number.isFinite(ivar) ? ivar : fallback;
}

function readBoolean(obj: Record<string, unknown> | null, key: string, fallback: boolean): boolean {
  if (!obj) return fallback;
  const direct = obj[key];
  if (typeof direct === "boolean") return direct;
  if (typeof direct === "number") return direct !== 0;
  const ivar = obj[`@${key}`];
  if (typeof ivar === "boolean") return ivar;
  if (typeof ivar === "number") return ivar !== 0;
  return fallback;
}

export function normalizeRPGAudioFile(value: unknown): RPGAudioFile | undefined {
  const obj = asObject(value);
  if (!obj) return undefined;
  return {
    name: readString(obj, "name"),
    volume: readNumber(obj, "volume", 100),
    pitch: readNumber(obj, "pitch", 100),
  };
}

export function normalizeRPGSystem(value: unknown): RPGSystem | null {
  const obj = asObject(value);
  if (!obj) return null;

  return {
    title1_name: readString(obj, "title1_name"),
    title2_name: readString(obj, "title2_name"),
    title_bgm: normalizeRPGAudioFile(obj.title_bgm ?? obj["@title_bgm"]),
    game_title: readString(obj, "game_title"),
    // VX Ace usually uses opt_draw_title. Keep opt_display_title as fallback
    // for compatibility with alternate dumps/parsers.
    opt_draw_title:
      ("opt_draw_title" in obj || "@opt_draw_title" in obj)
        ? readBoolean(obj, "opt_draw_title", true)
        : readBoolean(obj, "opt_display_title", true),
  };
}
