import assert from 'node:assert/strict';
import test from 'node:test';

import { WasmRgssRuntime } from './WasmRgssRuntime';

type TestScript = { index: number; title: string; code: string };

function patchScripts(scripts: TestScript[]): TestScript[] {
  const runtime = new WasmRgssRuntime({
    wasmModuleUrl: '/player/wasm/webrgss.mjs',
    renderer: {} as never,
    loader: {
      listFiles: () => [],
      getAudioUrl: () => '',
    } as never,
    scripts,
  });

  return (runtime as any).patchMainScriptLoops(scripts);
}

test('patchMainScriptLoops keeps rgss_main block without forced initial Fiber.yield', () => {
  const scripts = patchScripts([
    {
      index: 124,
      title: 'Main',
      code: 'rgss_main { SceneManager.run }',
    },
  ]);

  const main = scripts[0]?.code ?? '';
  assert.match(main, /rgss_main\s*\{\s*SceneManager\.run\s*\}/);
  assert.doesNotMatch(main, /rgss_main\s*\{\s*Fiber\.yield\s*;/);
});

test('patchMainScriptLoops keeps SceneManager.run loop contract (@scene.main while @scene)', () => {
  const scripts = patchScripts([
    {
      index: 6,
      title: 'SceneManager',
      code: 'module SceneManager; def self.run; @scene.main while @scene; end; end',
    },
  ]);

  const sceneManager = scripts[0]?.code ?? '';
  assert.match(sceneManager, /@scene\.main while @scene/);
  assert.doesNotMatch(sceneManager, /while !@scene\.nil\?/);
});

test('runTicks switches to frame-tick fallback when first fiber tick dies with probe21', async () => {
  let onErrorCalled = false;

  const runtime = new WasmRgssRuntime({
    wasmModuleUrl: '/player/wasm/webrgss.mjs',
    renderer: {} as never,
    loader: {
      listFiles: () => [],
      getAudioUrl: () => '',
    } as never,
    scripts: [],
    onError: () => {
      onErrorCalled = true;
    },
  });

  const rt = runtime as any;
  rt.loopTickCounter = 0;
  rt.state = 'running';
  rt.bridge = { triggerRender: () => {} };
  rt.fnDebugTickProbe = () => 21;
  rt.fnDebugGameRunning = () => 0;
  rt.fnDebugIsFiber = () => 1;
  rt.fnExecScript = () => 0;
  rt.mem = {
    allocStr: () => 1,
    freeStr: () => {},
  };

  await rt.runTicks(() => 0, 1);

  assert.equal(onErrorCalled, false);
  assert.equal(rt.loopFallbackInFlight, true);
});

test('runFrameTickScript uses scene.update-driven fallback without extra Graphics.update calls', async () => {
  const runtime = new WasmRgssRuntime({
    wasmModuleUrl: '/player/wasm/webrgss.mjs',
    renderer: {} as never,
    loader: {
      listFiles: () => [],
      getAudioUrl: () => '',
    } as never,
    scripts: [],
  });

  const rt = runtime as any;
  const strings = new Map<number, string>();
  let nextPtr = 1;
  let capturedScript = '';

  rt.mem = {
    allocStr: (value: string) => {
      const ptr = nextPtr++;
      strings.set(ptr, value);
      return ptr;
    },
    freeStr: () => {},
  };
  rt.fnExecScript = (srcPtr: number) => {
    capturedScript = strings.get(srcPtr) ?? '';
    return 0;
  };

  const ok = await rt.runFrameTickScript();

  assert.equal(ok, true);
  assert.match(capturedScript, /cur = SceneManager\.scene/);
  assert.match(capturedScript, /if cur == nil/);
  assert.match(capturedScript, /SceneManager\.instance_variable_set\(:@scene, SceneManager\.first_scene_class\.new\)/);
  assert.match(capturedScript, /cur\.update if cur\.respond_to\?\(:update\)/);
  assert.doesNotMatch(capturedScript, /Graphics\.update/);
  assert.doesNotMatch(capturedScript, /Input\.update/);
});

test('activateFrameTickFallback clears stale fiber msgbox diagnostics', async () => {
  const runtime = new WasmRgssRuntime({
    wasmModuleUrl: '/player/wasm/webrgss.mjs',
    renderer: {} as never,
    loader: {
      listFiles: () => [],
      getAudioUrl: () => '',
    } as never,
    scripts: [],
  });

  const rt = runtime as any;
  rt._lastMsgbox = ['Fiber terminated (dead) - SceneManager.run ended or abnormal exit'];
  rt.execBootstrap = async () => true;
  rt.runFrameTickScript = async () => true;

  const ok = await rt.activateFrameTickFallback();

  assert.equal(ok, true);
  assert.deepEqual(rt._lastMsgbox, []);
});

test('activateFrameTickFallback initializes DataManager before first scene bootstrap', async () => {
  const runtime = new WasmRgssRuntime({
    wasmModuleUrl: '/player/wasm/webrgss.mjs',
    renderer: {} as never,
    loader: {
      listFiles: () => [],
      getAudioUrl: () => '',
    } as never,
    scripts: [],
  });

  const rt = runtime as any;
  let capturedBootstrap = '';
  rt.runFrameTickScript = async () => true;
  rt.execBootstrap = async (_name: string, code: string) => {
    capturedBootstrap = code;
    return true;
  };

  const ok = await rt.activateFrameTickFallback();

  assert.equal(ok, true);
  assert.match(capturedBootstrap, /DataManager\.init/);
  assert.match(capturedBootstrap, /Audio\.setup_midi/);
});

test('activateFrameTickFallback bootstrap handles scene swap during first scene start', async () => {
  const runtime = new WasmRgssRuntime({
    wasmModuleUrl: '/player/wasm/webrgss.mjs',
    renderer: {} as never,
    loader: {
      listFiles: () => [],
      getAudioUrl: () => '',
    } as never,
    scripts: [],
  });

  const rt = runtime as any;
  let capturedBootstrap = '';
  rt.runFrameTickScript = async () => true;
  rt.execBootstrap = async (_name: string, code: string) => {
    capturedBootstrap = code;
    return true;
  };

  const ok = await rt.activateFrameTickFallback();

  assert.equal(ok, true);
  assert.match(capturedBootstrap, /__wrgss_s1 = SceneManager\.scene/);
  assert.match(capturedBootstrap, /if SceneManager\.scene != __wrgss_s1 && !SceneManager\.scene\.nil\?/);
  assert.match(capturedBootstrap, /SceneManager\.scene\.start if SceneManager\.scene\.respond_to\?\(:start\)/);
  assert.match(capturedBootstrap, /__wrgss_s\.update if __wrgss_s\.respond_to\?\(:update\)/);
});

test('executeScripts bootstrap defines Window property getters needed by Window_Selectable', async () => {
  const runtime = new WasmRgssRuntime({
    wasmModuleUrl: '/player/wasm/webrgss.mjs',
    renderer: {} as never,
    loader: {
      listFiles: () => [],
      getAudioUrl: () => '',
    } as never,
    scripts: [],
  });

  const rt = runtime as any;
  const bootstrapScripts = new Map<string, string>();
  rt.fnExecScript = () => 0;
  rt.mem = {};
  rt.execBootstrap = async (name: string, code: string) => {
    bootstrapScripts.set(name, code);
    return true;
  };

  await rt.executeScripts();

  const bootstrap = bootstrapScripts.get('WASM_BOOTSTRAP_SCRIPT') ?? '';
  assert.match(bootstrap, /def active\b/);
  assert.match(bootstrap, /def padding\b/);
  assert.match(bootstrap, /def padding_bottom\b/);
});

test('executeScripts bootstrap defines Font and Bitmap font bootstrap needed by Window_Base text rendering', async () => {
  const runtime = new WasmRgssRuntime({
    wasmModuleUrl: '/player/wasm/webrgss.mjs',
    renderer: {} as never,
    loader: {
      listFiles: () => [],
      getAudioUrl: () => '',
    } as never,
    scripts: [],
  });

  const rt = runtime as any;
  const bootstrapScripts = new Map<string, string>();
  rt.fnExecScript = () => 0;
  rt.mem = {};
  rt.execBootstrap = async (name: string, code: string) => {
    bootstrapScripts.set(name, code);
    return true;
  };

  await rt.executeScripts();

  const bootstrap = bootstrapScripts.get('WASM_BOOTSTRAP_SCRIPT') ?? '';
  const mergedBootstrap = [...bootstrapScripts.values()].join('\n');
  assert.match(bootstrap, /class Font\b/);
  assert.match(bootstrap, /def attach_bitmap\b/);
  assert.match(bootstrap, /class Bitmap\b/);
  assert.match(bootstrap, /def font\b/);
  assert.match(bootstrap, /__wrgss_font_name=/);
  assert.match(bootstrap, /self\.visible = 1 if respond_to\?\(:visible=\)/);
  assert.doesNotMatch(bootstrap, /self\.visible = true if respond_to\?\(:visible=\)/);
  assert.match(bootstrap, /respond_to\?\(:__wrgss_active_set\)/);
  assert.match(bootstrap, /__wrgss_active_set\(1\)/);
  assert.match(bootstrap, /respond_to\?\(:__wrgss_visible_set\)/);
  assert.match(bootstrap, /__wrgss_visible_set\(1\)/);
  assert.match(bootstrap, /module WrgssFontColorMethods/);
  assert.match(bootstrap, /class WrgssFontColor < Color/);
  assert.match(bootstrap, /color = Color\.new\(source\.red,\s*source\.green,\s*source\.blue,\s*source\.alpha\)/);
  assert.match(bootstrap, /color\.extend\(WrgssFontColorMethods\)/);
  assert.match(bootstrap, /if cls == "Tone"/);
  assert.match(bootstrap, /return Tone\.new/);
  assert.match(bootstrap, /if cls == "Color"/);
  assert.match(bootstrap, /return Color\.new/);
  assert.match(bootstrap, /if cls == "Rect"/);
  assert.match(bootstrap, /return Rect\.new/);
  assert.match(mergedBootstrap, /class Window_Base/);
  assert.match(mergedBootstrap, /alias __wrgss_text_color_orig text_color/);
  assert.match(mergedBootstrap, /ws\.width\.to_i <= 1/);
  assert.match(mergedBootstrap, /Color\.new\(255,\s*255,\s*255,\s*255\)/);
});
