// ── Entity serialisation for network snapshots ──────────────────────────────
// Converts GameEntity instances to/from a compact JSON-friendly shape.  Field
// names are short (1-3 chars) to keep the wire payload small even in JSON.
//
// Phase 1 sends a full snapshot every tick — no delta compression.  Phase 2
// will add a per-field dirty bitmap and a binary packer.

import { GameEntity, EntityType, EnemySubtype, WeaponType, Vector2, DamageText, WaveAnnouncement, GameState, MapType } from '../../types';

export interface SerializedEntity {
  id: string;
  t: EntityType;
  x: number; y: number;
  vx: number; vy: number;
  r: number;           // rotation (radians)
  sx: number; sy: number;
  c: string;           // color
  a: boolean;          // active
  h: number; mh: number;
  m?: number;          // mass
  sp?: string;         // sprite URL
  ex?: boolean;        // isExploding
  et?: number;         // explosionTimer
  hf?: number;         // hitFlash
  sh?: number; msh?: number; shf?: number;
  es?: EnemySubtype;
  ais?: string;
  cw?: WeaponType;
  dmg?: number;
  ot?: EntityType;     // ownerType (projectile)
  dt?: 'ammo' | 'health' | 'glass';
  dv?: number;
  dw?: WeaponType;
  pp?: number[];       // polygon points (flattened)
  lt?: number; mlt?: number;
  rp?: number;         // regenProgress
  rpt?: number;        // regenPopTimer
  st?: 'asteroid' | 'tile';
  pgc?: string;        // powerupGlowColor
  rs?: number;         // rotationSpeed
  it?: Vector2;        // inputVector (debug)
}

export interface SerializedDamageText {
  id: string;
  x: number; y: number;
  text: string;
  vx: number; vy: number;
  lt: number; mlt: number;
  c: string;
}

export interface SerializedWaveAnnouncement {
  text: string;
  sub?: string;
  c: string;
  lt: number;
  mlt: number;
}

// Per-client player UI state.  Rendered by the client's existing UIOverlay.
export interface SerializedPlayerStats {
  gameState: GameState;
  mapType: MapType;
  mapName: string;
  currentWeapon: WeaponType;
  weaponCount: number;
  waveNumber: number;
  waveStatus: 'active' | 'cleared' | 'complete';
  waveGraceTimer?: number;
  difficulty: number;
  health: number;
  maxHealth: number;
  shield?: number;
  maxShield?: number;
  ammo?: Partial<Record<WeaponType, number>>;
}

// ── Serialisation ───────────────────────────────────────────────────────────

export function serializeEntity(e: GameEntity): SerializedEntity {
  const s: SerializedEntity = {
    id: e.id,
    t: e.type,
    x: e.position.x, y: e.position.y,
    vx: e.velocity.x, vy: e.velocity.y,
    r: e.rotation,
    sx: e.size.x, sy: e.size.y,
    c: e.color,
    a: e.active,
    h: e.health,
    mh: e.maxHealth,
  };
  if (e.mass !== undefined) s.m = e.mass;
  if (e.sprite !== undefined) s.sp = e.sprite;
  if (e.isExploding) s.ex = true;
  if (e.explosionTimer !== undefined) s.et = e.explosionTimer;
  if (e.hitFlash !== undefined) s.hf = e.hitFlash;
  if (e.shield !== undefined) s.sh = e.shield;
  if (e.maxShield !== undefined) s.msh = e.maxShield;
  if (e.shieldHitFlash !== undefined) s.shf = e.shieldHitFlash;
  if (e.enemySubtype !== undefined) s.es = e.enemySubtype;
  if (e.aiState !== undefined) s.ais = e.aiState;
  if (e.currentWeapon !== undefined) s.cw = e.currentWeapon;
  if (e.damage !== undefined) s.dmg = e.damage;
  if (e.ownerType !== undefined) s.ot = e.ownerType;
  if (e.dropType !== undefined) s.dt = e.dropType;
  if (e.dropValue !== undefined) s.dv = e.dropValue;
  if (e.dropWeapon !== undefined) s.dw = e.dropWeapon;
  if (e.polygonPoints !== undefined) {
    const pp: number[] = new Array(e.polygonPoints.length * 2);
    for (let i = 0; i < e.polygonPoints.length; i++) {
      pp[i * 2]     = e.polygonPoints[i].x;
      pp[i * 2 + 1] = e.polygonPoints[i].y;
    }
    s.pp = pp;
  }
  if (e.lifetime !== undefined) s.lt = e.lifetime;
  if (e.maxLifetime !== undefined) s.mlt = e.maxLifetime;
  if (e.regenProgress !== undefined) s.rp = e.regenProgress;
  if (e.regenPopTimer !== undefined) s.rpt = e.regenPopTimer;
  if (e.shardType !== undefined) s.st = e.shardType;
  if (e.powerupGlowColor !== undefined) s.pgc = e.powerupGlowColor;
  if (e.rotationSpeed !== undefined) s.rs = e.rotationSpeed;
  if (e.inputVector !== undefined) s.it = { x: e.inputVector.x, y: e.inputVector.y };
  return s;
}

/**
 * Deserialise into a new entity or mutate an existing one in-place.  In-place
 * mutation is preferred (reuses trail arrays and polygon buffers) so that the
 * renderer's per-frame entity pointers stay stable across ticks.
 */
export function applySerializedEntity(s: SerializedEntity, prev: GameEntity | undefined): GameEntity {
  const e: GameEntity = prev ?? {
    id: s.id,
    type: s.t,
    position: { x: 0, y: 0 },
    velocity: { x: 0, y: 0 },
    size: { x: 0, y: 0 },
    rotation: 0,
    color: s.c,
    active: true,
    health: s.h,
    maxHealth: s.mh,
    mass: s.m ?? 1,
  };

  e.type = s.t;
  e.position.x = s.x; e.position.y = s.y;
  e.velocity.x = s.vx; e.velocity.y = s.vy;
  e.rotation = s.r;
  e.size.x = s.sx; e.size.y = s.sy;
  e.color = s.c;
  e.active = s.a;
  e.health = s.h;
  e.maxHealth = s.mh;
  if (s.m !== undefined) e.mass = s.m;
  e.sprite = s.sp;
  e.isExploding = s.ex;
  e.explosionTimer = s.et;
  e.hitFlash = s.hf;
  e.shield = s.sh;
  e.maxShield = s.msh;
  e.shieldHitFlash = s.shf;
  e.enemySubtype = s.es;
  e.aiState = s.ais as GameEntity['aiState'];
  e.currentWeapon = s.cw;
  e.damage = s.dmg;
  e.ownerType = s.ot;
  e.dropType = s.dt;
  e.dropValue = s.dv;
  e.dropWeapon = s.dw;
  if (s.pp) {
    const n = s.pp.length / 2;
    if (!e.polygonPoints || e.polygonPoints.length !== n) {
      e.polygonPoints = new Array(n);
      for (let i = 0; i < n; i++) e.polygonPoints[i] = { x: 0, y: 0 };
    }
    for (let i = 0; i < n; i++) {
      e.polygonPoints[i].x = s.pp[i * 2];
      e.polygonPoints[i].y = s.pp[i * 2 + 1];
    }
  } else {
    e.polygonPoints = undefined;
  }
  e.lifetime = s.lt;
  e.maxLifetime = s.mlt;
  e.regenProgress = s.rp;
  e.regenPopTimer = s.rpt;
  e.shardType = s.st;
  e.powerupGlowColor = s.pgc;
  e.rotationSpeed = s.rs;
  if (s.it) {
    e.inputVector = { x: s.it.x, y: s.it.y };
  } else {
    e.inputVector = undefined;
  }
  return e;
}

export function serializeDamageText(d: DamageText): SerializedDamageText {
  return {
    id: d.id,
    x: d.position.x, y: d.position.y,
    text: d.text,
    vx: d.velocity.x, vy: d.velocity.y,
    lt: d.lifetime, mlt: d.maxLifetime,
    c: d.color,
  };
}

export function deserializeDamageText(s: SerializedDamageText): DamageText {
  return {
    id: s.id,
    position: { x: s.x, y: s.y },
    text: s.text,
    velocity: { x: s.vx, y: s.vy },
    lifetime: s.lt,
    maxLifetime: s.mlt,
    color: s.c,
    active: true,
  };
}

export function serializeWaveAnnouncement(w: WaveAnnouncement): SerializedWaveAnnouncement {
  return {
    text: w.text,
    sub: w.subtext,
    c: w.color,
    lt: w.lifetime,
    mlt: w.maxLifetime,
  };
}

export function deserializeWaveAnnouncement(s: SerializedWaveAnnouncement): WaveAnnouncement {
  return {
    text: s.text,
    subtext: s.sub,
    color: s.c,
    lifetime: s.lt,
    maxLifetime: s.mlt,
  };
}
