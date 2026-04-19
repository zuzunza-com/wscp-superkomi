/**
 * RGSS msgbox 메시지에서 [RGSS Script Error] [index] title 패턴 파싱.
 * Traceback 개선 시 WasmRgssRuntime에서 주입하는 헤더 형식.
 */
const RGSS_SCRIPT_ERROR_RE = /\[RGSS Script Error\]\s*\[(\d+)\]\s*(.+?)(?:\n|$)/;

export function parseRgssScriptError(msg: string): { index: number; title: string } | null {
  const m = msg.match(RGSS_SCRIPT_ERROR_RE);
  if (!m) return null;
  return { index: Number(m[1]), title: m[2].trim() };
}
