/**
 * WasmMemory.ts - WASM 메모리 헬퍼
 *
 * C 함수와 JS 사이에서 문자열·버퍼를 주고받기 위한 유틸리티.
 * Emscripten 모듈의 HEAPU8/cwrap 등을 래핑한다.
 */

export interface EmscriptenModule {
  HEAPU8: Uint8Array;
  HEAP32: Int32Array;
  _wrgss_alloc: (size: number) => number;
  _wrgss_free: (ptr: number) => void;
  _malloc: (size: number) => number;
  _free: (ptr: number) => void;
  ccall: (
    ident: string,
    returnType: string | null,
    argTypes: string[],
    args: unknown[]
  ) => unknown;
  cwrap: (
    ident: string,
    returnType: string | null,
    argTypes: string[]
  ) => (...args: unknown[]) => unknown;
  UTF8ToString: (ptr: number, maxLength?: number) => string;
  stringToUTF8: (str: string, outPtr: number, maxBytesToWrite: number) => void;
  lengthBytesUTF8: (str: string) => number;
}

export class WasmMemory {
  constructor(private readonly mod: EmscriptenModule) {}

  /** UTF-8 문자열을 WASM 힙에 쓰고 포인터를 반환한다. 사용 후 freeStr로 해제한다. */
  allocStr(str: string): number {
    const len = this.mod.lengthBytesUTF8(str) + 1;
    const ptr = this.mod._malloc(len);
    this.mod.stringToUTF8(str, ptr, len);
    return ptr;
  }

  freeStr(ptr: number): void {
    this.mod._free(ptr);
  }

  /** WASM 힙의 UTF-8 문자열을 JS 문자열로 읽는다. */
  readStr(ptr: number): string {
    return this.mod.UTF8ToString(ptr);
  }

  /** WASM 힙에 바이트 배열을 쓰고 [ptr, len]을 반환한다. */
  allocBytes(data: Uint8Array): [number, number] {
    const ptr = this.mod._malloc(data.length);
    this.mod.HEAPU8.set(data, ptr);
    return [ptr, data.length];
  }

  freeBytes(ptr: number): void {
    this.mod._free(ptr);
  }

  /** WASM 힙에서 바이트 배열을 읽는다. */
  readBytes(ptr: number, len: number): Uint8Array {
    return this.mod.HEAPU8.slice(ptr, ptr + len);
  }

  /** int32 포인터가 가리키는 값을 읽는다. */
  readInt32(ptr: number): number {
    return this.mod.HEAP32[ptr >> 2] ?? 0;
  }

  get heapu8(): Uint8Array {
    return this.mod.HEAPU8;
  }

  get HEAP32(): Int32Array {
    if (this.mod.HEAP32) return this.mod.HEAP32;
    return new Int32Array(this.mod.HEAPU8.buffer);
  }
}
