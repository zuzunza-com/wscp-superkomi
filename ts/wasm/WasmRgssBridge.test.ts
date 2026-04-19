import assert from 'node:assert/strict';
import test from 'node:test';

import { Bitmap } from '../api/Bitmap';
import { Window } from '../api/Window';
import { WasmRgssBridge } from './WasmRgssBridge';

test('triggerRender only presents the current frame without advancing renderer state', () => {
  let updateCalls = 0;
  let renderCalls = 0;

  const bridge = new WasmRgssBridge({
    renderer: {
      update: () => { updateCalls += 1; },
      render: () => { renderCalls += 1; },
    } as never,
    loader: {} as never,
  });

  bridge.triggerRender();

  assert.equal(updateCalls, 0);
  assert.equal(renderCalls, 1);
});

test('js_graphics_update still advances renderer state for Graphics.update calls from Ruby', () => {
  let updateCalls = 0;
  let renderCalls = 0;

  const bridge = new WasmRgssBridge({
    renderer: {
      update: () => { updateCalls += 1; },
      render: () => { renderCalls += 1; },
    } as never,
    loader: {} as never,
  });

  const imports = bridge.buildImports() as { env: Record<string, () => void> };
  imports.env['js_graphics_update']();

  assert.equal(updateCalls, 1);
  assert.equal(renderCalls, 1);
});

function installCanvasDocumentMock(): () => void {
  const previousDocument = (globalThis as { document?: unknown }).document;
  const context = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    globalAlpha: 1,
    clearRect() {},
    fillRect() {},
    strokeRect() {},
    drawImage() {},
    save() {},
    restore() {},
    translate() {},
    rotate() {},
    scale() {},
    fillText() {},
    measureText(text: string) {
      return { width: text.length * 8 };
    },
  };
  const documentMock = {
    createElement(tag: string) {
      if (tag !== 'canvas') throw new Error(`unexpected tag: ${tag}`);
      return {
        width: 0,
        height: 0,
        getContext(type: string) {
          if (type !== '2d') return null;
          return context;
        },
      };
    },
  };
  (globalThis as { document?: unknown }).document = documentMock;
  return () => {
    if (previousDocument === undefined) {
      delete (globalThis as { document?: unknown }).document;
    } else {
      (globalThis as { document?: unknown }).document = previousDocument;
    }
  };
}

test('js_bitmap_load redraws windows after async windowskin image is resolved', async () => {
  const restoreDocument = installCanvasDocumentMock();
  let redrawCalls = 0;

  const originalRedrawWindow = Window.prototype.redrawWindow;
  const originalLoadFromResource = Bitmap.loadFromResource;

  Window.prototype.redrawWindow = function patchedRedrawWindow(this: Window): void {
    redrawCalls += 1;
    originalRedrawWindow.call(this);
  };
  (Bitmap as unknown as {
    loadFromResource: typeof Bitmap.loadFromResource;
  }).loadFromResource = async () => new Bitmap(128, 128);

  try {
    const bridge = new WasmRgssBridge({
      renderer: {
        canvas: {} as HTMLCanvasElement,
        setSize() {},
        setBackgroundColor() {},
        addSprite() {},
        removeSprite() {},
        addTilemap() {},
        removeTilemap() {},
        addPlane() {},
        removePlane() {},
        clearSprites() {},
        markSortDirty() {},
        update() {},
        render() {},
      },
      loader: {
        async getImageUrl() { return 'mock://image'; },
        async getAudioUrl() { return null; },
        findFirstImage() { return null; },
        async getFile() { return null; },
        listFiles() { return []; },
        dispose() {},
      },
    });
    const imports = bridge.buildImports() as { env: Record<string, (...args: number[]) => number | void> };

    const winId = imports.env['js_window_create'](0, 0, 160, 96) as number;
    const bmpId = imports.env['js_bitmap_load'](0) as number;
    imports.env['js_window_set_windowskin'](winId, bmpId);
    const redrawAfterSet = redrawCalls;

    await Promise.resolve();
    await Promise.resolve();

    assert.ok(redrawCalls > redrawAfterSet);
  } finally {
    Window.prototype.redrawWindow = originalRedrawWindow;
    (Bitmap as unknown as {
      loadFromResource: typeof Bitmap.loadFromResource;
    }).loadFromResource = originalLoadFromResource;
    restoreDocument();
  }
});
