import { RgssHostBridge } from "./RgssHostBridge";
import type { IResourceLoader } from "../resources/types";

export type RuntimeBundleModule = {
  boot?: (host: RgssHostBridge) => Promise<unknown> | unknown;
  runtimeMeta?: unknown;
};

export class TranspiledScriptRuntime {
  private mod: RuntimeBundleModule | null = null;
  private hostBridge: RgssHostBridge | null = null;

  async load(bundleUrl: string): Promise<void> {
    const url = `${bundleUrl}${bundleUrl.includes("?") ? "&" : "?"}t=${Date.now()}`;
    this.mod = (await import(/* @vite-ignore */ /* webpackIgnore: true */ url)) as RuntimeBundleModule;
  }

  async boot(loader: IResourceLoader): Promise<{ mode: string; registeredScriptCount: number }> {
    if (!this.mod?.boot) {
      throw new Error("RGSS runtime bundle boot 함수가 없습니다.");
    }
    const host = new RgssHostBridge(loader);
    this.hostBridge = host;

    const g = globalThis as typeof globalThis & { __wscpRgssHost?: unknown };
    const prev = g.__wscpRgssHost;
    g.__wscpRgssHost = host.toRuntimeGlobal();
    let result: unknown;
    try {
      result = await this.mod.boot(host);
    } finally {
      g.__wscpRgssHost = prev;
    }

    const mode =
      result && typeof result === "object" && "mode" in (result as Record<string, unknown>)
        ? String((result as Record<string, unknown>).mode)
        : "unknown";
    return {
      mode,
      registeredScriptCount: host.getRegisteredScripts().length,
    };
  }

  getHostBridge(): RgssHostBridge | null {
    return this.hostBridge;
  }
}
