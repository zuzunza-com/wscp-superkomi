/**
 * 리소스 로드 인터페이스 - 게임/RTP 공통
 */
export interface IResourceResolver {
  getImageUrl(path: string): Promise<string | null>;
  getAudioUrl(path: string): Promise<string | null>;
  findFirstImage(prefixes: string[]): string | null;
}

export interface IResourceLoader extends IResourceResolver {
  getFile(path: string): Promise<Uint8Array | null>;
  listFiles(): string[];
  dispose(): void;
}
