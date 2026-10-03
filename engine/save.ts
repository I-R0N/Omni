/**
 * save.ts — THE SAVE FILE (engine-core plan, S2 gameplay PR).
 *
 * Pure: parse, validate, migrate, serialize.  No storage access (the engine
 * reads and writes through the `Storage` port), no engine imports beyond the
 * module catalog it validates ids against, so it runs in the headless harness
 * and is testable without a browser.
 *
 * WHAT IS IN IT (D20, user calls):
 *   character — credits, cargo, the INSTALLED loadout, purchased hex-slot counts
 *   wreck     — the outstanding death wreck, if any (D10)
 *   records   — bests and lifetime counters (D-S2-a)
 *   settings  — audio, control scheme, difficulty (D-S2-f)
 * and nothing about any arena's world: arenas regenerate per entry (D8), the
 * hub regenerates from a fixed seed (zero bytes), and a wreck pins ONE arena's
 * seed so S1's seeded generation rebuilds its terrain.  No sim state, no rng
 * state, no replay: suspending a run is "pause only" (D21) because a replay is
 * not a safe save format across JS engines (D17).
 *
 * VERSION POLICY (D-S2-e, user call): a `version` integer and a chain of
 * one-step MIGRATIONS.  S6's map graph will arrive after players hold saves;
 * adding a field is a migration function, not a wipe.  A save from a NEWER
 * build or one that is not parseable is never overwritten silently: the engine
 * keeps its raw text under `SAVE_BACKUP_KEY` and starts fresh.
 */
import { MODULE_DEFS, MODULE_SLOT_COUNT, INVENTORY_CAPACITY, MODULE_SLOT_UNLOCK } from '../constants';
import type { ControlScheme } from '../types';

export const SAVE_KEY = 'omni.save';
/** Where an unreadable save's raw text is parked before a fresh one is begun. */
export const SAVE_BACKUP_KEY = 'omni.save.unreadable';
export const SAVE_VERSION = 1;

export interface WreckRecord {
  /** MAP_DESCRIPTORS id of the map the ship fell in (the hub's, or an arena's). */
  arenaId: string;
  /** The arena's seed, pinned until the wreck is recovered or lost; null for
   *  the hub, which carries none (D8). */
  seed: number | null;
  x: number;
  y: number;
  /** What was MOUNTED, slot for slot, minus the free items (cost 0) that every
   *  ship restarts with.  No expiry: a wreck is lost on a second death (D10). */
  ship: (string | null)[];
  weapon: (string | null)[];
}

export interface Records {
  highScore: number;
  bestWave: number;
  bestCombo: number;
  bossesKilled: number;
  dragonsKilled: number;
  deaths: number;
}

export interface Settings {
  volume: number;
  sfxVolume: number;
  musicVolume: number;
  muted: boolean;
  controlScheme: ControlScheme | null;
  difficulty: number;
}

export interface CharacterSave {
  credits: number;
  inventory: (string | null)[];
  shipSlots: (string | null)[];
  weaponSlots: (string | null)[];
  shipSlotsUnlocked: number;
  weaponSlotsUnlocked: number;
}

export interface SaveFile {
  version: number;
  character: CharacterSave;
  wreck: WreckRecord | null;
  records: Records;
  settings: Settings;
}

export type SaveStatus = 'fresh' | 'loaded' | 'migrated' | 'unreadable' | 'future';

export function emptyRecords(): Records {
  return { highScore: 0, bestWave: 0, bestCombo: 1, bossesKilled: 0, dragonsKilled: 0, deaths: 0 };
}

export function emptySettings(): Settings {
  return { volume: 0.7, sfxVolume: 1, musicVolume: 1, muted: false, controlScheme: null, difficulty: 3 };
}

/** The lean start: free Base Hull and Projector, empty cargo, no credits. */
export function emptyCharacter(): CharacterSave {
  const ship: (string | null)[] = new Array(MODULE_SLOT_COUNT).fill(null);
  const weapon: (string | null)[] = new Array(MODULE_SLOT_COUNT).fill(null);
  ship[0] = 'hull_base';
  weapon[0] = 'dlv_projectile';
  return {
    credits: 0,
    inventory: new Array(INVENTORY_CAPACITY).fill(null),
    shipSlots: ship,
    weaponSlots: weapon,
    shipSlotsUnlocked: MODULE_SLOT_UNLOCK.START,
    weaponSlotsUnlocked: MODULE_SLOT_UNLOCK.START,
  };
}

export function emptySave(): SaveFile {
  return { version: SAVE_VERSION, character: emptyCharacter(), wreck: null, records: emptyRecords(), settings: emptySettings() };
}

// ── migrations ──────────────────────────────────────────────────────────

/** `MIGRATIONS[n]` upgrades a version-n document to n + 1, on plain JSON.
 *  Empty today: version 1 is the first format.  The first format change adds
 *  `MIGRATIONS[1]` and bumps SAVE_VERSION; the rest of this file does not move. */
export const MIGRATIONS: Record<number, (doc: Record<string, unknown>) => Record<string, unknown>> = {};

// ── validation ──────────────────────────────────────────────────────────

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown, d: number, lo = -Infinity, hi = Infinity): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d;
const int = (v: unknown, d: number, lo: number, hi: number): number => Math.round(num(v, d, lo, hi));

const KNOWN = new Set(MODULE_DEFS.map((m) => m.id));
function slots(v: unknown, len: number, fallback: (string | null)[]): (string | null)[] {
  if (!Array.isArray(v)) return fallback.slice();
  const out: (string | null)[] = new Array(len).fill(null);
  for (let i = 0; i < len; i++) {
    const id = v[i];
    // A module this build no longer ships is dropped, not carried as a ghost.
    out[i] = typeof id === 'string' && KNOWN.has(id) ? id : null;
  }
  return out;
}

function validCharacter(raw: unknown): CharacterSave {
  const d = emptyCharacter();
  if (!isObj(raw)) return d;
  return {
    credits: int(raw.credits, 0, 0, 1e9),
    inventory: slots(raw.inventory, INVENTORY_CAPACITY, d.inventory),
    shipSlots: slots(raw.shipSlots, MODULE_SLOT_COUNT, d.shipSlots),
    weaponSlots: slots(raw.weaponSlots, MODULE_SLOT_COUNT, d.weaponSlots),
    shipSlotsUnlocked: int(raw.shipSlotsUnlocked, d.shipSlotsUnlocked, 1, MODULE_SLOT_UNLOCK.MAX),
    weaponSlotsUnlocked: int(raw.weaponSlotsUnlocked, d.weaponSlotsUnlocked, 1, MODULE_SLOT_UNLOCK.MAX),
  };
}

function validWreck(raw: unknown): WreckRecord | null {
  if (!isObj(raw) || typeof raw.arenaId !== 'string' || raw.arenaId === '') return null;
  const ship = slots(raw.ship, MODULE_SLOT_COUNT, []);
  const weapon = slots(raw.weapon, MODULE_SLOT_COUNT, []);
  // A wreck that holds nothing is not a wreck.
  if (!ship.some(Boolean) && !weapon.some(Boolean)) return null;
  return {
    arenaId: raw.arenaId,
    seed: raw.seed === null || raw.seed === undefined ? null : (num(raw.seed, 0, 0, 0xffffffff) >>> 0),
    x: num(raw.x, 0), y: num(raw.y, 0),
    ship, weapon,
  };
}

function validRecords(raw: unknown): Records {
  const d = emptyRecords();
  if (!isObj(raw)) return d;
  return {
    highScore: int(raw.highScore, 0, 0, 1e12),
    bestWave: int(raw.bestWave, 0, 0, 1e6),
    bestCombo: int(raw.bestCombo, 1, 1, 1e6),
    bossesKilled: int(raw.bossesKilled, 0, 0, 1e9),
    dragonsKilled: int(raw.dragonsKilled, 0, 0, 1e9),
    deaths: int(raw.deaths, 0, 0, 1e9),
  };
}

const SCHEMES = new Set(['touch', 'joystick-left', 'joystick-right', 'keyboard', 'gamepad', 'gamepad-thrust', 'gamepad-left']);
function validSettings(raw: unknown): Settings {
  const d = emptySettings();
  if (!isObj(raw)) return d;
  return {
    volume: num(raw.volume, d.volume, 0, 1),
    sfxVolume: num(raw.sfxVolume, d.sfxVolume, 0, 1),
    musicVolume: num(raw.musicVolume, d.musicVolume, 0, 1),
    muted: raw.muted === true,
    controlScheme: typeof raw.controlScheme === 'string' && SCHEMES.has(raw.controlScheme) ? (raw.controlScheme as ControlScheme) : null,
    difficulty: int(raw.difficulty, d.difficulty, 0, 3),
  };
}

/** Fold a parsed document of the CURRENT version into a SaveFile, repairing
 *  field by field — a bad field costs that field, never the whole save. */
export function validateSave(doc: Json, version = SAVE_VERSION): SaveFile {
  return {
    version,
    character: validCharacter(doc.character),
    wreck: validWreck(doc.wreck),
    records: validRecords(doc.records),
    settings: validSettings(doc.settings),
  };
}

export interface ParsedSave { save: SaveFile; status: SaveStatus; }

/** Read raw storage text.  `fresh` = nothing there; `unreadable` / `future`
 *  hand back an empty save and leave the CALLER to park the raw text. */
export function parseSave(
  raw: string | null,
  /** The format this build writes, and the migrations that reach it —
   *  parameters so a test can stand a future format in front of the chain. */
  current = SAVE_VERSION,
  migrations: Record<number, (doc: Record<string, unknown>) => Record<string, unknown>> = MIGRATIONS,
): ParsedSave {
  if (raw === null || raw === '') return { save: emptySave(), status: 'fresh' };
  let doc: unknown;
  try { doc = JSON.parse(raw); } catch { return { save: emptySave(), status: 'unreadable' }; }
  if (!isObj(doc) || typeof doc.version !== 'number' || !Number.isInteger(doc.version) || doc.version < 1) {
    return { save: emptySave(), status: 'unreadable' };
  }
  if (doc.version > current) return { save: emptySave(), status: 'future' };
  let cur: Json = doc;
  let v = doc.version;
  let migrated = false;
  while (v < current) {
    const step = migrations[v];
    if (!step) return { save: emptySave(), status: 'unreadable' };
    cur = step(cur);
    v++;
    migrated = true;
  }
  return { save: validateSave(cur, current), status: migrated ? 'migrated' : 'loaded' };
}

export function serializeSave(s: SaveFile): string {
  return JSON.stringify(s);
}
