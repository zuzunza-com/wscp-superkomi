/**
 * Shared diagnostic types for RGSS runtime/transpile flows.
 *
 * Previously exposed from `wscp-frontend/lib/webrgss-transpile/types.ts`
 * (Ruby-to-JavaScript transpiler). The Opal/transpile path is deprecated;
 * this module is the canonical home while we iterate on the WASM mruby
 * runtime. The type shape is intentionally identical so structural typing
 * keeps the legacy transpile types in sync.
 */

export type RgssTranspileDiagnostic = {
  severity: "error" | "warning";
  code: string;
  message: string;
  scriptIndex: number;
  scriptTitle: string;
  line?: number;
  column?: number;
  nodeType?: string;
  snippet?: string;
};

export type RgssRuntimeBundleManifest = {
  engine: "rgss3";
  cacheKey: string;
  scriptCount: number;
  scriptDigest: string;
  transpilerVersion: string;
  generatedAt: string;
  entryFunction: string;
  diagnostics: RgssTranspileDiagnostic[];
};

export type RgssRuntimeBundleResponse = {
  ok: boolean;
  cacheHit: boolean;
  cacheKey: string;
  bundleUrl: string;
  diagnostics: RgssTranspileDiagnostic[];
  engine: "rgss3";
  scriptDigest: string;
  transpilerVersion: string;
};

export type RgssScriptLike = {
  index: number;
  title: string;
  code: string;
};
