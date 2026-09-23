/** ENERGY FEEDBACK — the world-space layer for the energy modules.
 *
 *  Minimal by design (§11): the material behaviour carries most of the
 *  communication; this adds the three cues nothing else draws.
 *
 *   - HEAT: a warm additive glow on every body in the (bounded) heated set,
 *     brightening with heat — gradual, so accumulation reads before failure.
 *   - ENERGISED nebula: a flickering cyan rim while a cloud is steerable.
 *   - THE BEAM: the live beam pulse from the ship to what it touches.
 *
 *  Electric arcs reuse the existing lightning-arc particle, magnetism reuses
 *  particle streaks and a ring, explosions reuse the blast ring — none of
 *  those need anything here.  Reads only the view GameEngine hands the
 *  renderer each frame; walks lists that are bounded by construction.
 */
import { GameEntity, CameraState } from '../../../types';
import { shiftX, shiftY } from './drawUtils';

export interface EnergyBeamView {
    x0: number; y0: number; x1: number; y1: number;
    width: number; color: string; energy: string | undefined; hit: boolean;
}
export interface EnergyFxView {
    heated: readonly GameEntity[];
    energized: readonly GameEntity[];
    beam: EnergyBeamView | null;
    simClock: number;
}

const CULL = 1400;

export function renderEnergyFx(ctx: CanvasRenderingContext2D, view: EnergyFxView | null, camera: CameraState): void {
    if (!view) return;
    const camX = camera.position.x, camY = camera.position.y;
    const { heated, energized, beam } = view;
    if (heated.length === 0 && energized.length === 0 && !beam) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    for (let i = 0; i < heated.length; i++) {
        const e = heated[i];
        const h = e.heat ?? 0;
        if (!e.active || h < 0.05) continue;
        const x = shiftX(camX, e.position.x), y = shiftY(camY, e.position.y);
        if (Math.abs(x - camX) > CULL || Math.abs(y - camY) > CULL) continue;
        const r = Math.max(e.size.x, e.size.y) * (0.45 + 0.15 * Math.min(h, 1.5));
        const t = Math.min(1, h);
        // Dull red → orange → yellow-white as it heats.
        const g = Math.round(60 + 150 * t), b = Math.round(20 + 90 * Math.max(0, t - 0.7));
        ctx.globalAlpha = Math.min(0.55, 0.12 + 0.4 * t);
        ctx.fillStyle = `rgb(255, ${g}, ${b})`;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
    }

    for (let i = 0; i < energized.length; i++) {
        const e = energized[i];
        if (!e.active) continue;
        const left = (e.energizedUntil ?? 0) - view.simClock;
        if (left <= 0) continue;
        const x = shiftX(camX, e.position.x), y = shiftY(camY, e.position.y);
        if (Math.abs(x - camX) > CULL || Math.abs(y - camY) > CULL) continue;
        ctx.globalAlpha = Math.min(0.6, left) * (0.5 + 0.5 * Math.random());
        ctx.strokeStyle = '#67e8f9';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(x, y, Math.max(e.size.x, e.size.y) * 0.55, 0, Math.PI * 2);
        ctx.stroke();
    }

    // Electric beams draw as arcs (lightning particles); everything else is
    // a line from the muzzle to the contact.
    if (beam && beam.energy !== 'electric') {
        const x0 = shiftX(camX, beam.x0), y0 = shiftY(camY, beam.y0);
        const x1 = x0 + (shiftX(beam.x0, beam.x1) - beam.x0);
        const y1 = y0 + (shiftY(beam.y0, beam.y1) - beam.y0);
        const magnetic = beam.energy === 'magnetic';
        ctx.lineCap = 'round';
        ctx.globalAlpha = magnetic ? 0.25 : 0.45;
        ctx.strokeStyle = beam.color;
        ctx.lineWidth = beam.width * (magnetic ? 1 : 2.2);
        if (magnetic) ctx.setLineDash([10, 12]);
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
        ctx.setLineDash([]);
        if (!magnetic) {
            ctx.globalAlpha = 0.9;
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = Math.max(1, beam.width * 0.5);
            ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
            if (beam.hit) {
                ctx.globalAlpha = 0.6;
                ctx.fillStyle = beam.color;
                ctx.beginPath(); ctx.arc(x1, y1, beam.width * 1.6 + 3, 0, Math.PI * 2); ctx.fill();
            }
        }
    }
    ctx.restore();
}
