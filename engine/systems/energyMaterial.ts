import type { GameEntity, Vector2 } from '../../types';

export type EnergyType = 'mechanical' | 'thermal' | 'electrical';
export type MaterialFamily = 'rock' | 'glass' | 'metal' | 'plastic' | 'nebula' | 'unknown';
/** Delivery is metadata, never the material-response selector. Magnitude is
 * in the existing impact-energy units; kinetic callers keep their KE model. */
export interface EnergyEvent {
  type: EnergyType;
  magnitude: number;
  position: Vector2;
  direction?: Vector2;
  source?: string;
  playerOwned?: boolean;
  delivery?: { kind: 'projectile' | 'beam' | 'area' | 'collision'; mass?: number; velocity?: Vector2; radius?: number; duration?: number; chainHops?: number; chainRadius?: number; chainBranches?: number };
}
export interface FractureProfile { sites: number; bias: number; impulse: number }
export const ENERGY_LIMITS = {
  maxHeat: 100, negligibleHeat: 0.05, maxHeated: 512,
  heatPerEnergy: 4, cooling: 5, glassStress: 25, glassDelay: 0.35,
  plasticRelease: 18, conductionRadius: 100, conductionTargets: 4,
  hops: 3, targets: 12, hopRadius: 150, totalRadius: 360, attenuation: 0.6,
} as const;
export function safeEnergy(n: number): number {
  return Number.isFinite(n) ? Math.max(0, Math.min(10000, n)) : 0;
}
export function materialOf(e: Pick<GameEntity, 'shardVariant' | 'material'>): MaterialFamily {
  const m = e.material ?? e.shardVariant ?? '';
  // This is read in the existing bond loop: no split()/array allocation.
  if (m === 'rock' || m.startsWith('rock-')) return 'rock';
  if (m === 'glass' || m.startsWith('glass-')) return 'glass';
  if (m === 'metal' || m.startsWith('metal-')) return 'metal';
  if (m === 'plastic' || m.startsWith('plastic-')) return 'plastic';
  if (m === 'nebula' || m.startsWith('nebula-')) return 'nebula';
  return 'unknown';
}
export function conductivity(e: GameEntity): number {
  switch (materialOf(e)) {
    case 'metal': return 1;
    case 'nebula': return 0.75;
    case 'rock': return 0.08;
    case 'glass': return 0.025;
    case 'plastic': return 0.01;
    default: return e.shardVariant ? 0.1 : 0.5;
  }
}
/** Existing cold mechanical tuning is unchanged; heat makes each unit of
 * work break more boundary. No HP regeneration or seam-cache invalidation. */
export function thermalStrength(e: GameEntity): number {
  const h = safeEnergy(e.materialHeat ?? 0);
  switch (materialOf(e)) {
    case 'metal': return Math.max(0.3, 1 - h * 0.01);
    case 'rock': return Math.max(0.4, 1 - h * 0.008);
    case 'glass': return Math.max(0.5, 1 - h * 0.006);
    case 'plastic': return Math.max(0.2, 1 - h * 0.025);
    default: return 1;
  }
}
export function cohesionFor(e: GameEntity): number {
  const m = materialOf(e);
  if (m === 'plastic') return Math.max(0, 1 - safeEnergy(e.materialHeat ?? 0) / ENERGY_LIMITS.plasticRelease);
  if (m === 'nebula') return Math.max(0, 1 - safeEnergy(e.materialHeat ?? 0) / 12);
  return 1;
}
/** Relative to the authored material grain model. Mechanical identities
 * already live there; thermal glass deliberately uses coarser, quieter seams. */
export function fractureProfile(e: Pick<GameEntity, 'material' | 'shardVariant' | 'fractureEnergy'>, type: EnergyType = e.fractureEnergy ?? 'mechanical'): FractureProfile {
  const m = materialOf(e);
  if (type === 'thermal') return { sites: m === 'glass' ? 0.4 : 0.65, bias: 0.1, impulse: 0.18 };
  if (m === 'glass') return { sites: 1.4, bias: 0.75, impulse: 1.35 };
  if (m === 'metal') return { sites: 0.3, bias: 0.35, impulse: 0.55 };
  return { sites: 1, bias: m === 'rock' ? 0.75 : 0.5, impulse: 1 };
}

/** Coarser metal should not become a weaker wall just because it has less
 * total seam length. Length scales with sqrt(site count), so compensate
 * boundary strength by the inverse scale; kinetic/collision energy is untouched. */
export function fractureToughness(e: Pick<GameEntity, 'material' | 'shardVariant'>): number {
  return materialOf(e) === 'metal' ? 1 / Math.sqrt(fractureProfile(e, 'mechanical').sites) : 1;
}
