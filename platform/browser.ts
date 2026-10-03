/**
 * platform/browser.ts — the BROWSER implementation of the engine's ports
 * (engine/ports.ts).  The only file besides the render / input / audio
 * adapters that is allowed to name `window`, `document`, `performance` and
 * `localStorage`, which is the whole point of the ports: everything the sim
 * needs from the outside world arrives through the `Platform` this builds.
 *
 * Construction order matters in one place.  `InputSystem` attaches its DOM
 * listeners when `attach(window)` is called, and `AudioSystem` registers its
 * recipes before the first sound can play — both happen here, inside
 * `createBrowserPlatform`, i.e. at the same point in startup the
 * `GameEngine` constructor used to do them, so nothing about boot order moves.
 */
import { InputSystem } from '../engine/systems/InputSystem';
import { AudioSystem } from '../engine/systems/AudioSystem';
import { registerSfx } from '../engine/systems/SfxRegistry';
import { RenderSystem } from '../engine/systems/RenderSystem';
import {
  MemoryStorage,
  type Clock, type Entropy, type Lifecycle, type LifecycleEvent, type Platform, type Storage, type Viewport,
} from '../engine/ports';

export const browserClock: Clock = {
  now: () => performance.now(),
  requestFrame: (cb) => { requestAnimationFrame(cb); },
};

/** ONE reused object — `viewport()` is read from per-frame paths, where an
 *  allocation per read is the pattern CLAUDE.md §8 forbids. */
const viewportBuf: Viewport = { width: 0, height: 0, dpr: 1 };
export function browserViewport(): Viewport {
  viewportBuf.width = window.innerWidth;
  viewportBuf.height = window.innerHeight;
  viewportBuf.dpr = window.devicePixelRatio || 1;
  return viewportBuf;
}

/** `localStorage`, with the memory store behind it.  Storage can throw on
 *  access (a private window, blocked site data) and can come back empty, so
 *  every call is guarded and a failed write still lands in memory — the game
 *  then keeps its settings for the session instead of losing them. */
export function createBrowserStorage(): Storage {
  const mem = new MemoryStorage();
  return {
    get(key) {
      try {
        const v = window.localStorage.getItem(key);
        if (v !== null) return v;
      } catch { /* fall through to memory */ }
      return mem.get(key);
    },
    set(key, value) {
      mem.set(key, value);
      try { window.localStorage.setItem(key, value); } catch { /* memory only */ }
    },
    remove(key) {
      mem.remove(key);
      try { window.localStorage.removeItem(key); } catch { /* memory only */ }
    },
  };
}

/** Page visibility.  Native shells (S4) will add their own source; the sim
 *  only ever sees `background` / `foreground`. */
export function createBrowserLifecycle(): Lifecycle {
  return {
    subscribe(cb: (e: LifecycleEvent) => void) {
      const onVis = () => cb(document.hidden ? 'background' : 'foreground');
      document.addEventListener('visibilitychange', onVis);
      return () => document.removeEventListener('visibilitychange', onVis);
    },
  };
}

export const browserEntropy: Entropy = {
  seed(): number {
    const c = (globalThis as { crypto?: Crypto }).crypto;
    if (c && typeof c.getRandomValues === 'function') {
      const a = new Uint32Array(1);
      c.getRandomValues(a);
      return a[0];
    }
    return (Date.now() ^ (performance.now() * 1000)) >>> 0;
  },
};

export function createBrowserPlatform(): Platform {
  const input = new InputSystem();
  input.attach(window);
  // Audio: the AudioContext is NOT created here.  Mobile browsers refuse to
  // start audio outside a user gesture, so the manager only arms one-shot
  // window listeners (the engine calls `armGestureUnlock`) and builds its
  // graph on the first real tap/click/keypress.
  const audio = new AudioSystem();
  registerSfx(audio);
  return {
    clock: browserClock,
    viewport: browserViewport,
    storage: createBrowserStorage(),
    lifecycle: createBrowserLifecycle(),
    entropy: browserEntropy,
    audio,
    input,
    renderer: new RenderSystem(),
  };
}
