/**
 * zip / rgss3a Blob에서 RGSS3(VX Ace) 게임 로드
 * - .rgss3a : Rgss3aLoader 로 복호화
 * - .zip    : JSZip + ResourceLoader
 * rtpLoader 있으면 이미지/오디오 폴백으로 RTP 사용
 */
import JSZip from 'jszip';
import { ResourceLoader } from './resources/ResourceLoader';
import { Rgss3aLoader, tryLoadRgssArchive } from './resources/Rgss3aLoader';
import { RtpBackedResourceLoader } from './resources/RtpBackedResourceLoader';
import type { IResourceLoader } from './resources/types';
import { parseScriptsRvdata2 } from './rvdata2/parseScripts';
import { getScriptsFromZip } from './rvdata2/parseScripts';
import { parseRvdata2 } from './rvdata2/parseRvdata2';

export interface LoadedGame {
  loader: IResourceLoader | RtpBackedResourceLoader;
  scripts: import('./rvdata2/parseScripts').RgssScript[];
  system: unknown;
}

async function getScriptsFromLoader(loader: IResourceLoader): Promise<Uint8Array | null> {
  const paths = ['Data/Scripts.rvdata2', 'Scripts.rvdata2'];
  for (const p of paths) {
    const data = await loader.getFile(p);
    if (data && data.length > 0) return data;
  }

  const match = loader
    .listFiles()
    .find((n) => /scripts\.rvdata2$/i.test(n.replace(/\\/g, '/')));
  if (!match) return null;
  return loader.getFile(match);
}

export async function loadGameFromLoader(
  gameLoader: IResourceLoader,
  rtpLoader?: IResourceLoader | null
): Promise<LoadedGame> {
  const loader = rtpLoader
    ? new RtpBackedResourceLoader(gameLoader, rtpLoader)
    : gameLoader;

  const scriptsData = await getScriptsFromLoader(loader);
  const scripts = scriptsData ? parseScriptsRvdata2(scriptsData) : [];

  let system: unknown = null;
  const systemPaths = ['Data/System.rvdata2', 'System.rvdata2'];
  for (const p of systemPaths) {
    const data = await loader.getFile(p);
    if (data && data.length > 0) {
      try {
        system = parseRvdata2(data);
        break;
      } catch {
        // Marshal 파싱 실패 시 무시
      }
    }
  }

  return { loader, scripts, system };
}

export async function loadGameFromZip(
  zipBlob: Blob,
  rtpLoader?: IResourceLoader | null
): Promise<LoadedGame> {
  // RGSS 암호화 아카이브 (.rgss3a / .rgss2a / .rgssad) 자동 감지
  const rgssLoader = await tryLoadRgssArchive(zipBlob);
  if (rgssLoader) {
    return loadGameFromLoader(rgssLoader, rtpLoader ?? null);
  }

  // 일반 ZIP
  const zip = await JSZip.loadAsync(zipBlob);
  const gameLoader = new ResourceLoader(zip);
  const scriptsData = await getScriptsFromZip(zip);
  const scripts = scriptsData ? parseScriptsRvdata2(scriptsData) : [];
  const loaded = await loadGameFromLoader(gameLoader, rtpLoader ?? null);
  return {
    ...loaded,
    scripts, // zip 경로에서는 기존 zip 추출 결과를 우선 사용
  };
}

/**
 * RGSS 암호화 아카이브 Blob에서 직접 로드 (명시적 API).
 * 헤더 미검사 — 반드시 .rgss3a / .rgss2a / .rgssad 를 넘길 것.
 */
export async function loadGameFromRgss3a(
  archiveBlob: Blob,
  rtpLoader?: IResourceLoader | null
): Promise<LoadedGame> {
  const loader = await Rgss3aLoader.fromBlob(archiveBlob);
  return loadGameFromLoader(loader, rtpLoader ?? null);
}
