/**
 * Ruby Marshal decoder for RGSS/RPG Maker rvdata2.
 *
 * Goals:
 * - Preserve class/object instance variables (unlike @qnighy/marshal)
 * - Preserve raw bytes for String/user-defined dumps when needed
 * - Decode common RGSS user-defined objects (Table/Color/Tone/Rect) heuristically
 *
 * It is not a complete MRI Marshal implementation, but covers tags typically
 * observed in RGSS1/2/3 data files and keeps unknown data in inspectable form.
 */

export class RubyMarshalDecodeError extends Error {}

const META = {
  rubyClass: "__ruby_class",
  rubyType: "__ruby_type",
  rubyIvars: "__ruby_ivars",
  rubyExtends: "__ruby_extends",
  rubyDumpHex: "__ruby_dump_hex",
  rubyDumpBytes: "__ruby_dump_bytes",
} as const;

class RubyString {
  readonly bytes: Uint8Array;
  ivars: Record<string, unknown> | null = null;
  className: string | null = null;

  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
  }

  toUtf8String(): string {
    return new TextDecoder("utf-8", { fatal: false }).decode(this.bytes);
  }
}

class RubyRegex {
  readonly source: RubyString;
  readonly flags: number;
  ivars: Record<string, unknown> | null = null;
  className: string | null = null;

  constructor(source: RubyString, flags: number) {
    this.source = source;
    this.flags = flags;
  }
}

class RubyObject {
  readonly className: string;
  ivars: Record<string, unknown>;
  extendsModules: string[] | null = null;

  constructor(className: string) {
    this.className = className;
    this.ivars = {};
  }
}

class RubyStruct {
  readonly className: string;
  members: Record<string, unknown>;
  extendsModules: string[] | null = null;

  constructor(className: string) {
    this.className = className;
    this.members = {};
  }
}

class RubyUserDump {
  readonly className: string;
  readonly data: Uint8Array;
  extendsModules: string[] | null = null;

  constructor(className: string, data: Uint8Array) {
    this.className = className;
    this.data = data;
  }
}

class RubyMarshalDump {
  readonly className: string;
  payload: unknown;
  extendsModules: string[] | null = null;

  constructor(className: string, payload: unknown) {
    this.className = className;
    this.payload = payload;
  }
}

type RubyRichValue =
  | null
  | boolean
  | number
  | string // Symbols/class names are normalized as strings
  | RubyString
  | RubyRegex
  | RubyObject
  | RubyStruct
  | RubyUserDump
  | RubyMarshalDump
  | unknown[]
  | Record<string, unknown>;

function isObjectLike(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object";
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function sanitizeIvarKey(key: string): string {
  return key.startsWith("@") ? key.slice(1) : key;
}

function readI32LE(data: Uint8Array, offset: number): number {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return dv.getInt32(offset, true);
}

function readF64LE(data: Uint8Array, offset: number): number {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return dv.getFloat64(offset, true);
}

function decodeRgssUserDump(className: string, dump: Uint8Array): Record<string, unknown> | null {
  const cls = className.toLowerCase();

  if (cls === "table" && dump.byteLength >= 20) {
    try {
      const dimensions = readI32LE(dump, 0);
      const xsize = readI32LE(dump, 4);
      const ysize = readI32LE(dump, 8);
      const zsize = readI32LE(dump, 12);
      const size = readI32LE(dump, 16);
      const expectedBytes = 20 + Math.max(0, size) * 2;
      const values: number[] = [];
      if (dump.byteLength >= expectedBytes) {
        const dv = new DataView(dump.buffer, dump.byteOffset, dump.byteLength);
        for (let i = 0; i < size; i++) {
          values.push(dv.getInt16(20 + i * 2, true));
        }
      }
      return {
        [META.rubyType]: "rgss_table",
        [META.rubyClass]: className,
        dimensions,
        xsize,
        ysize,
        zsize,
        size,
        values,
      };
    } catch {
      return null;
    }
  }

  if ((cls === "color" || cls === "tone") && dump.byteLength >= 32) {
    try {
      return {
        [META.rubyType]: cls === "color" ? "rgss_color" : "rgss_tone",
        [META.rubyClass]: className,
        x: readF64LE(dump, 0),
        y: readF64LE(dump, 8),
        z: readF64LE(dump, 16),
        w: readF64LE(dump, 24),
      };
    } catch {
      return null;
    }
  }

  if (cls === "rect" && dump.byteLength >= 16) {
    try {
      return {
        [META.rubyType]: "rgss_rect",
        [META.rubyClass]: className,
        x: readI32LE(dump, 0),
        y: readI32LE(dump, 4),
        width: readI32LE(dump, 8),
        height: readI32LE(dump, 12),
      };
    } catch {
      return null;
    }
  }

  return null;
}

export interface RubyMarshalDecodeOptions {
  preserveStringObjects?: boolean;
}

class Parser {
  private symbols: string[] = [];
  private objects: RubyRichValue[] = [];

  constructor(private readonly buf: Uint8Array, private index = 0) {}

  read(): RubyRichValue {
    this.symbols = [];
    this.objects = [];
    const major = this.readByte();
    const minor = this.readByte();
    if (major !== 4 || minor > 8) {
      throw new RubyMarshalDecodeError(
        `incompatible marshal format: expected 4.8, got ${major}.${minor}`
      );
    }
    return this.readAny();
  }

  private readAny(): RubyRichValue {
    const tag = this.readByte();
    switch (tag) {
      case 0x30: // nil
        return null;
      case 0x54: // true
        return true;
      case 0x46: // false
        return false;
      case 0x69: // fixnum
        return this.readInt();
      case 0x6c: // bignum
        return this.entry(this.readBignumAsNumber());
      case 0x66: // float
        return this.entry(this.readFloat());
      case 0x3a: { // symbol
        const sym = this.readByteString().toUtf8String();
        this.symbols.push(sym);
        return sym;
      }
      case 0x3b: { // symlink
        const idx = this.readInt();
        if (idx < 0 || idx >= this.symbols.length) {
          throw new RubyMarshalDecodeError("bad symbol link");
        }
        return this.symbols[idx];
      }
      case 0x40: { // object link
        const idx = this.readInt();
        if (idx < 0 || idx >= this.objects.length) {
          throw new RubyMarshalDecodeError("bad object link");
        }
        return this.objects[idx];
      }
      case 0x22: // string
        return this.entry(this.readByteString());
      case 0x2f: { // regexp
        const src = this.readByteString();
        const flags = this.readByte();
        return this.entry(new RubyRegex(src, flags));
      }
      case 0x5b: { // array
        const len = this.readLength("array");
        const arr = this.entry([] as unknown[]);
        for (let i = 0; i < len; i++) arr.push(this.readAny());
        return arr;
      }
      case 0x7b: // hash
      case 0x7d: {
        const len = this.readLength("hash");
        const obj = this.entry({} as Record<string, unknown>);
        for (let i = 0; i < len; i++) {
          const k = this.readAny();
          const v = this.readAny();
          if (typeof k === "string" || typeof k === "number") {
            obj[String(k)] = v;
          } else {
            const pairs = (obj.__ruby_pairs as Array<[unknown, unknown]> | undefined) ?? [];
            pairs.push([k, v]);
            obj.__ruby_pairs = pairs;
          }
        }
        if (tag === 0x7d) {
          obj.__ruby_default = this.readAny();
        }
        return obj;
      }
      case 0x53: { // struct
        const className = this.readClassName();
        const len = this.readLength("struct");
        const s = this.entry(new RubyStruct(className));
        for (let i = 0; i < len; i++) {
          const k = this.readAny();
          const v = this.readAny();
          if (typeof k === "string") {
            s.members[sanitizeIvarKey(k)] = v;
          }
        }
        return s;
      }
      case 0x6f: { // object
        const className = this.readClassName();
        const len = this.readLength("object ivars");
        const o = this.entry(new RubyObject(className));
        for (let i = 0; i < len; i++) {
          const k = this.readAny();
          const v = this.readAny();
          if (typeof k === "string") {
            o.ivars[sanitizeIvarKey(k)] = v;
          }
        }
        return o;
      }
      case 0x49: { // IVAR wrapper
        const base = this.readAny();
        const len = this.readLength("ivar");
        const ivars: Record<string, unknown> = {};
        for (let i = 0; i < len; i++) {
          const k = this.readAny();
          const v = this.readAny();
          if (typeof k === "string") ivars[sanitizeIvarKey(k)] = v;
        }
        this.attachIvars(base, ivars);
        return base;
      }
      case 0x43: { // user class wrapper for core object
        const className = this.readClassName();
        const obj = this.readAny();
        this.attachClassName(obj, className);
        return obj;
      }
      case 0x63: { // class
        return this.entry({ [META.rubyType]: "class", name: this.readByteString().toUtf8String() });
      }
      case 0x6d: { // module
        return this.entry({ [META.rubyType]: "module", name: this.readByteString().toUtf8String() });
      }
      case 0x4d: { // old module/class
        return this.entry({ [META.rubyType]: "module_old", name: this.readByteString().toUtf8String() });
      }
      case 0x65: { // extended
        const modName = this.readClassName();
        const obj = this.readAny();
        this.attachExtension(obj, modName);
        return obj;
      }
      case 0x55: { // marshal_dump
        const className = this.readClassName();
        const payload = this.readAny();
        return this.entry(new RubyMarshalDump(className, payload));
      }
      case 0x75: { // _dump old custom
        const className = this.readClassName();
        const dump = this.readBytes();
        return this.entry(new RubyUserDump(className, dump));
      }
      case 0x64: { // TYPE_DATA (best-effort)
        const className = this.readClassName();
        const payload = this.readAny();
        return this.entry({
          [META.rubyType]: "data",
          [META.rubyClass]: className,
          payload,
        });
      }
      default:
        throw new RubyMarshalDecodeError(`unsupported marshal tag 0x${tag.toString(16)}`);
    }
  }

  private attachIvars(base: RubyRichValue, ivars: Record<string, unknown>): void {
    if (base instanceof RubyString || base instanceof RubyRegex) {
      base.ivars = { ...(base.ivars ?? {}), ...ivars };
      return;
    }
    if (base instanceof RubyObject || base instanceof RubyStruct) {
      if (base instanceof RubyObject) {
        base.ivars = { ...base.ivars, ...ivars };
      } else {
        base.members = { ...base.members, ...ivars };
      }
      return;
    }
    if (isObjectLike(base)) {
      const prev = (base[META.rubyIvars] as Record<string, unknown> | undefined) ?? {};
      Object.defineProperty(base, META.rubyIvars, {
        value: { ...prev, ...ivars },
        enumerable: false,
        configurable: true,
        writable: true,
      });
    }
  }

  private attachClassName(base: RubyRichValue, className: string): void {
    if (base instanceof RubyString || base instanceof RubyRegex) {
      base.className = className;
      return;
    }
    if (base instanceof RubyObject || base instanceof RubyStruct) {
      return;
    }
    if (isObjectLike(base)) {
      Object.defineProperty(base, META.rubyClass, {
        value: className,
        enumerable: false,
        configurable: true,
        writable: true,
      });
    }
  }

  private attachExtension(base: RubyRichValue, modName: string): void {
    const push = (arr: string[] | null | undefined): string[] => {
      const out = arr ? [...arr] : [];
      out.push(modName);
      return out;
    };

    if (base instanceof RubyObject || base instanceof RubyStruct || base instanceof RubyUserDump || base instanceof RubyMarshalDump) {
      base.extendsModules = push(base.extendsModules);
      return;
    }
    if (isObjectLike(base)) {
      const prev = ((base as Record<string, unknown>)[META.rubyExtends] as string[] | undefined) ?? [];
      Object.defineProperty(base, META.rubyExtends, {
        value: [...prev, modName],
        enumerable: false,
        configurable: true,
        writable: true,
      });
    }
  }

  private readClassName(): string {
    const v = this.readAny();
    if (typeof v === "string") return v;
    if (v instanceof RubyString) return v.toUtf8String();
    throw new RubyMarshalDecodeError("expected class/module name string");
  }

  private readFloat(): number {
    const s = this.readByteString().toUtf8String();
    if (s === "inf") return Infinity;
    if (s === "-inf") return -Infinity;
    if (s === "nan") return NaN;
    return parseFloat(s);
  }

  private readBignumAsNumber(): number {
    const sign = this.readByte();
    const words = this.readLength("bignum");
    const byteLen = words * 2;
    let sum = 0;
    let mag = 1;
    for (let i = 0; i < byteLen; i++) {
      sum += this.readByte() * mag;
      mag *= 256;
    }
    return sign === 0x2d ? -sum : sum;
  }

  private readByteString(): RubyString {
    return new RubyString(this.readBytes());
  }

  private readBytes(): Uint8Array {
    const len = this.readLength("string");
    if (this.index + len > this.buf.byteLength) {
      throw new RubyMarshalDecodeError("marshal data too short");
    }
    const out = this.buf.subarray(this.index, this.index + len);
    this.index += len;
    return out;
  }

  private readLength(msg: string): number {
    const n = this.readInt();
    if (n < 0) throw new RubyMarshalDecodeError(`negative ${msg} size`);
    return n;
  }

  private readInt(): number {
    const tag = this.readByte();
    if (tag === 0) return 0;
    if (tag >= 5 && tag < 128) return tag - 5;
    if (tag >= 128 && tag <= 251) return tag - 251;

    const len = tag < 128 ? tag : 256 - tag;
    let sum = 0;
    let mag = 1;
    for (let i = 0; i < len; i++) {
      sum += mag * this.readByte();
      mag *= 256;
    }
    if (tag >= 128) sum -= mag;
    return sum;
  }

  private readByte(): number {
    if (this.index >= this.buf.byteLength) {
      throw new RubyMarshalDecodeError("marshal data too short");
    }
    return this.buf[this.index++];
  }

  private entry<T extends RubyRichValue>(obj: T): T {
    this.objects.push(obj);
    return obj;
  }
}

export function parseRubyMarshalRich(data: Uint8Array): unknown {
  return new Parser(data).read();
}

function materialize(value: unknown, seen = new Map<object, unknown>()): unknown {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (value instanceof RubyString) {
    // Most RGSS strings are wrapped with encoding ivars (`I` tag + :E),
    // but callers expect plain strings (e.g. System.title1_name).
    return value.toUtf8String();
  }

  if (value instanceof RubyRegex) {
    const obj: Record<string, unknown> = {
      source: value.source.toUtf8String(),
      flags: value.flags,
      [META.rubyType]: "regexp",
    };
    if (value.className) obj[META.rubyClass] = value.className;
    if (value.ivars) obj[META.rubyIvars] = materialize(value.ivars, seen);
    return obj;
  }

  if (value instanceof RubyUserDump) {
    const known = decodeRgssUserDump(value.className, value.data);
    if (known) {
      if (value.extendsModules?.length) known[META.rubyExtends] = [...value.extendsModules];
      return known;
    }
    return {
      [META.rubyType]: "userdump",
      [META.rubyClass]: value.className,
      ...(value.extendsModules?.length ? { [META.rubyExtends]: [...value.extendsModules] } : {}),
      [META.rubyDumpHex]: bytesToHex(value.data),
      [META.rubyDumpBytes]: value.data,
    };
  }

  if (value instanceof RubyMarshalDump) {
    return {
      [META.rubyType]: "marshaldump",
      [META.rubyClass]: value.className,
      ...(value.extendsModules?.length ? { [META.rubyExtends]: [...value.extendsModules] } : {}),
      payload: materialize(value.payload, seen),
    };
  }

  if (value instanceof RubyObject) {
    const out: Record<string, unknown> = {
      [META.rubyType]: "object",
      [META.rubyClass]: value.className,
    };
    if (seen.has(value)) return seen.get(value);
    seen.set(value, out);
    for (const [k, v] of Object.entries(value.ivars)) {
      out[k] = materialize(v, seen);
    }
    if (value.extendsModules?.length) out[META.rubyExtends] = [...value.extendsModules];
    return out;
  }

  if (value instanceof RubyStruct) {
    const out: Record<string, unknown> = {
      [META.rubyType]: "struct",
      [META.rubyClass]: value.className,
    };
    if (seen.has(value)) return seen.get(value);
    seen.set(value, out);
    for (const [k, v] of Object.entries(value.members)) {
      out[k] = materialize(v, seen);
    }
    if (value.extendsModules?.length) out[META.rubyExtends] = [...value.extendsModules];
    return out;
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) return seen.get(value);
    const arr: unknown[] = [];
    seen.set(value, arr);
    for (const item of value) arr.push(materialize(item, seen));
    const ivars = (value as unknown as Record<string, unknown>)[META.rubyIvars];
    if (ivars) {
      Object.defineProperty(arr, META.rubyIvars, {
        value: materialize(ivars, seen),
        enumerable: false,
      });
    }
    return arr;
  }

  if (isObjectLike(value)) {
    if (seen.has(value)) return seen.get(value);
    const out: Record<string, unknown> = {};
    seen.set(value, out);
    for (const [k, v] of Object.entries(value)) {
      out[k] = materialize(v, seen);
    }
    const rubyClass = (value as Record<string, unknown>)[META.rubyClass];
    const rubyIvars = (value as Record<string, unknown>)[META.rubyIvars];
    const rubyExtends = (value as Record<string, unknown>)[META.rubyExtends];
    if (rubyClass !== undefined) out[META.rubyClass] = rubyClass;
    if (rubyIvars !== undefined) out[META.rubyIvars] = materialize(rubyIvars, seen);
    if (rubyExtends !== undefined) out[META.rubyExtends] = materialize(rubyExtends, seen);
    return out;
  }

  return value;
}

export function decodeRubyMarshalToJs<T = unknown>(data: Uint8Array): T {
  return materialize(parseRubyMarshalRich(data)) as T;
}

function richStringToBytes(value: unknown): Uint8Array {
  if (value instanceof RubyString) return value.bytes;
  if (value instanceof Uint8Array) return value;
  if (typeof value === "string") {
    // Fallback latin1 conversion for compatibility
    const arr = new Uint8Array(value.length);
    for (let i = 0; i < value.length; i++) arr[i] = value.charCodeAt(i) & 0xff;
    return arr;
  }
  return new Uint8Array(0);
}

function richStringToText(value: unknown): string {
  if (value instanceof RubyString) return value.toUtf8String();
  return String(value ?? "");
}

export function decodeRgssScriptsFromMarshal(data: Uint8Array): Array<{ sectionId: number; title: string; compressed: Uint8Array }> {
  const root = parseRubyMarshalRich(data);
  if (!Array.isArray(root)) {
    throw new Error("Scripts.rvdata2: expected Array");
  }

  const out: Array<{ sectionId: number; title: string; compressed: Uint8Array }> = [];
  for (let i = 0; i < root.length; i++) {
    const entry = root[i];
    if (!Array.isArray(entry) || entry.length < 2) continue;

    if (entry.length >= 3) {
      out.push({
        sectionId: Number(entry[0]) || 0,
        title: richStringToText(entry[1]),
        compressed: richStringToBytes(entry[2]),
      });
    } else {
      out.push({
        sectionId: i,
        title: richStringToText(entry[0]),
        compressed: richStringToBytes(entry[1]),
      });
    }
  }
  return out;
}
