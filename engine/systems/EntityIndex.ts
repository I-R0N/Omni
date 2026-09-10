import { GameEntity, EntityType } from '../../types';
import { isVisibleOnTorus } from '../toroidal';
import { getCollisionR } from '../entityCache';

/**
 * Camera-aligned viewport rectangle in world coordinates.  Set once
 * per frame by GameEngine before any system that needs visibility
 * partitioning runs.  Coords are unwrapped — toroidal containment is
 * resolved through `isVisibleOnTorus`.
 */
export interface ViewportRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/**
 * EntityIndex — type-filtered candidate lists rebuilt once per sim step.
 *
 * Phase 4 of the engine upgrade.  Multiple systems used to scan the master
 * entity list independently ("find all active enemies", "find all
 * projectiles", "find all mobile shards for gravity"), each a full O(N) walk.
 * EntityIndex performs a single O(N) classification pass and exposes the
 * filtered slices so every downstream consumer stays O(matches) instead
 * of O(all entities).
 *
 * Callers are expected to call {@link rebuild} at the start of each sim
 * step (via GameEngine.prepareFrameEntities).  The lists mutate in place
 * on every rebuild, so consumers must NOT cache them across calls.
 */
export class EntityIndex {
  /** Active enemies (ships, shooters, rammers). */
  public enemies: GameEntity[] = [];

  /** Active projectiles (both player- and enemy-owned). */
  public projectiles: GameEntity[] = [];

  /**
   * Active mobile shards — every finite-mass STRUCTURE that isn't a
   * dragon body segment.  ONE list, one name (voronoi gauntlet V6): the
   * legacy `asteroids` slice was byte-identical to this from the day the
   * EntityType collapse landed — "asteroid" only ever meant "a large
   * rock-shard spawned at map load" — so its consumers (gravity, homing,
   * the roamer food scans, ShardSystem's merge broadphase) all read this
   * list now.
   */
  public shardCandidates: GameEntity[] = [];

  // ── Count-only snapshots (no list alloc) ─────────────────────────────────
  // Updated alongside the filtered lists above so the dev perf overlay can
  // chart per-type accumulation without a second O(N) walk every frame.
  // Particles and interactables are the two largest late-wave contributors
  // outside the enemy/asteroid/projectile trio, so they're tracked here
  // even though no downstream system needs full lists for them.
  public particleCount: number = 0;
  public interactableCount: number = 0;
  /** Total active entities (all types, including types we don't list). */
  public activeCount: number = 0;

  // ── Viewport rect (set per frame by GameEngine) ─────────────────────────
  // Used by `isOffscreen` for graceful-cleanup priority decisions —
  // offscreen shards are preferred candidates for retirement so the
  // player never sees a shard pop out of existence.  Null until the
  // first frame that calls setViewportRect (GameEngine wires this in
  // prepareFrameEntities); callers should treat null as "everything
  // counts as on-screen" so cleanup falls back to its non-priority path.
  private viewportRect: ViewportRect | null = null;

  /** Update the per-frame viewport rect.  Reused buffer is fine — the
   *  rect's contents are read synchronously inside the same frame. */
  public setViewportRect(rect: ViewportRect): void {
    this.viewportRect = rect;
  }

  public clearViewportRect(): void {
    this.viewportRect = null;
  }

  /**
   * Torus-aware "is this entity offscreen" check.  Wraps `isVisibleOnTorus`
   * so the renderer's seam-crossing visibility logic and the cleanup
   * priority logic agree.  Returns true when the entity (and every
   * wrapped copy) sits outside the current viewport rect.
   *
   * Returns false when no viewport rect is set so callers default to
   * the conservative "treat as on-screen" branch.
   */
  public isOffscreen(entity: GameEntity): boolean {
    const rect = this.viewportRect;
    if (!rect) return false;
    const r = getCollisionR(entity);
    return !isVisibleOnTorus(
      entity.position.x, entity.position.y, r,
      rect.left, rect.right, rect.top, rect.bottom,
    );
  }

  /**
   * Rebuild all filtered lists from the master entity array.  Inactive
   * entities are skipped so downstream consumers don't need to re-check
   * `active` on the fast path.
   */
  public rebuild(entities: GameEntity[]) {
    // Index-filled with explicit counters rather than `length = 0` + push —
    // see the REFILL IDIOM note in GameEngine.prepareFrameEntities for why
    // that idiom allocates.  Four lists rebuilt once per sim substep (120 Hz)
    // made this the fifth-largest allocator in the engine.  Same contents,
    // same lengths, same order.
    const enemies = this.enemies;
    const projectiles = this.projectiles, shardCandidates = this.shardCandidates;
    let nEne = 0, nPrj = 0, nShard = 0;
    this.particleCount = 0;
    this.interactableCount = 0;
    this.activeCount = 0;

    for (let i = 0; i < entities.length; i++) {
      const e = entities[i];
      if (!e.active) continue;
      this.activeCount++;
      switch (e.type) {
        case EntityType.ENEMY:
          enemies[nEne++] = e;
          break;
        case EntityType.STRUCTURE:
          // Mobile shards only — static tiles (mass = Infinity) live
          // in PhysicsSystem.staticGrid and aren't merge candidates.  Dragon
          // body segments (Stage 6) are chain-controlled, so they're kept OUT of
          // the shard indices (ShardSystem / flow-drift / consume ignore them).
          if (e.mass !== Infinity && e.dragonSegment !== true) {
            shardCandidates[nShard++] = e;
          }
          break;
        case EntityType.PROJECTILE:
          projectiles[nPrj++] = e;
          break;
        case EntityType.PARTICLE:
          this.particleCount++;
          break;
        case EntityType.INTERACTABLE:
          this.interactableCount++;
          break;
      }
    }

    // Truncate only on an actual shrink; in steady state these are no-ops.
    if (enemies.length !== nEne) enemies.length = nEne;
    if (projectiles.length !== nPrj) projectiles.length = nPrj;
    if (shardCandidates.length !== nShard) shardCandidates.length = nShard;
  }

  /** Clear all lists — used when loading a map / restarting. */
  public clear() {
    this.enemies.length = 0;
    this.projectiles.length = 0;
    this.shardCandidates.length = 0;
    this.particleCount = 0;
    this.interactableCount = 0;
    this.activeCount = 0;
  }
}
