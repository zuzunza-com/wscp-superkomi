/**
 * 전역 부팅 락 — 동시에 하나의 WasmRgssRuntime.boot()만 실행되도록 보장.
 * HMR/StrictMode 등으로 중복 기동 시 Fiber·FS 충돌 방지.
 */
let bootLock: Promise<void> = Promise.resolve();

export async function acquireBootLock(): Promise<() => void> {
  const prev = bootLock;
  let release!: () => void;
  bootLock = new Promise<void>((resolve) => {
    release = resolve;
  });
  await prev;
  return release;
}
