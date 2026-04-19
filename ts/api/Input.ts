/**
 * Input - RGSS 입력 (키보드/게임패드 매핑)
 */
export const Input = {
  LEFT: 'LEFT',
  UP: 'UP',
  RIGHT: 'RIGHT',
  DOWN: 'DOWN',
  A: 'A',
  B: 'B',
  C: 'C',
  X: 'X',
  Y: 'Y',
  Z: 'Z',
  L: 'L',
  R: 'R',
  SHIFT: 'SHIFT',
  CTRL: 'CTRL',
  ALT: 'ALT',
  F5: 'F5',
  F6: 'F6',
  F7: 'F7',
  F8: 'F8',
  F9: 'F9',
  F12: 'F12',
} as const;

// 키보드 → RGSS 심볼 매핑
const KEY_MAP: Record<string, string> = {
  ArrowLeft: Input.LEFT,
  ArrowUp: Input.UP,
  ArrowRight: Input.RIGHT,
  ArrowDown: Input.DOWN,
  KeyA: Input.A,
  KeyZ: Input.B,
  KeyX: Input.C,
  KeyS: Input.A,
  Enter: Input.C,
  NumpadEnter: Input.C,
  KeyEnter: Input.C,
  Space: Input.C,
  Escape: Input.B,
  Esc: Input.B,
  ShiftLeft: Input.SHIFT,
  ShiftRight: Input.SHIFT,
  ControlLeft: Input.CTRL,
  ControlRight: Input.CTRL,
  AltLeft: Input.ALT,
  AltRight: Input.ALT,
  F5: Input.F5,
  F6: Input.F6,
  F7: Input.F7,
  F8: Input.F8,
  F9: Input.F9,
  F12: Input.F12,
};

const KEY_NAME_MAP: Record<string, string> = {
  Enter: Input.C,
  Escape: Input.B,
  Esc: Input.B,
  " ": Input.C,
  Space: Input.C,
  Spacebar: Input.C,
  F12: Input.F12,
};

const pressed = new Set<string>();
const triggered = new Set<string>();
const queuedTriggered = new Set<string>();
const repeated = new Map<string, number>();

export const InputState = {
  update(): void {
    triggered.clear();
    for (const sym of queuedTriggered) {
      triggered.add(sym);
    }
    queuedTriggered.clear();
  },

  keyDown(sym: string): void {
    if (sym && !pressed.has(sym)) {
      pressed.add(sym);
      queuedTriggered.add(sym);
      repeated.set(sym, 0);
    }
  },

  keyUp(sym: string): void {
    pressed.delete(sym);
    repeated.delete(sym);
  },

  clear(): void {
    pressed.clear();
    triggered.clear();
    queuedTriggered.clear();
    repeated.clear();
  },

  press(sym: string): boolean {
    return pressed.has(sym);
  },

  trigger(sym: string): boolean {
    return triggered.has(sym);
  },

  repeat(sym: string, delay = 24, interval = 6): boolean {
    if (!pressed.has(sym)) return false;
    const count = repeated.get(sym) ?? 0;
    if (count === 0) {
      repeated.set(sym, 1);
      return true;
    }
    const next = count + 1;
    if (next <= delay) {
      repeated.set(sym, next);
      return false;
    }
    if (((next - delay) % Math.max(1, interval)) === 0) {
      repeated.set(sym, next);
      return true;
    }
    repeated.set(sym, next);
    return false;
  },

  dir4(): number {
    if (pressed.has(Input.DOWN)) return 2;
    if (pressed.has(Input.LEFT)) return 4;
    if (pressed.has(Input.RIGHT)) return 6;
    if (pressed.has(Input.UP)) return 8;
    return 0;
  },

  dir8(): number {
    if (pressed.has(Input.DOWN) && pressed.has(Input.LEFT)) return 1;
    if (pressed.has(Input.DOWN) && pressed.has(Input.RIGHT)) return 3;
    if (pressed.has(Input.UP) && pressed.has(Input.LEFT)) return 7;
    if (pressed.has(Input.UP) && pressed.has(Input.RIGHT)) return 9;
    if (pressed.has(Input.DOWN)) return 2;
    if (pressed.has(Input.LEFT)) return 4;
    if (pressed.has(Input.RIGHT)) return 6;
    if (pressed.has(Input.UP)) return 8;
    return 0;
  },
};

export function resolveInputKey(e: KeyboardEvent): string | null {
  return KEY_MAP[e.code] ?? KEY_NAME_MAP[e.key] ?? null;
}
