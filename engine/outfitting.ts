/** OUTFITTING — the hex-slot module system.
 *
 *  Extracted verbatim from `GameEngine` in gauntlet 5f (see
 *  `docs/GAUNTLET_5F_LOG.md`); plain free functions taking `g: GameEngine`,
 *  with `GameEngine` imported as a TYPE so it is erased at compile time and
 *  there is no runtime cycle.
 *
 *  Everything here serves one loop: modules are discrete non-upgradeable
 *  ITEMS, they occupy hex tiles across three areas (inventory / ship /
 *  weapon), a module only FUNCTIONS while it touches an active module of the
 *  family it requires, and the player's stats are the sum of what is active.
 *  So the file reads in that order — the adjacency fixpoint
 *  (`computeActiveSlots`), the fold into player stats (`applyModuleEffects`),
 *  the derived gun loadout, the tile move/swap with its guards, pricing, and
 *  the two snapshots the UI renders from.
 *
 *  `statBreakdown` is built from the SAME slot walk `applyModuleEffects`
 *  folds, which is why they live next to each other: the Ship Status panel
 *  renders, it never recomputes, so the panel cannot disagree with the sim.
 *
 *  The COMMERCE API stayed on `GameEngine` — `moveModule`, `purchaseModule`,
 *  `sellModule`, `scrapModule`, `repairHull`, and the DBG grants.  Those are
 *  what `App.tsx` calls and what carries the docked-at-a-station guards, so
 *  they are the engine's public surface rather than machinery; the machinery
 *  they drive is here.
 */
import type { GameEngine } from './GameEngine';
import { GameEntity, EngineStats, WeaponType } from '../types';
import {
    MODULE_DEFS, ModuleDef, ModuleFamily, moduleDef, moduleFitsSlot,
    MODULE_SLOT_COUNT, MAX_INSTALLED_GUNS, SHIP_WEIGHT,
    INVENTORY_CAPACITY, COOLDOWN_FLOOR, MODULE_RESALE, MODULE_REQUIREMENTS,
    HEX_ADJACENCY, WEAPONS, WEAPON_LIST, PHYSICS_CONSTANTS, PLAYER_MOVEMENT_CONFIG,
    SHIELD_CONSTANTS,
} from '../constants';

/** Adjacency-requirement fixpoint for one hex group: a module is ACTIVE
 *  when its family has no requirement (hull / gun roots) or it touches
 *  an ACTIVE module of its required family (HEX_ADJACENCY).  Chains
 *  resolve naturally: thrusters need a LIVE engine, which needs a hull. */
export function computeActiveSlots(g: GameEngine, slots: (string | null)[], out: boolean[]) {
    for (let i = 0; i < out.length; i++) {
        const id = slots[i];
        const def = id !== null ? moduleDef(id) : undefined;
        out[i] = def !== undefined && MODULE_REQUIREMENTS[def.family] === undefined;
    }
    let changed = true;
    while (changed) {
        changed = false;
        for (let i = 0; i < slots.length; i++) {
            const id = slots[i];
            if (id === null || out[i]) continue;
            const req = MODULE_REQUIREMENTS[moduleDef(id)!.family];
            if (!req) continue;
            for (const n of HEX_ADJACENCY[i]) {
                const nid = slots[n];
                if (nid !== null && out[n] && req.includes(moduleDef(nid)!.family)) {
                    out[i] = true;
                    changed = true;
                    break;
                }
            }
        }
    }
}

/** Recompute module activity (adjacency fixpoint) and fold the summed
 *  effects of every ACTIVE module into the player's stats.  Called at
 *  construction, on any outfit change, and on run reset.  Hull heals
 *  the HP it adds so a purchase is felt immediately. */
export function applyModuleEffects(g: GameEngine) {
    computeActiveSlots(g, g.shipSlots, g.activeShip);
    computeActiveSlots(g, g.weaponSlots, g.activeWeapon);
    let maxHp = 0, maxShield = 0, regen = 0, speed = 0, accel = 0, dmg = 0, cool = 0;
    let shieldCore = false, overcharge = false, flashlight = false;
    // SHIP weight: the hull's own weight plus every ACTIVE module's.  A
    // module's weight is a contribution to the SHIP's attribute, not an
    // effect the module has on acceleration — see SHIP_WEIGHT.
    let shipWeight = SHIP_WEIGHT.HULL_BASE;
    const fold = (slots: (string | null)[], active: boolean[]) => {
        for (let i = 0; i < slots.length; i++) {
            const id = slots[i];
            if (id === null || !active[i]) continue;
            const d = moduleDef(id);
            shipWeight += d?.weight ?? 0;
            const e = d?.effect;
            if (!e) continue;
            maxHp += e.maxHp ?? 0;
            maxShield += e.maxShield ?? 0;
            regen += e.shieldRegenFrac ?? 0;
            speed += e.speedFrac ?? 0;
            accel += e.accelFrac ?? 0;
            dmg += e.damageFrac ?? 0;
            cool += e.cooldownFrac ?? 0;
            if (e.shieldCore) shieldCore = true;
            if (e.overcharge) overcharge = true;
            if (e.flashlight) flashlight = true;
        }
    };
    fold(g.shipSlots, g.activeShip);
    fold(g.weaponSlots, g.activeWeapon);
    g.moduleSpeedMult = 1 + speed;
    // Ship weight: flying light is faster — an unladen ship earns the
    // BASE_BOOST, a heavy one drags (Blaster-only ≈ the 1.0 baseline).
    g.shipWeight = shipWeight;
    g.moduleThrustMult = (1 + accel)
        * (SHIP_WEIGHT.BASE_BOOST / (1 + SHIP_WEIGHT.DRAG_PER_WEIGHT * shipWeight));
    // Weight is PHYSICAL too (user call): the player's collision mass scales
    // with it, so PhysicsSystem's impulse solver (which divides by mass)
    // shoves a heavy ship less and lets it plow through debris, while a
    // stripped hull gets knocked around.  Normalised so the LEAN loadout is
    // exactly the old constant — no change to the feel a run starts with.
    g.player.mass = PHYSICS_CONSTANTS.PLAYER_MASS
        * ((SHIP_WEIGHT.MASS_BASE + shipWeight)
           / (SHIP_WEIGHT.MASS_BASE + SHIP_WEIGHT.MASS_REFERENCE));
    const newMaxHp = 100 + maxHp;
    const hpDelta = newMaxHp - g.player.maxHealth;
    g.player.maxHealth = newMaxHp;
    if (hpDelta > 0) g.player.health = Math.min(newMaxHp, g.player.health + hpDelta);
    // Shield exists only while a shield CORE is active; plating adds on top.
    g.player.maxShield = shieldCore ? SHIELD_CONSTANTS.MAX_CHARGE + maxShield : 0;
    if ((g.player.shield ?? 0) > g.player.maxShield) g.player.shield = g.player.maxShield;
    g.player.shieldRechargeRate = SHIELD_CONSTANTS.RECHARGE_RATE * (1 + regen);
    g.player.damageMult = 1 + dmg;
    g.player.cooldownMult = Math.max(COOLDOWN_FLOOR, 1 - cool);
    g.player.overchargeUnlocked = overcharge;
    // Flashlight Kit: the ship-tap light tool exists only while the kit is
    // installed and ACTIVE (touching a hull, like every utility).  Losing
    // the kit also turns the light OFF — an uninstalled tool must not leave
    // its beam burning.
    if (!flashlight) g.flashlightLevel = 0;
    g.flashlightEquipped = flashlight;
}

/** Push the gun + module state onto the player entity so WeaponSystem
 *  can gate weapon cycle/select + charged shots without reaching into
 *  the engine.  ownedWeapons = the INSTALLED guns (the usable set). */
export function syncUnlocksToPlayer(g: GameEngine) {
    g.player.ownedWeapons = g.equippedWeapons.filter((w): w is WeaponType => w !== null);
    g.player.equippedWeapons = [...g.equippedWeapons];
    // The active weapon must be a mounted gun — if a move removed it,
    // fall to the first mounted gun, or to NONE (weaponless flight is
    // allowed; firing is gated off while currentWeapon is undefined).
    const cur = g.player.currentWeapon;
    if (cur === undefined || !g.equippedWeapons.includes(cur)) {
        const first = g.equippedWeapons.find((w): w is WeaponType => w !== null);
        g.player.currentWeapon = first;
        g.player.burstQueue = 0;
        g.currentWeaponIndex = first !== undefined ? WEAPON_LIST.indexOf(first) : 0;
    }
}

/** Rebuild the derived weapon loadout from the mounted guns (any
 *  weapon hex, slot order; ≤ MAX_INSTALLED_GUNS by the move guard),
 *  then re-sync the player entity + recompute activity/effects. */
export function syncLoadoutFromSlots(g: GameEngine) {
    const guns: WeaponType[] = [];
    for (let i = 0; i < g.weaponSlots.length; i++) {
        const id = g.weaponSlots[i];
        const def = id !== null ? moduleDef(id) : undefined;
        if (def?.weapon !== undefined) guns.push(def.weapon);
    }
    for (let i = 0; i < g.equippedWeapons.length; i++) {
        g.equippedWeapons[i] = guns[i] ?? null;
    }
    syncUnlocksToPlayer(g);
    applyModuleEffects(g);
}

/** First empty slot of the module's group that accepts its kind, or -1. */
export function firstFreeSlotFor(g: GameEngine, def: ModuleDef): number {
    const slots = def.group === 'ship' ? g.shipSlots : g.weaponSlots;
    for (let i = 0; i < slots.length; i++) {
        if (slots[i] === null && moduleFitsSlot(def, def.group, i)) return i;
    }
    return -1;
}

export function areaSlots(g: GameEngine, area: 'inventory' | 'ship' | 'weapon'): (string | null)[] {
    return area === 'inventory' ? g.inventory
        : area === 'ship' ? g.shipSlots : g.weaponSlots;
}

/** Rounded resale payout for an inventory tile, or null when the tile
 *  is empty/invalid. */
export function resaleValue(g: GameEngine, idx: number, fraction: number): number | null {
    if (idx < 0 || idx >= g.inventory.length) return null;
    const id = g.inventory[idx];
    if (id === null) return null;
    const def = moduleDef(id);
    if (!def) return null;
    // Priced off the DISCOUNTED cost, not the catalog cost — see modulePrice.
    return Math.round(modulePrice(def.cost) * fraction);
}

/** The actual tile move/swap.  Guards: destination kind fit, displaced
 *  item must fit the vacated tile, and the last mounted gun can never
 *  leave the gun hexes without another gun taking its place. */
export function moveModuleInternal(
  g: GameEngine,
    from: { area: 'inventory' | 'ship' | 'weapon'; idx: number },
    to: { area: 'inventory' | 'ship' | 'weapon'; idx: number },
): boolean {
    const fromSlots = areaSlots(g, from.area);
    const toSlots = areaSlots(g, to.area);
    if (from.idx < 0 || from.idx >= fromSlots.length) return false;
    if (to.idx < 0 || to.idx >= toSlots.length) return false;
    if (from.area === to.area && from.idx === to.idx) return false;
    const id = fromSlots[from.idx];
    if (id === null) return false;
    const def = moduleDef(id);
    if (!def) return false;
    const displaced = toSlots[to.idx];
    const dDef = displaced !== null ? moduleDef(displaced) : undefined;
    if (to.area !== 'inventory' && !moduleFitsSlot(def, to.area, to.idx)) return false;
    if (displaced !== null) {
        if (!dDef) return false;
        if (from.area !== 'inventory' && !moduleFitsSlot(dDef, from.area, from.idx)) return false;
    }
    // Apply, then enforce the slot-agnostic gun COUNT limit — a move may
    // not leave more than MAX_INSTALLED_GUNS guns mounted in the weapon
    // flower (weaponless is fine; there is no minimum).
    fromSlots[from.idx] = displaced;
    toSlots[to.idx] = id;
    const gunsMounted = g.weaponSlots.reduce(
        (n, s) => n + (s !== null && moduleDef(s)?.kind === 'weapon' ? 1 : 0), 0);
    if (gunsMounted > MAX_INSTALLED_GUNS) {
        fromSlots[from.idx] = id;
        toSlots[to.idx] = displaced;
        return false;
    }
    syncLoadoutFromSlots(g);
    return true;
}

/** Shop price for a catalog cost after the run's TIMED boss discount ((h)
 *  payout model (d): a boss kill makes the shop cheaper for a window rather
 *  than unlocking anything).  RESALE IS PRICED OFF THE SAME NUMBER
 *  (resaleValue) — if buying were discounted while sell-back stayed on full
 *  catalog cost, buy-then-sell would profit `discount - (1 - SELL_FRACTION)`
 *  of cost per cycle, i.e. an infinite money pump above a 10% discount. */
export function modulePrice(cost: number): number {
    return Math.max(0, Math.round(cost));
}

/** Hex-slot outfitting snapshot for the station UI (+ pause readout). */
/** Per-stat module attribution for the Ship Status panel (A2).
 *
 *  Walks the two hex groups exactly the way `applyModuleEffects`'s `fold`
 *  does — same slots, same `activeShip`/`activeWeapon` fixpoint — and files
 *  each module's effect under the derived stat it feeds.  The HEADLINE
 *  value of every line is read straight off the player entity / the module
 *  multipliers, so the panel can never disagree with the simulation: the
 *  breakdown explains the number, it does not derive it.
 *
 *  A contributor's `active` means "this amount is IN the total".  It is
 *  false both for an adjacency-inactive module (`requires` names the family
 *  it must touch) and for shield PLATING with no shield core installed —
 *  plating that is perfectly well connected but has nothing to plate.
 *
 *  Menu-only (built with the rest of the outfitting snapshot while paused
 *  or docked), so it costs nothing on a live frame. */
export function statBreakdown(g: GameEngine) {
    type Contrib = {
        area?: 'ship' | 'weapon'; idx?: number; moduleId?: string;
        label: string; display: string; active: boolean; requires?: string;
    };
    const pct = (f: number) => `${f >= 0 ? '+' : '−'}${Math.round(Math.abs(f) * 100)}%`;
    const hull: Contrib[] = [], shield: Contrib[] = [], regen: Contrib[] = [];
    const speed: Contrib[] = [], accel: Contrib[] = [], dmg: Contrib[] = [];
    const cool: Contrib[] = [], charge: Contrib[] = [], weight: Contrib[] = [];
    let shipWeight = SHIP_WEIGHT.HULL_BASE, shieldCore = false;

    const walk = (area: 'ship' | 'weapon', slots: (string | null)[], active: boolean[]) => {
        for (let i = 0; i < slots.length; i++) {
            const id = slots[i];
            if (id === null) continue;
            const def = moduleDef(id);
            if (!def) continue;
            const on = active[i];
            const req = MODULE_REQUIREMENTS[def.family];
            // Template for this module's rows — every push below spreads it
            // and supplies the stat-specific `display`, so the template
            // itself deliberately has none.
            const base: Omit<Contrib, 'display'> = {
                area, idx: i, moduleId: id, label: def.label, active: on,
                requires: on ? undefined : (req !== undefined ? (req[0] as string) : undefined),
            };
            // Weight is a contribution to the SHIP's weight, not to
            // acceleration: a gun does not make the ship accelerate worse,
            // it makes the ship HEAVIER, and weight is what drags thrust.
            // So a weighted module files under `weight` and tapping it
            // highlights Ship weight — Acceleration then carries ONE derived
            // row for the whole ship's weight (below).  Read off any module,
            // not just guns.
            if (def.weight) {
                if (on) shipWeight += def.weight;
                weight.push({ ...base, display: `+${def.weight.toFixed(1)}` });
            }
            const e = def.effect;
            if (!e) continue;
            if (e.maxHp)           hull.push({ ...base, display: `+${e.maxHp} HP` });
            if (e.maxShield)       shield.push({ ...base, display: `+${e.maxShield}` });
            if (e.shieldCore)    { if (on) shieldCore = true;
                                   shield.push({ ...base, display: `+${SHIELD_CONSTANTS.MAX_CHARGE} base` }); }
            if (e.shieldRegenFrac) regen.push({ ...base, display: pct(e.shieldRegenFrac) });
            if (e.speedFrac)       speed.push({ ...base, display: pct(e.speedFrac) });
            if (e.accelFrac)       accel.push({ ...base, display: pct(e.accelFrac) });
            if (e.damageFrac)      dmg.push({ ...base, display: pct(e.damageFrac) });
            if (e.cooldownFrac)    cool.push({ ...base, display: pct(-e.cooldownFrac) });
            if (e.overcharge)      charge.push({ ...base, display: on ? 'enabled' : 'offline' });
        }
    };
    walk('ship', g.shipSlots, g.activeShip);
    walk('weapon', g.weaponSlots, g.activeWeapon);

    // Plating with no shield core is connected-but-pointless: `maxShield`
    // is gated to 0 in applyModuleEffects, so report zero contribution and
    // name the missing piece rather than showing a number that isn't real.
    if (!shieldCore) {
        for (const c of shield) {
            if (c.moduleId === 'shield') continue;
            c.active = false;
            c.requires = 'shield core';
        }
    }

    // Fire RATE is the inverse of the cooldown multiplier, so the per-module
    // cooldown cuts above do not sum in rate space.  Same shape as the
    // acceleration drag row: the hex contributions stay in the units the
    // modules are actually specified in (−8% cooldown), and one derived row
    // carries the cooldown total the headline rate inverts.
    if (cool.length > 0) {
        cool.push({
            label: 'Resulting cooldown',
            display: `×${(g.player.cooldownMult ?? 1).toFixed(2)}`,
            active: true,
        });
    }

    // Weight drag is MULTIPLICATIVE over the ship's TOTAL weight, so it
    // belongs to the ship, not to any hex.  One derived row on Acceleration
    // names the ship weight it came from; the modules that make up that
    // weight live on the Ship weight line above.
    const dragMult = SHIP_WEIGHT.BASE_BOOST
        / (1 + SHIP_WEIGHT.DRAG_PER_WEIGHT * shipWeight);
    accel.push({
        label: shipWeight === 0 ? 'Unladen ship' : `Ship weight ${shipWeight.toFixed(1)}`,
        display: `×${dragMult.toFixed(2)}`,
        active: true,
    });

    const line = (id: string, label: string, display: string, baseDisplay: string,
                  contributors: Contrib[], note?: string) =>
        ({ id, label, display, baseDisplay, contributors, note });

    return [
        // "Max hull"/"Max shield", not "Hull"/"Shield": the Condition block
        // shows the LIVE pools (87 / 150) under those names, and the same
        // word against two different numbers reads as a contradiction.
        line('hull', 'Max hull', `${g.player.maxHealth}`, '100', hull),
        line('shield', 'Max shield', `${g.player.maxShield}`, '0', shield,
             shieldCore ? undefined : 'no shield core installed'),
        line('shieldRegen', 'Shield regen',
             `${(g.player.shieldRechargeRate ?? SHIELD_CONSTANTS.RECHARGE_RATE).toFixed(1)}/s`,
             `${SHIELD_CONSTANTS.RECHARGE_RATE.toFixed(1)}/s`, regen),
        line('damage', 'Damage', `×${(g.player.damageMult ?? 1).toFixed(2)}`, '×1.00', dmg),
        line('cooldown', 'Fire rate',
             `×${(1 / (g.player.cooldownMult ?? 1)).toFixed(2)}`, '×1.00', cool,
             'modules cut cooldown; the rate is its inverse'),
        line('speed', 'Top speed', `×${g.moduleSpeedMult.toFixed(2)}`, '×1.00', speed),
        line('accel', 'Acceleration', `×${g.moduleThrustMult.toFixed(2)}`, '×1.00', accel,
             'a heavier ship accelerates worse'),
        line('weight', 'Ship weight', shipWeight.toFixed(1),
             SHIP_WEIGHT.HULL_BASE.toFixed(1), weight,
             'hull + everything mounted; drags Acceleration'),
        line('overcharge', 'Charged shots',
             g.player.overchargeUnlocked ? 'Enabled' : 'Locked', 'Locked', charge),
    ];
}

export function outfittingSnapshot(g: GameEngine) {
    const hexSnap = (slots: (string | null)[], active: boolean[]) => slots.map((id, i) => {
        if (id === null) return null;
        const def = moduleDef(id)!;
        const req = MODULE_REQUIREMENTS[def.family];
        return {
            id, label: def.label, kind: def.kind as string, family: def.family as string,
            active: active[i],
            requires: req !== undefined ? (req[0] as string) : undefined,
        };
    });
    const gunsMounted = g.weaponSlots.reduce(
        (n, s) => n + (s !== null && moduleDef(s)?.kind === 'weapon' ? 1 : 0), 0);
    return {
        ship: hexSnap(g.shipSlots, g.activeShip),
        weapon: hexSnap(g.weaponSlots, g.activeWeapon),
        gunsMounted,
        maxGuns: MAX_INSTALLED_GUNS,
        inventory: g.inventory.map(id => {
            if (id === null) return null;
            const def = moduleDef(id)!;
            // Both resale values track the same discounted price the shop
            // charges, so a discount can never be laundered into credits.
            const price = modulePrice(def.cost);
            return {
                id, label: def.label, kind: def.kind as string, family: def.family as string, group: def.group as string,
                sellValue: Math.round(price * MODULE_RESALE.SELL_FRACTION),
                scrapValue: Math.round(price * MODULE_RESALE.SCRAP_FRACTION),
            };
        }),
        // Per-module stat attribution (Pair A, A2).  Built from the SAME
        // slot walk applyModuleEffects folds, so the UI never recomputes a
        // derived stat — it only renders what the sim is already using.
        statLines: statBreakdown(g),
        // Catalog prices are the DISCOUNTED prices the shop will actually
        // charge ((h) boss payout model (d)), so the UI needs no arithmetic.
        catalog: MODULE_DEFS.filter(d => d.cost > 0).map(d => {
            const price = modulePrice(d.cost);
            return {
                id: d.id, group: d.group as string, kind: d.kind as string,
                label: d.label, desc: d.desc, cost: price,
                affordable: g.credits >= price && g.inventory.includes(null),
            };
        }),
    };
}
