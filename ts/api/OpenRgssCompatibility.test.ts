import assert from 'node:assert/strict';
import test from 'node:test';

import { Bitmap } from './Bitmap';
import { Graphics } from './Graphics';
import { Viewport } from './Viewport';
import { Window } from './Window';

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

function installCanvasDocumentMockWithDrawRecorder() {
  const previousDocument = (globalThis as { document?: unknown }).document;
  const drawImageCalls: unknown[][] = [];
  const context = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    globalAlpha: 1,
    clearRect() {},
    fillRect() {},
    strokeRect() {},
    drawImage(...args: unknown[]) {
      drawImageCalls.push(args);
    },
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
  return {
    drawImageCalls,
    restore() {
      if (previousDocument === undefined) {
        delete (globalThis as { document?: unknown }).document;
      } else {
        (globalThis as { document?: unknown }).document = previousDocument;
      }
    },
  };
}

function installCanvasDocumentMockWithTextRecorder() {
  const previousDocument = (globalThis as { document?: unknown }).document;
  const fillTextCalls: unknown[][] = [];
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
    fillText(...args: unknown[]) {
      fillTextCalls.push(args);
    },
    measureText(text: string) {
      return {
        width: text.length * 8,
        actualBoundingBoxAscent: 16,
        actualBoundingBoxDescent: 4,
      };
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
  return {
    fillTextCalls,
    restore() {
      if (previousDocument === undefined) {
        delete (globalThis as { document?: unknown }).document;
      } else {
        (globalThis as { document?: unknown }).document = previousDocument;
      }
    },
  };
}

test('Viewport defaults to the full Graphics size when no rect is provided', () => {
  Graphics.resizeScreen(544, 416);

  const viewport = new Viewport();

  assert.equal(viewport.rect.x, 0);
  assert.equal(viewport.rect.y, 0);
  assert.equal(viewport.rect.width, 544);
  assert.equal(viewport.rect.height, 416);
});

test('Window defaults z to 100 like OpenRGSS/RGSS3', () => {
  const restoreDocument = installCanvasDocumentMock();
  const window = new Window(0, 0, 160, 96);
  try {
    assert.equal(window.z, 100);
  } finally {
    restoreDocument();
  }
});

test('Window render keeps frame at x/y and applies ox/oy only to contents', () => {
  const mock = installCanvasDocumentMockWithDrawRecorder();
  const window = new Window(100, 200, 160, 96);
  try {
    window.ox = 10;
    window.oy = 20;
    window.openness = 255;
    window.render((window.bitmap as { context: CanvasRenderingContext2D }).context, 0, 0);

    assert.ok(mock.drawImageCalls.length >= 2);
    const frameCall = mock.drawImageCalls[0]!;
    const contentsCall = mock.drawImageCalls[1]!;

    // drawImage(image, sx, sy, sw, sh, dx, dy, dw, dh)
    assert.equal(frameCall[5], 100);
    assert.equal(frameCall[6], 200);

    // drawImage(image, dx, dy, dw, dh)
    assert.equal(contentsCall[1], 102);
    assert.equal(contentsCall[2], 192);
  } finally {
    mock.restore();
  }
});

test('Bitmap drawText vertically centers text inside the given rect like RGSS', () => {
  const mock = installCanvasDocumentMockWithTextRecorder();
  try {
    const bitmap = new Bitmap(320, 240);
    bitmap.font.size = 24;
    bitmap.drawText(0, 0, 200, 48, 'New Game', 1);

    assert.equal(mock.fillTextCalls.length, 1);
    const call = mock.fillTextCalls[0]!;
    const drawY = Number(call[2]);
    assert.ok(drawY > 0);
    assert.ok(drawY < 20);
  } finally {
    mock.restore();
  }
});

test('Window windowskin renderer does not draw the frame center slice over contents', () => {
  const mock = installCanvasDocumentMockWithDrawRecorder();
  const window = new Window(0, 0, 160, 96);
  try {
    const skin = new Bitmap(128, 128);
    window.windowskin = skin;
    mock.drawImageCalls.length = 0;
    window.redrawWindow();

    const hasFrameCenterBlit = mock.drawImageCalls.some((call) => (
      call.length === 9 &&
      call[1] === 80 &&
      call[2] === 16 &&
      call[3] === 32 &&
      call[4] === 32
    ));
    assert.equal(hasFrameCenterBlit, false);
  } finally {
    mock.restore();
  }
});
