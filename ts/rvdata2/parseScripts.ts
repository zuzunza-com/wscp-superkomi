/**
 * Scripts.rvdata2 파서
 * RPG Maker VX Ace / XP의 Scripts.rvdata2 (Marshal + Zlib) 파싱
 * 참조: https://github.com/biud436/vscode-rgss-script-compiler (RGSS3/plugins/rxscript.rb)
 */
import { inflateSync, unzlibSync } from 'fflate';
import { Marshal } from '@qnighy/marshal';
import { decodeRgssScriptsFromMarshal } from './ruby-marshal-rgss';
import type { RgssTranspileDiagnostic } from '../types/diagnostics';

export interface RgssScript {
  /** 스크립트 인덱스 (0-based) */
  index: number;
  /** 섹션 ID (내부 식별자) */
  sectionId: number;
  /** 스크립트 제목 */
  title: string;
  /** 압축 해제된 Ruby 소스 코드 */
  code: string;
}

/** 디코딩 상세 결과 (내부용 확장 API) */
export interface ParseScriptsDetailedResult {
  scripts: RgssScript[];
  decodeDiagnostics: RgssTranspileDiagnostic[];
  /** 디코딩 성공 비율 (0.0~1.0) */
  decodeSuccessRatio: number;
  /** 바이너리 가비지로 판정된 스크립트 수 */
  likelyBinaryCount: number;
  /** 전체 스크립트 수 */
  totalScripts: number;
}

/** 텍스트 품질 분석 결과 */
export interface TextQualityResult {
  printableRatio: number;
  replacementCharCount: number;
  nullCount: number;
  controlCharCount: number;
  likelyBinary: boolean;
}

/**
 * 문자열이 사람이 읽을 수 있는 Ruby 코드인지 휴리스틱으로 판정.
 * 바이너리 가비지 (디코딩 실패 fallback)를 걸러내는 용도.
 */
export function isLikelyRubyText(code: string): boolean {
  return !analyzeTextQuality(code).likelyBinary;
}

/**
 * 텍스트 품질 상세 분석.
 * 샘플 범위: 첫 2048자 (빈 코드는 binary가 아니라 empty로 취급).
 */
export function analyzeTextQuality(code: string): TextQualityResult {
  if (code.length === 0) {
    return { printableRatio: 1, replacementCharCount: 0, nullCount: 0, controlCharCount: 0, likelyBinary: false };
  }

  const sample = code.slice(0, 2048);
  const len = sample.length;
  let printable = 0;
  let replacementCharCount = 0;
  let nullCount = 0;
  let controlCharCount = 0;

  for (let i = 0; i < len; i++) {
    const ch = sample.charCodeAt(i);
    if (ch === 0xfffd) {
      replacementCharCount++;
    } else if (ch === 0) {
      nullCount++;
    } else if (ch < 0x20 && ch !== 0x09 && ch !== 0x0a && ch !== 0x0d) {
      // 제어문자 (tab, newline, CR 제외)
      controlCharCount++;
    } else {
      printable++;
    }
  }

  const printableRatio = printable / len;
  const nonPrintableRatio = 1 - printableRatio;

  const likelyBinary =
    nonPrintableRatio > 0.15 ||
    replacementCharCount > 0 ||
    nullCount > 0;

  return { printableRatio, replacementCharCount, nullCount, controlCharCount, likelyBinary };
}

function stringToBytes(str: unknown): Uint8Array {
  if (str instanceof Uint8Array) return str;
  if (typeof str === 'string') {
    const arr = new Uint8Array(str.length);
    for (let i = 0; i < str.length; i++) {
      arr[i] = str.charCodeAt(i) & 0xff;
    }
    return arr;
  }
  return new Uint8Array(0);
}

function parseScriptsRvdata2Legacy(data: Uint8Array): Array<{ sectionId: number; title: string; compressed: Uint8Array }> {
  const parsed = Marshal.parse(data) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error('Scripts.rvdata2: expected Array');
  }

  const out: Array<{ sectionId: number; title: string; compressed: Uint8Array }> = [];
  for (let i = 0; i < parsed.length; i++) {
    const entry = parsed[i];
    if (!Array.isArray(entry) || entry.length < 2) continue;
    if (entry.length >= 3) {
      out.push({
        sectionId: Number(entry[0]) || 0,
        title: String(entry[1] ?? ''),
        compressed: stringToBytes(entry[2]),
      });
    } else {
      out.push({
        sectionId: i,
        title: String(entry[0] ?? ''),
        compressed: stringToBytes(entry[1]),
      });
    }
  }
  return out;
}

/**
 * 압축된 바이트를 해제하는 데 3단계 fallback을 사용:
 *  1. unzlibSync (zlib wrapper — Ruby Zlib::Deflate 기본 출력)
 *  2. inflateSync (raw deflate — zlib header 없는 데이터)
 *  3. raw bytes → TextDecoder (이미 압축 해제된 경우)
 *
 * 반환: { code, method, error? }
 */
function decompressScriptBytes(
  compressed: Uint8Array,
): { code: string; method: 'unzlib' | 'inflate' | 'raw'; error?: string } {
  // 1. unzlibSync: zlib wrapper 포함 데이터 (가장 일반적)
  try {
    const decompressed = unzlibSync(compressed);
    return { code: new TextDecoder('utf-8', { fatal: false }).decode(decompressed), method: 'unzlib' };
  } catch {
    // zlib header 불일치 — raw deflate 시도
  }

  // 2. inflateSync: raw deflate (zlib wrapper 없는 데이터)
  try {
    const decompressed = inflateSync(compressed);
    return { code: new TextDecoder('utf-8', { fatal: false }).decode(decompressed), method: 'inflate' };
  } catch {
    // raw deflate도 실패
  }

  // 3. fallback: 이미 압축 해제된 데이터이거나 깨진 데이터
  const code = new TextDecoder('utf-8', { fatal: false }).decode(compressed);
  return { code, method: 'raw', error: 'zlib/deflate decompression both failed, used raw bytes' };
}

/**
 * Scripts.rvdata2 바이트 배열 파싱 (기존 호환 API)
 * Marshal 형식: Array of [section_id, title, zlib_deflated_code]
 */
export function parseScriptsRvdata2(data: Uint8Array): RgssScript[] {
  return parseScriptsRvdata2Detailed(data).scripts;
}

/**
 * Scripts.rvdata2 파싱 (상세 진단 포함)
 * 디코딩 실패/바이너리 가비지를 개별 진단으로 보고하여
 * 하위 파이프라인(정적검사/Opal 컴파일)의 오검출을 방지.
 */
export function parseScriptsRvdata2Detailed(data: Uint8Array): ParseScriptsDetailedResult {
  let parsed: Array<{ sectionId: number; title: string; compressed: Uint8Array }>;
  try {
    parsed = decodeRgssScriptsFromMarshal(data);
  } catch (error) {
    console.warn('[WebRGSS][Scripts] rich marshal decode failed, falling back to legacy parser:', error);
    parsed = parseScriptsRvdata2Legacy(data);
  }

  const scripts: RgssScript[] = [];
  const decodeDiagnostics: RgssTranspileDiagnostic[] = [];
  let decodeFailCount = 0;
  let likelyBinaryCount = 0;

  for (let i = 0; i < parsed.length; i++) {
    const { sectionId, title, compressed } = parsed[i];
    const cleanTitle = title.replace(/^\d{3}-/, '');

    let code = '';
    if (compressed.length > 0) {
      const result = decompressScriptBytes(compressed);
      code = result.code;

      // 압축 해제 방법 자체가 실패한 경우
      if (result.error) {
        decodeFailCount++;
        decodeDiagnostics.push({
          severity: 'warning',
          code: 'RGSS_SCRIPT_DECODE_FAILED',
          message: `스크립트 디코딩 실패 (${result.error}), raw bytes fallback 사용`,
          scriptIndex: i,
          scriptTitle: cleanTitle,
        });
      }

      // 텍스트 품질 검사: 디코딩은 성공했지만 결과가 바이너리 가비지인 경우
      if (code.length > 0) {
        const quality = analyzeTextQuality(code);
        if (quality.likelyBinary) {
          likelyBinaryCount++;
          decodeDiagnostics.push({
            severity: 'warning',
            code: 'RGSS_SCRIPT_BINARY_GARBAGE_DETECTED',
            message: `디코딩 결과가 바이너리 가비지로 판정 (printableRatio=${quality.printableRatio.toFixed(2)}, replacementChars=${quality.replacementCharCount}, nullBytes=${quality.nullCount})`,
            scriptIndex: i,
            scriptTitle: cleanTitle,
          });
        }
      }
    }

    scripts.push({
      index: i,
      sectionId,
      title: cleanTitle,
      code,
    });
  }

  const totalScripts = parsed.length;
  const successCount = totalScripts - Math.max(decodeFailCount, likelyBinaryCount);
  const decodeSuccessRatio = totalScripts > 0 ? successCount / totalScripts : 1;

  return {
    scripts,
    decodeDiagnostics,
    decodeSuccessRatio,
    likelyBinaryCount,
    totalScripts,
  };
}

/**
 * Zip 파일에서 Data/Scripts.rvdata2 추출 후 파싱
 */
export async function parseScriptsFromZip(zipBlob: Blob): Promise<RgssScript[]> {
  const { default: JSZip } = await import('jszip');
  const zip = await JSZip.loadAsync(zipBlob);
  const data = await getScriptsFromZip(zip);
  if (!data) throw new Error('Scripts.rvdata2 not found in archive');
  return parseScriptsRvdata2(data);
}

/** Zip 파일에서 Scripts 추출 (상세 진단 포함)
 *
 * Node.js 환경의 JSZip은 Blob 입력을 안정적으로 처리하지 못하므로
 * ArrayBuffer/Uint8Array/Buffer 도 허용한다. Blob 이 들어오면 내부에서
 * arrayBuffer() 를 호출해 Uint8Array 로 변환한다. */
export async function parseScriptsFromZipDetailed(
  zipInput: Blob | ArrayBuffer | Uint8Array | ArrayBufferView
): Promise<ParseScriptsDetailedResult> {
  const { default: JSZip } = await import('jszip');
  const input =
    typeof Blob !== 'undefined' && zipInput instanceof Blob
      ? new Uint8Array(await zipInput.arrayBuffer())
      : zipInput;
  const zip = await JSZip.loadAsync(input as ArrayBuffer | Uint8Array);
  const data = await getScriptsFromZip(zip);
  if (!data) throw new Error('Scripts.rvdata2 not found in archive');
  return parseScriptsRvdata2Detailed(data);
}

/**
 * JSZip 인스턴스에서 Scripts 바이트 추출 (ResourceLoader와 공유 시)
 */
export async function getScriptsFromZip(zip: import('jszip')): Promise<Uint8Array | null> {
  const paths = ['Data/Scripts.rvdata2', 'Scripts.rvdata2'];
  let file = zip.file(paths[0]) ?? zip.file(paths[1]);
  if (!file) {
    const names = Object.keys(zip.files);
    const match = names.find((n) => /Scripts\.rvdata2$/i.test(n));
    file = match ? zip.file(match) ?? null : null;
  }
  if (!file) return null;
  return file.async('uint8array');
}
