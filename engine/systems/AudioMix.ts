/** Mix policy shared by the registry and player. No entity dependencies. */
export type AudioBus = 'world' | 'feedback' | 'ui' | 'music';
export const AUDIO_MIX = {
  world: 0.78, feedback: 1, ui: 0.72, music: 0.75,
  gainVariation: 0.035,
  release: 0.06,
  duckGain: 0.58,
  duckRelease: 0.32,
  variants: 3,
} as const;

export function busFor(id: string, tier: number): AudioBus {
  if (/^(wave\.|boss\.(intro|death)$)/.test(id)) return 'music';
  if (/^(ui\.|poi\.(?!station)|portal.transit$|destroy.player$)/.test(id)) return 'ui';
  return tier === 1 ? 'feedback' : 'world';
}

export function survivesPause(id: string): boolean {
  return /^(ui\.|poi\.(?!station)|portal.transit$|destroy.player$|boss\.(intro|death)$|wave\.)/.test(id);
}

export function ducksWorld(id: string): boolean {
  return /^(impact.hull.player|impact.shield.break|destroy.player|boss\.|pickup.health|status.disable.apply)/.test(id);
}
