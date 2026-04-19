import assert from 'node:assert/strict';
import test from 'node:test';

import { Audio, preloadAudioUrl, setAudioResourceLoader } from './Audio';

type ListenerMap = Map<string, EventListener>;

function installAudioDomMock(): {
  listeners: ListenerMap;
  restore: () => void;
  playCalls: () => number;
} {
  const previousDocument = (globalThis as { document?: unknown }).document;
  const previousWindow = (globalThis as { window?: unknown }).window;

  const listeners: ListenerMap = new Map();
  let playCount = 0;
  let failFirstPlay = true;

  const audioEl = {
    preload: '',
    src: '',
    volume: 1,
    loop: false,
    currentTime: 0,
    onended: null as null | (() => void),
    play() {
      playCount += 1;
      if (failFirstPlay) {
        failFirstPlay = false;
        return Promise.reject(new Error('autoplay blocked'));
      }
      return Promise.resolve();
    },
    pause() {},
  };

  (globalThis as { document?: unknown }).document = {
    createElement(tag: string) {
      if (tag !== 'audio') throw new Error(`unexpected tag: ${tag}`);
      return audioEl;
    },
  };

  (globalThis as { window?: unknown }).window = {
    addEventListener(type: string, handler: EventListener) {
      listeners.set(type, handler);
    },
    removeEventListener(type: string) {
      listeners.delete(type);
    },
  };

  return {
    listeners,
    playCalls: () => playCount,
    restore() {
      setAudioResourceLoader(null);
      Audio.bgmStop();
      Audio.bgsStop();
      Audio.meStop();
      Audio.seStop();
      if (previousDocument === undefined) {
        delete (globalThis as { document?: unknown }).document;
      } else {
        (globalThis as { document?: unknown }).document = previousDocument;
      }
      if (previousWindow === undefined) {
        delete (globalThis as { window?: unknown }).window;
      } else {
        (globalThis as { window?: unknown }).window = previousWindow;
      }
    },
  };
}

test('Audio retries blocked autoplay during a user gesture', async () => {
  const { listeners, restore, playCalls } = installAudioDomMock();

  try {
    setAudioResourceLoader(async (path: string) => `blob:${path}`);
    await preloadAudioUrl('Audio/BGM/Theme');

    Audio.bgmPlay('Audio/BGM/Theme');
    await Promise.resolve();

    const pointerdown = listeners.get('pointerdown');
    assert.ok(pointerdown, 'expected autoplay unlock listener');
    assert.equal(playCalls(), 1);

    pointerdown!(new Event('pointerdown'));
    await Promise.resolve();

    assert.equal(playCalls(), 2);
  } finally {
    restore();
  }
});
