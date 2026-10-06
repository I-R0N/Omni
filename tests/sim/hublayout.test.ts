import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HUB_PORTAL_SITES, HUB_TEST_PORTAL_SITES, OVERWORLD_STATIONS, HUB_ARENA_VARIETIES, HUB_LAYOUT,
} from '../../constants';
import { mapDescriptor } from '../../engine/maps/MapDescriptors';
import { createHeadlessEngine } from './harness';

const SPAN = 12000;
const td = (a: number, b: number) => { const d = Math.abs(a - b) % SPAN; return Math.min(d, SPAN - d); };
const dist = (a: any, b: any) => Math.hypot(td(a.x, b.x), td(a.y, b.y));

const all = [
  ...OVERWORLD_STATIONS.map(s => ({ n: `station:${s.kind}`, x: s.x, y: s.y })),
  ...HUB_PORTAL_SITES.map(s => ({ n: s.targetId, x: s.x, y: s.y })),
  ...HUB_TEST_PORTAL_SITES.map(s => ({ n: s.targetId, x: s.x, y: s.y })),
];

test('hub holds 4 stations, 12 arena rifts and 8 field rifts, none overlapping', () => {
  assert.equal(OVERWORLD_STATIONS.length, 4);
  assert.equal(HUB_PORTAL_SITES.length, 12);
  assert.equal(HUB_TEST_PORTAL_SITES.length, 8);
  let min = Infinity, pair = '';
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
    const d = dist(all[i], all[j]);
    if (d < min) { min = d; pair = `${all[i].n} / ${all[j].n}`; }
  }
  assert.ok(min >= 900, `closest pair ${pair} only ${Math.round(min)} apart`);
});

test('every rift resolves; the three varieties of a map differ in level and ring', () => {
  for (const s of [...HUB_PORTAL_SITES, ...HUB_TEST_PORTAL_SITES]) assert.ok(mapDescriptor(s.targetId), s.targetId);
  for (const m of HUB_ARENA_VARIETIES) {
    const levels = m.ids.map(id => mapDescriptor(id)!.level!);
    assert.deepEqual([...levels].sort((a, b) => a - b), levels, `${m.base} levels rise easy to hard`);
    assert.equal(new Set(levels).size, 3);
    const radii = m.ids.map(id => { const s = HUB_PORTAL_SITES.find(p => p.targetId === id)!; return Math.round(Math.hypot(s.x, s.y) / 100); });
    assert.equal(new Set(radii).size, 3, `${m.base} sits on three different rings`);
  }
});

test('field rifts hug the home station and sit inside the first arena ring', () => {
  for (const s of HUB_TEST_PORTAL_SITES) {
    const r = Math.hypot(s.x, s.y);
    assert.ok(Math.abs(r - HUB_LAYOUT.FIELD_RADIUS) < 2 && r < HUB_LAYOUT.RING_RADII[0] - 1000);
  }
});

test('built hub: field rifts carry no gravity, arena rifts do', () => {
  const { engine } = createHeadlessEngine({}, 3);
  const portals = (engine as any).portals as any[];
  assert.equal(portals.length, 20);
  for (const p of portals) {
    const field = String(p.portalTargetId).startsWith('field_');
    assert.equal(!!p.gravityRange, !field, p.portalTargetId);
  }
});
