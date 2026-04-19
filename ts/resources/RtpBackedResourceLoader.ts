/**
 * RTP 백업 ResourceLoader
 * 게임 리소스 먼저, 없으면 RTP에서 폴백
 */
import type { IResourceLoader } from './types';

type BulkLoader = IResourceLoader & {
  preloadBulk?: (maxBytes?: number) => Promise<boolean>;
};

export class RtpBackedResourceLoader implements IResourceLoader {
  private _game: IResourceLoader;
  private _rtp: IResourceLoader | null;

  constructor(game: IResourceLoader, rtp: IResourceLoader | null) {
    this._game = game;
    this._rtp = rtp;
  }

  dispose(): void {
    this._game.dispose();
  }

  /** 게임 로더가 preloadBulk를 지원하면 위임 (단일 GET 기반 일괄 로드) */
  async preloadBulk(maxBytes?: number): Promise<boolean> {
    const bulk = this._game as BulkLoader;
    if (typeof bulk.preloadBulk === 'function') return bulk.preloadBulk(maxBytes);
    return false;
  }

  async getImageUrl(path: string): Promise<string | null> {
    const url = await this._game.getImageUrl(path);
    if (url) return url;
    if (this._rtp) return this._rtp.getImageUrl(path);
    return null;
  }

  async getAudioUrl(path: string): Promise<string | null> {
    const url = await this._game.getAudioUrl(path);
    if (url) return url;
    if (this._rtp) return this._rtp.getAudioUrl(path);
    return null;
  }

  findFirstImage(prefixes: string[]): string | null {
    const fromGame = this._game.findFirstImage(prefixes);
    if (fromGame) return fromGame;
    if (this._rtp) return this._rtp.findFirstImage(prefixes);
    return null;
  }

  async getFile(path: string): Promise<Uint8Array | null> {
    const fromGame = await this._game.getFile(path);
    if (fromGame && fromGame.length > 0) return fromGame;
    if (!this._rtp) return null;
    return this._rtp.getFile(path);
  }

  listFiles(): string[] {
    const gameFiles = this._game.listFiles();
    const rtpFiles = this._rtp?.listFiles() ?? [];
    return [...new Set([...gameFiles, ...rtpFiles])];
  }
}
