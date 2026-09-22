import { EntityType, GameEntity } from '../../types';
import { wrapDeltaX, wrapDeltaY } from '../toroidal';
import { EnergyEvent, ENERGY_LIMITS as L, materialOf, conductivity, safeEnergy } from './energyMaterial';

export interface EnergyHost {
  nearby(e: GameEntity, radius: number, visit: (e: GameEntity) => boolean | void): void;
  damage(e: GameEntity, amount: number, event: EnergyEvent): void;
  disperse(e: GameEntity, event: EnergyEvent): void;
  feedback(e: GameEntity, event: EnergyEvent, from?: GameEntity): void;
}
interface Heated { event: EnergyEvent; stressTime: number }
/** Sparse thermal state and instantaneous, iterative electrical traversal.
 * No map/entity list is retained or scanned. Clear on map/run transitions. */
export class EnergySystem {
  private heated = new Map<GameEntity, Heated>();
  constructor(private host: EnergyHost) {}
  get activeHeatedCount(): number { return this.heated.size; }
  clear(): void {
    for (const e of this.heated.keys()) e.materialHeat = undefined;
    this.heated.clear();
  }
  private heat(e: GameEntity, amount: number, event: EnergyEvent): void {
    if (!e.active || amount <= 0) return;
    if (!this.heated.has(e)) {
      // At saturation, reject new state rather than leave permanently hot
      // untracked objects or grow an unbounded per-frame workload.
      if (this.heated.size >= L.maxHeated) return;
      this.heated.set(e, { event, stressTime: 0 });
    }
    this.heated.get(e)!.event = event;
    e.materialHeat = Math.min(L.maxHeat, safeEnergy(e.materialHeat ?? 0) + amount);
  }
  /** Carry heat into existing fragment spawning without discovering children
   * by scanning the map. A fragment receives its area share of the heat. */
  inheritHeat(parent: GameEntity, child: GameEntity, fraction: number): void {
    const state = this.heated.get(parent);
    if (!state || !Number.isFinite(fraction)) return;
    const before = child.materialHeat ?? 0;
    this.heat(child, (parent.materialHeat ?? 0) * Math.max(0, Math.min(1, fraction)), state.event);
    // Detached heat is no longer in the surviving parent. Saturated active
    // state cannot manufacture or silently retain an untracked hot fragment.
    parent.materialHeat = Math.max(0, (parent.materialHeat ?? 0) - ((child.materialHeat ?? 0) - before));
    if (materialOf(child) === 'nebula' || materialOf(child) === 'plastic') child.nebulaMergeCooldown = 1.5;
  }
  deliver(e: GameEntity, raw: EnergyEvent, skipFirstElectricalDamage = false): void {
    const magnitude = safeEnergy(raw.magnitude);
    if ((!skipFirstElectricalDamage && (!e.active || e.isExploding)) || magnitude <= 0 || e.shardVariant === 'indestructible-tile') return;
    if (!['mechanical', 'thermal', 'electrical'].includes(raw.type)) return;
    if (!Number.isFinite(raw.position.x) || !Number.isFinite(raw.position.y)) return;
    const event = { ...raw, magnitude, position: { ...raw.position },
      direction: raw.direction && Number.isFinite(raw.direction.x) && Number.isFinite(raw.direction.y)
        ? { x: Math.max(-10000, Math.min(10000, raw.direction.x)), y: Math.max(-10000, Math.min(10000, raw.direction.y)) } : undefined };
    const m = materialOf(e);
    if (event.type === 'electrical') { this.electrical(e, event, skipFirstElectricalDamage); return; }
    this.host.feedback(e, event);
    if (event.type === 'mechanical') {
      if (m === 'nebula') this.host.disperse(e, event);
      else this.host.damage(e, magnitude, event);
      return;
    }
    this.heat(e, magnitude * L.heatPerEnergy, event);
    if (m === 'nebula') this.host.disperse(e, event);
    // Conduction is a small, conservative fan at deposition time, not a
    // recursive heat tick. The source pays every unit its neighbours get.
    if (m === 'metal') {
      let count = 0;
      const seen = new Set<GameEntity>([e]);
      this.host.nearby(e, L.conductionRadius, n => {
        if (count >= L.conductionTargets) return false;
        if (!seen.has(n) && n.active && materialOf(n) === 'metal') {
          seen.add(n); count++;
          const transfer = Math.min(e.materialHeat ?? 0, magnitude * 0.3);
          const before = n.materialHeat ?? 0;
          this.heat(n, transfer, event);
          e.materialHeat = Math.max(0, (e.materialHeat ?? 0) - ((n.materialHeat ?? 0) - before));
        }
      });
    }
  }
  update(rawDt: number): void {
    const dt = Number.isFinite(rawDt) ? Math.max(0, Math.min(0.1, rawDt)) : 0;
    if (dt === 0) return;
    for (const [e, state] of this.heated) {
      if (!e.active || e.isExploding) { e.materialHeat = undefined; this.heated.delete(e); continue; }
      e.materialHeat = Math.max(0, safeEnergy(e.materialHeat ?? 0) - L.cooling * dt);
      const m = materialOf(e);
      if (m === 'glass' && e.materialHeat >= L.glassStress) {
        state.stressTime += dt;
        if (state.stressTime >= L.glassDelay) {
          // Sustained thermal stress breaks boundaries quietly, even after
          // the beam stopped. No simultaneous mechanical hit is required.
          this.host.damage(e, (e.materialHeat - L.glassStress + 10) * dt, state.event);
        }
      } else state.stressTime = 0;
      if (m === 'plastic' && e.materialHeat >= L.plasticRelease) {
        // Cohesion releases first. Slow grain separation also frees pieces
        // from static plastic, which cannot move until its seams let go.
        this.host.damage(e, 3 * dt, state.event);
      }
      if ((e.materialHeat ?? 0) <= L.negligibleHeat) {
        e.materialHeat = undefined; this.heated.delete(e);
      }
    }
  }
  private electrical(first: GameEntity, event: EnergyEvent, skipFirstDamage: boolean): void {
    const limit = (value: number | undefined, fallback: number, max: number) =>
      value === undefined || !Number.isFinite(value) ? fallback : Math.max(0, Math.min(max, value));
    const hops = Math.floor(limit(event.delivery?.chainHops, L.hops, L.hops));
    const radius = limit(event.delivery?.chainRadius, L.hopRadius, L.hopRadius);
    const branchLimit = Math.floor(limit(event.delivery?.chainBranches, 2, 3));
    const visited = new Set<GameEntity>([first]);
    const queue = [{ e: first, depth: 0, amount: event.magnitude, from: undefined as GameEntity | undefined }];
    for (let i = 0; i < queue.length && i < L.targets; i++) {
      const node = queue[i], e = node.e;
      const c = conductivity(e);
      const hit = { ...event, magnitude: node.amount, position: node.from ? { ...node.from.position } : event.position };
      this.host.feedback(e, hit, node.from);
      if (materialOf(e) === 'nebula') {
        this.heat(e, node.amount * 2, hit); // transient agitation, cools out
        this.host.disperse(e, hit);
      } else if (i !== 0 || !skipFirstDamage) this.host.damage(e, node.amount * c, hit);
      if (c < 0.4 || node.depth >= hops || visited.size >= L.targets) continue;
      let branches = 0;
      this.host.nearby(e, radius, n => {
        if (visited.size >= L.targets || branches >= branchLimit) return false;
        if (!n.active || n.isExploding || visited.has(n) || n.shardVariant === 'indestructible-tile') return;
        if (n.type !== EntityType.STRUCTURE && n.type !== EntityType.ENEMY) return;
        if (conductivity(n) < 0.4) return;
        const dx = wrapDeltaX(first.position.x, n.position.x), dy = wrapDeltaY(first.position.y, n.position.y);
        if (dx * dx + dy * dy > L.totalRadius ** 2) return;
        visited.add(n); branches++;
        queue.push({ e: n, depth: node.depth + 1, amount: node.amount * L.attenuation * c, from: e });
      });
    }
  }
}
