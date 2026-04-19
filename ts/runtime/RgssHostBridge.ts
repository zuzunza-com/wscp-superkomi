import type { IResourceLoader } from "../resources/types";
import { Graphics } from "../api/Graphics";
import { Input, InputState } from "../api/Input";
import { Audio } from "../api/Audio";
import { DataManagerBridge } from "./DataManagerBridge";
import { SceneManagerBridge } from "./SceneManagerBridge";

export type RegisteredScript = {
  index: number;
  title: string;
  code: string;
};

export class RgssHostBridge {
  readonly loader: IResourceLoader;
  readonly dataManager: DataManagerBridge;
  readonly sceneManager: SceneManagerBridge;
  readonly graphics = Graphics;
  readonly input = { Input, InputState };
  readonly audio = Audio;
  private readonly scripts: RegisteredScript[] = [];
  private opalRuntime: unknown = null;

  constructor(loader: IResourceLoader) {
    this.loader = loader;
    this.dataManager = new DataManagerBridge(loader);
    this.sceneManager = new SceneManagerBridge();
  }

  registerScript(script: RegisteredScript): void {
    this.scripts.push(script);
  }

  getRegisteredScripts(): RegisteredScript[] {
    return this.scripts.slice().sort((a, b) => a.index - b.index);
  }

  setOpalRuntime(opal: unknown): void {
    this.opalRuntime = opal;
  }

  getOpalRuntime(): unknown {
    return this.opalRuntime;
  }

  toRuntimeGlobal(): Record<string, unknown> {
    return {
      registerScript: this.registerScript.bind(this),
      Graphics: this.graphics,
      Input,
      InputState,
      Audio: this.audio,
      DataManager: this.dataManager,
      SceneManager: this.sceneManager,
      __hostBridge: this,
    };
  }
}
