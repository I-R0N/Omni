/**
 * Pause and app lifecycle, headless.
 *
 *  - Escape pauses live play, resumes from the pause menu, closes the debug
 *    panel first, and does nothing on the menu or the death screen;
 *  - backgrounding pauses cleanly (silently) and lets go of held keys;
 *  - coming back never resumes by itself, and re-anchors the frame clock so a
 *    long absence costs the sim NO time.
 *
 * The engine runs its REAL frame loop here (`loop(t)` is stepped by hand on
 * the manual clock), and Escape arrives through the REAL keydown handler: the
 * input is attached to a plain EventTarget, which is all `attach` needs.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHeadlessEngine } from './harness';
import { GameState, MapType } from '../../types';

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

function keydown(target: EventTarget, code: string): void {
  const e = new Event('keydown');
  Object.defineProperty(e, 'code', { value: code });
  target.dispatchEvent(e);
}
function keyup(target: EventTarget, code: string): void {
  const e = new Event('keyup');
  Object.defineProperty(e, 'code', { value: code });
  target.dispatchEvent(e);
}

/** A running engine in live play on the hub, frames driven by hand. */
function live() {
  const h = createHeadlessEngine();
  const target = new EventTarget();
  h.platform.input.attach(target);
  const g = h.engine as Any;
  g.beginSeededRun(11, MapType.POCKET);
  g.replayHold = false;
  g.start();
  let t = 0;
  const frame = (ms = 16) => { t += ms; h.platform.clock.set(t); g.loop(t); };
  frame();
  return { ...h, g, target, frame, clockNow: () => t, advanceClock: (ms: number) => { t += ms; h.platform.clock.set(t); } };
}

test('Escape pauses live play, and Escape again resumes', () => {
  const { g, target, frame } = live();
  assert.equal(g.gameState, GameState.PLAYING);
  keydown(target, 'Escape'); frame();
  assert.equal(g.gameState, GameState.PAUSED);
  keydown(target, 'Escape'); frame();
  assert.equal(g.gameState, GameState.PLAYING);
});

test('Escape closes the debug panel FIRST, and does not also pause', () => {
  const { g, target, frame } = live();
  g.setDebugPanelOpen(true);
  keydown(target, 'Escape'); frame();
  assert.equal(g.debugPanelOpen, false);
  assert.equal(g.gameState, GameState.PLAYING, 'one Escape, one dismissal');
  keydown(target, 'Escape'); frame();
  assert.equal(g.gameState, GameState.PAUSED);
});

test('Escape does nothing on the menu or the death screen', () => {
  const m = createHeadlessEngine();
  const target = new EventTarget();
  m.platform.input.attach(target);
  const mg = m.engine as Any;
  assert.equal(mg.gameState, GameState.MENU);
  mg.start();
  keydown(target, 'Escape'); m.platform.clock.set(16); mg.loop(16);
  assert.equal(mg.gameState, GameState.MENU);

  const { g, target: t2, frame } = live();
  g.deathPending = true;
  keydown(t2, 'Escape'); frame();
  assert.equal(g.gameState, GameState.PLAYING, 'a decision screen is not dismissed by a key');
  assert.equal(g.deathPending, true);
});

test('held keys are tracked through the real handler, with no DOM present', () => {
  // `isUiKeyTarget` asks `instanceof HTMLElement`, which does not exist in
  // Node; it must answer "not a UI target" rather than throw.
  const { g, target } = live();
  keydown(target, 'KeyD');
  assert.equal(g.input.isKeyDown('KeyD'), true);
  keyup(target, 'KeyD');
  assert.equal(g.input.isKeyDown('KeyD'), false);
});

test('backgrounding pauses silently and releases held keys', () => {
  const { g, target, platform, frame } = live();
  keydown(target, 'KeyD');
  const before = platform.audio.played.length;
  platform.lifecycle.emit('background');
  assert.equal(g.gameState, GameState.PAUSED);
  assert.equal(g.input.isKeyDown('KeyD'), false, 'keyup never reaches a hidden page');
  assert.equal(platform.audio.played.length, before, 'the pause blip is skipped when backgrounded');
  frame();
  assert.equal(g.gameState, GameState.PAUSED);
});

test('returning never resumes by itself, and a long absence costs the sim nothing', () => {
  const { g, platform, frame, advanceClock } = live();
  for (let i = 0; i < 10; i++) frame();
  platform.lifecycle.emit('background');
  const simBefore = g.simClock;

  advanceClock(10 * 60 * 1000); // ten minutes in the background
  platform.lifecycle.emit('foreground');
  assert.equal(g.gameState, GameState.PAUSED, 'the player decides when to resume');
  assert.equal(g.simClock, simBefore, 'a paused sim does not move');

  g.resumeGame();
  frame(); frame();
  const gained = g.simClock - simBefore;
  assert.ok(gained > 0, 'the sim runs again');
  assert.ok(gained < 0.05, `two frames after a 10 minute absence advanced ${gained}s of sim`);
});

test('the DEATH screen keeps running through a background, but its clock is re-anchored too', () => {
  const { g, platform, frame, advanceClock } = live();
  g.deathPending = true;           // the one overlay that does not freeze the sim
  frame();
  platform.lifecycle.emit('background');
  assert.equal(g.gameState, GameState.PLAYING, 'pauseGame refuses a screen that is already up');
  const simBefore = g.simClock;
  advanceClock(5 * 60 * 1000);
  platform.lifecycle.emit('foreground');
  frame();
  // One 16 ms frame is one or two 120 Hz substeps.  Without the re-anchor the
  // stale delta is clamped to MAX_FRAME_TIME and drains MAX_SUBSTEPS (5)
  // steps — 0.042 s of sim the player never asked for.
  const gained = g.simClock - simBefore;
  assert.ok(gained < 0.02, `a frame after a five minute absence advanced ${gained}s of sim`);
});

test('stop() unsubscribes from the lifecycle', () => {
  const { g, platform } = live();
  g.stop();
  platform.lifecycle.emit('background');
  assert.equal(g.gameState, GameState.PLAYING, 'a stopped engine no longer listens');
});
