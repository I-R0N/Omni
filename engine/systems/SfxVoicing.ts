import { noise, tone, type SfxDef, type SynthCtx } from './AudioSystem';

/** Production finishing for the authored event recipes. Existing recordings
 * retain their own character. Added layers are baked into cached variations. */
export function finishVoice(id: string, def: SfxDef): SfxDef {
  const original = def.render;
  const render = (s: SynthCtx) => {
    const end = original(s);
    const stagger = 0.008 + Math.random() * 0.008;
    if (/^(destroy\.|impact.explosion)/.test(id)) {
      // Weight, then a quiet debris aftershock. Material frequency keeps
      // glass brittle, metal dense, rock granular and nebula breathy.
      const small = /shard|small|nebula/.test(id);
      const frequency = /glass/.test(id) ? 1150 : /metal/.test(id) ? 430 : 650;
      return Math.max(end,
        tone(s, { f0: small ? 135 : 82, f1: small ? 75 : 43,
          attack: 0.003, decay: small ? 0.07 : 0.19, gain: small ? 0.06 : 0.13 }),
        noise(s, { f0: frequency, f1: frequency * 0.55, q: 0.7,
          attack: 0.005, decay: small ? 0.07 : 0.18,
          gain: small ? 0.045 : 0.075, delay: stagger + (small ? 0.025 : 0.06) }));
    }
    if (/^(impact\.|crash\.|move\.(dent|tilesnap|merge))/.test(id)) {
      return Math.max(end, noise(s, { f0: /glass/.test(id) ? 1500 : 700,
        f1: 280, q: 0.65, attack: 0.0015, decay: 0.045, gain: 0.08, delay: stagger }));
    }
    if (/^(ui\.|poi\.(?!station)|pickup\.)/.test(id)) {
      // Tactile contact beneath each authored melodic/selector gesture.
      return Math.max(end, noise(s, { f0: 950, f1: 430, q: 0.6,
        attack: 0.001, decay: 0.023, gain: 0.045 }));
    }
    if (/^(portal\.|wave\.|boss\.|dragon\.|rival.warp)/.test(id)) {
      return Math.max(end, noise(s, { f0: 240, f1: 1300, q: 0.65,
        attack: 0.05, decay: Math.min(0.45, end * 0.45), gain: 0.075 }),
        tone(s, { f0: 110, f1: 55, attack: 0.008, decay: 0.2, gain: 0.08 }));
    }
    if (/^(status\.|bubble\.|snitch\.)/.test(id)) {
      return Math.max(end, tone(s, { type: 'triangle', f0: 180, f1: 105,
        attack: 0.005, decay: 0.065, gain: 0.07, delay: stagger }));
    }
    return end;
  };
  return { ...def, render };
}
