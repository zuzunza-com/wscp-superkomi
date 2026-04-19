/**
 * 일반 rvdata2/rxdata 파싱 (Marshal 형식)
 * Map, System, Actors 등 게임 데이터 로드용
 */
import { decodeRubyMarshalToJs } from './ruby-marshal-rgss';

/**
 * rvdata2/rxdata 바이트 배열 파싱
 */
export function parseRvdata2<T = unknown>(data: Uint8Array): T {
  return decodeRubyMarshalToJs<T>(data);
}

/**
 * Zip에서 특정 rvdata2 파일 추출 후 파싱
 */
export async function parseRvdata2FromZip<T = unknown>(
  zipBlob: Blob,
  path: string
): Promise<T> {
  const { default: JSZip } = await import('jszip');
  const zip = await JSZip.loadAsync(zipBlob);
  const file = zip.file(path);
  if (!file) {
    throw new Error(`File not found in archive: ${path}`);
  }
  const arr = await file.async('uint8array');
  return parseRvdata2<T>(arr);
}
