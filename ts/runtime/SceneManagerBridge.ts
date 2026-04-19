export class SceneManagerBridge {
  private _currentSceneName: string | null = null;
  private _nextSceneName: string | null = null;

  get currentSceneName(): string | null {
    return this._currentSceneName;
  }

  get nextSceneName(): string | null {
    return this._nextSceneName;
  }

  goto(sceneName: string): void {
    this._nextSceneName = sceneName;
  }

  run(sceneName: string): void {
    this._currentSceneName = sceneName;
    this._nextSceneName = null;
  }

  update(): void {
    if (this._nextSceneName) {
      this._currentSceneName = this._nextSceneName;
      this._nextSceneName = null;
    }
  }
}
