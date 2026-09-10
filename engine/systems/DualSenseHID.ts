/** ADAPTIVE TRIGGERS — the DualSense's one feature no web API reaches.
 *
 *  Everything else about the pad arrives through the Gamepad API: sticks,
 *  buttons, and `dual-rumble` (and `trigger-rumble` where a browser offers
 *  it).  Adaptive trigger RESISTANCE is different — it is a physical clutch
 *  driven by HID output reports, so it needs WebHID, which exists only in
 *  desktop Chromium and Edge.
 *
 *  Three rules make that acceptable rather than a platform split:
 *
 *  1. **OUTPUT ONLY.**  Input still comes from the Gamepad API, always.  This
 *     module never reads the pad, which sidesteps the known hazard that
 *     opening a DualSense over Bluetooth can flip its input report mode and
 *     disturb the Gamepad API's view of it.
 *  2. **OPT-IN, behind a user gesture.**  `navigator.hid.requestDevice()`
 *     requires a click and shows a device picker.  Nothing here runs until
 *     the player asks for it.
 *  3. **INERT WHERE UNSUPPORTED.**  `isSupported()` is false on every mobile
 *     browser and on Safari, and every method below is a no-op when no device
 *     is open.  Mobile behaviour — controller, touch, or both — is unchanged
 *     by the existence of this file.
 *
 *  ── WHY THERE ARE TWO ENCODINGS ──────────────────────────────────────────
 *
 *  The report FRAME is documented: the layout below matches the Linux kernel's
 *  `dualsense_output_report_common` (hid-playstation) field for field, which
 *  is a maintained driver against real hardware rather than a forum post.
 *
 *  How the 11-byte trigger block encodes an effect had two candidates, and
 *  hardware settled it:
 *
 *    'zones'   modes 0x21/0x25/0x26, parameters bit-packed into ten 0–9
 *              travel zones with a 0–8 force each.  **CONFIRMED WORKING** on
 *              the DualSense over USB, and the default.  Only this encoding
 *              can express the three richer shapes (vibration, slope,
 *              texture), because all three are per-zone by nature.
 *    'simple'  modes 0x01/0x02, parameters as raw bytes.  Kept because a pad
 *              SILENTLY DISCARDS an effect it does not understand, so a
 *              firmware that disagrees would otherwise present as a dead
 *              feature with no way to tell from a dead transport.  It can
 *              only say "wall" and "click", so the richer shapes degrade to
 *              their nearest equivalent rather than vanishing.
 *
 *  Profiles are authored in NORMALISED units (0..1 of travel, 0..1 of
 *  strength) and converted here — the game's intent does not change with the
 *  wire format, and wire units in `constants.ts` are what once let an
 *  out-of-range value look reasonable.
 */

/** CRC-32 (IEEE 802.3, reflected, init/xor 0xFFFFFFFF) — what the DualSense
 *  requires on every Bluetooth output report and ignores over USB.  Table
 *  built once on first use. */
let crcTable: Uint32Array | null = null;
function crcTableOnce(): Uint32Array {
  if (crcTable) return crcTable;
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  crcTable = t;
  return t;
}

/** Exported for test: the standard vector CRC32("123456789") = 0xCBF43926
 *  pins this to the real algorithm rather than to itself. */
export function crc32(bytes: ArrayLike<number>): number {
  const t = crcTableOnce();
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = t[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

/** How the 11-byte trigger block is encoded.  See the file header. */
export type TriggerEncoding = 'zones' | 'simple';
export const TRIGGER_ENCODINGS: TriggerEncoding[] = ['zones', 'simple'];

/** What an effect DOES, independent of how it is encoded.  This is the
 *  vocabulary the game's profile table is written in. */
export type TriggerKind = 'off' | 'resistance' | 'weapon' | 'vibration' | 'slope' | 'texture';

export interface TriggerProfile {
  /** What SHAPE the resistance takes:
   *
   *   'off'        no resistance — a free pull.
   *   'resistance' a uniform wall from `start` onward.
   *   'weapon'     resists from `start` and GIVES WAY at `end`.  A click.
   *   'vibration'  a buzz at `frequency` from `start` onward.  A rattle.
   *   'slope'      resistance that RAMPS from `strength` at `start` to
   *                `endStrength` at `end` — the pull gets harder (or
   *                easier) the further it goes.
   *   'texture'    a hand-authored force per travel zone (`zones`), for
   *                notches and anything the four shapes above cannot say. */
  kind: TriggerKind;
  /** Where along the trigger's travel the effect begins, 0..1. */
  start: number;
  /** Where a `weapon` effect gives way / a `slope` finishes ramping, 0..1. */
  end: number;
  /** How hard, 0..1.  For `slope`, the force at `start`. */
  strength: number;
  /** `slope` only: the force at `end`.  Below `strength` ramps DOWN. */
  endStrength?: number;
  /** `vibration` only: 0..1 of the pad's usable range (roughly 0–60 Hz on a
   *  DualSense — low reads as a chug, high as a hiss). */
  frequency?: number;
  /** `texture` only: force per zone, 0..1, index 0 at rest.  Short arrays
   *  leave the remaining zones free. */
  zones?: readonly number[];
}

export const TRIGGER_OFF: TriggerProfile = { kind: 'off', start: 0, end: 0, strength: 0 };

/** Output-report geometry, matching the kernel's
 *  `dualsense_output_report_common`:
 *
 *    0      valid_flag0        6..7   reserved
 *    1      valid_flag1        8      mute_button_led
 *    2      motor_right        9      power_save_control
 *    3      motor_left         10..20 right trigger effect  (11 bytes)
 *    4..5   reserved           21..31 left trigger effect   (11 bytes)
 *                              32..46 flags, lightbar, player LEDs
 *
 *  The trigger blocks at 10 and 21 are the correction that matters: the
 *  numbers quoted in most samples (11 and 22) are indices into a buffer whose
 *  first byte is the REPORT ID.  WebHID's `sendReport(reportId, data)` takes
 *  the data WITHOUT that byte, so a sample transcribed literally lands every
 *  field one byte late — which the pad answers with silence. */
const REPORT = {
  /** Bytes of the common output block, excluding the report id. */
  DATA_LEN: 47,
  USB_REPORT_ID: 0x02,
  BT_REPORT_ID: 0x31,
  /** Prefix byte the DualSense's Bluetooth CRC is computed over. */
  BT_CRC_SEED: 0xa2,
  /** Bytes between the common block and the CRC on the Bluetooth report.
   *  Omitting them shortens the report, and a short report is discarded. */
  BT_RESERVED: 24,
  FLAG0: 0,
  FLAG1: 1,
  MOTOR_RIGHT: 2,
  MOTOR_LEFT: 3,
  /** Enable bits in FLAG0. */
  FLAG0_COMPATIBLE_VIBRATION: 0x01,
  FLAG0_HAPTICS_SELECT: 0x02,
  FLAG0_RIGHT_TRIGGER: 0x04,
  FLAG0_LEFT_TRIGGER: 0x08,
  RIGHT_TRIGGER: 10,
  LEFT_TRIGGER: 21,
} as const;

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const clampInt = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, Math.round(v)));

/**
 * Write one 11-byte trigger effect at `at`.
 *
 * Pure and exported, because it is the whole of what can be checked without
 * hardware: which bytes are set, and to what.
 */
export function writeTriggerEffect(
  d: Uint8Array,
  at: number,
  p: TriggerProfile,
  encoding: TriggerEncoding,
): void {
  // OFF is the same in both encodings: mode 0, parameters clear.  That is
  // what releases the clutch, so it must never be skipped as a no-op.
  //
  // The test is EFFECTIVE strength, not `strength`: a slope ramping UP from
  // nothing (strength 0, endStrength 1) is a real effect and the most natural
  // way to author one, and a texture carries its forces in `zones` where
  // `strength` is not consulted at all.
  if (p.kind === 'off' || effectiveStrength(p) <= 0) {
    for (let i = 0; i < 11; i++) d[at + i] = 0;
    return;
  }

  if (encoding === 'simple') {
    writeSimpleEffect(d, at, p);
    return;
  }
  writeZonesEffect(d, at, p);
}

/** The older convention: modes 0x01/0x02 with raw byte parameters.  It can
 *  only say "wall" and "click", so the three richer shapes degrade to their
 *  nearest equivalent rather than being dropped — a pad on this encoding
 *  should still feel SOMETHING per weapon. */
function writeSimpleEffect(d: Uint8Array, at: number, p: TriggerProfile): void {
  const byte = (v: number) => clampInt(clamp01(v) * 255, 0, 255);
  if (p.kind === 'weapon') {
    const start = clampInt(clamp01(p.start) * 255, 0, 254);
    d[at] = 0x02;
    d[at + 1] = start;
    d[at + 2] = clampInt(clamp01(p.end) * 255, start + 1, 255);
    d[at + 3] = byte(p.strength);
    return;
  }
  // wall / vibration / slope / texture all collapse to a constant push; the
  // strength picked is the one that best represents the effect's body.
  d[at] = 0x01;
  d[at + 1] = byte(p.kind === 'texture' ? textureStart(p) : p.start);
  d[at + 2] = byte(effectiveStrength(p));
}

/** A texture's first non-zero zone — where the player first feels it. */
function textureStart(p: TriggerProfile): number {
  const z = p.zones ?? [];
  for (let i = 0; i < z.length; i++) if (z[i] > 0) return i / 9;
  return p.start;
}

/** One number standing in for an effect's overall firmness. */
function effectiveStrength(p: TriggerProfile): number {
  if (p.kind === 'slope') return Math.max(p.strength, p.endStrength ?? p.strength);
  if (p.kind === 'texture') {
    const z = p.zones ?? [];
    let max = 0;
    for (let i = 0; i < z.length; i++) if (z[i] > max) max = z[i];
    return max;
  }
  return p.strength;
}

/** Pack a per-zone force table into the 0x21 layout: a 10-bit ACTIVE mask
 *  followed by ten 3-bit forces, low zone first.
 *
 *  The forces are split across two 16-bit halves rather than one 32-bit
 *  number because `<<` is a SIGNED 32-bit operation in JS — zone 9 occupies
 *  bits 27..29, and shifting that back out of a single integer is a
 *  sign-extension bug waiting to happen. */
function packZoneForces(d: Uint8Array, at: number, force: (zone: number) => number): void {
  let activeZones = 0;
  let lo = 0, hi = 0;
  for (let z = 0; z < 10; z++) {
    const f = force(z);
    if (f <= 0) continue;
    activeZones |= 1 << z;
    const level = clampInt(clamp01(f) * 8, 1, 8) - 1;
    const bit = 3 * z;
    if (bit < 24) lo |= level << bit;
    else hi |= level << (bit - 24);
  }
  d[at + 1] = activeZones & 0xff;
  d[at + 2] = (activeZones >>> 8) & 0xff;
  d[at + 3] = lo & 0xff;
  d[at + 4] = (lo >>> 8) & 0xff;
  d[at + 5] = (lo >>> 16) & 0xff;
  d[at + 6] = hi & 0xff;
}

/** The convention the hardware confirmed: the travel is ten zones, and an
 *  effect names which are active plus how hard each pushes. */
function writeZonesEffect(d: Uint8Array, at: number, p: TriggerProfile): void {
  const zoneOf = (t: number) => clampInt(clamp01(t) * 9, 0, 9);

  switch (p.kind) {
    case 'weapon': {
      // A weapon effect names only its start and stop zones; the pad fills in
      // the resistance between them.  Start is bounded to 2..7 and the stop
      // must sit above it — the hardware ignores anything else.
      const start = Math.max(2, Math.min(7, zoneOf(p.start)));
      const end = Math.max(start + 1, Math.min(8, zoneOf(p.end)));
      const zones = (1 << start) | (1 << end);
      d[at] = 0x25;
      d[at + 1] = zones & 0xff;
      d[at + 2] = (zones >>> 8) & 0xff;
      d[at + 3] = clampInt(clamp01(p.strength) * 8, 1, 8) - 1;
      return;
    }
    case 'resistance': {
      const from = zoneOf(p.start);
      d[at] = 0x21;
      packZoneForces(d, at, z => (z >= from ? p.strength : 0));
      return;
    }
    case 'slope': {
      // Linear ramp between the two strengths.  Quantised to ten zones and
      // eight levels, so a shallow ramp over a short span reads as a step —
      // worth knowing before authoring one across two adjacent zones.
      const from = zoneOf(p.start);
      const to = Math.max(from + 1, zoneOf(p.end));
      const s0 = p.strength;
      const s1 = p.endStrength ?? p.strength;
      d[at] = 0x21;
      packZoneForces(d, at, z => {
        if (z < from) return 0;
        if (z >= to) return s1;
        return s0 + (s1 - s0) * ((z - from) / (to - from));
      });
      return;
    }
    case 'texture': {
      const z = p.zones ?? [];
      d[at] = 0x21;
      packZoneForces(d, at, i => z[i] ?? 0);
      return;
    }
    case 'vibration': {
      // A buzz rather than a push: active zones, then FREQUENCY and
      // AMPLITUDE as plain bytes.  This is the one shape whose character is
      // set by a number that is not a force.
      const from = zoneOf(p.start);
      let zones = 0;
      for (let z = from; z < 10; z++) zones |= 1 << z;
      d[at] = 0x26;
      d[at + 1] = zones & 0xff;
      d[at + 2] = (zones >>> 8) & 0xff;
      d[at + 3] = clampInt(clamp01(p.strength) * 8, 1, 8) - 1;
      d[at + 9] = clampInt(clamp01(p.frequency ?? 0.5) * 255, 1, 255);
      return;
    }
  }
}

/** Build the common 47-byte output block for a pair of trigger effects. */
export function buildTriggerData(
  right: TriggerProfile,
  left: TriggerProfile,
  encoding: TriggerEncoding = 'zones',
): Uint8Array {
  const d = new Uint8Array(REPORT.DATA_LEN);
  d[REPORT.FLAG0] = REPORT.FLAG0_RIGHT_TRIGGER | REPORT.FLAG0_LEFT_TRIGGER;
  writeTriggerEffect(d, REPORT.RIGHT_TRIGGER, right, encoding);
  writeTriggerEffect(d, REPORT.LEFT_TRIGGER, left, encoding);
  return d;
}

/**
 * Build a common block that runs the two RUMBLE MOTORS.
 *
 * This exists as a DIAGNOSTIC, not as a feature — force feedback ships
 * through the portable Gamepad API path and always will.  What it buys is a
 * bisection: the motors sit in the same report, behind the same framing and
 * the same CRC as the triggers, but their two bytes are not in dispute the
 * way the trigger encoding is.  So a pad that buzzes on this and stays limp
 * on a trigger effect says "the transport is fine, the encoding is wrong",
 * and a pad that does neither says "nothing is reaching the device at all".
 * Those are completely different bugs and nothing else can tell them apart.
 */
export function buildRumbleData(strong: number, weak: number): Uint8Array {
  const d = new Uint8Array(REPORT.DATA_LEN);
  d[REPORT.FLAG0] = REPORT.FLAG0_COMPATIBLE_VIBRATION | REPORT.FLAG0_HAPTICS_SELECT;
  d[REPORT.MOTOR_RIGHT] = clampInt(clamp01(weak) * 255, 0, 255);
  d[REPORT.MOTOR_LEFT] = clampInt(clamp01(strong) * 255, 0, 255);
  return d;
}

/**
 * Wrap the common block for the transport in use.  Over USB the block is sent
 * as-is; over Bluetooth it is preceded by a sequence/tag pair, padded to the
 * full report length, and followed by a CRC-32 computed over the seed byte,
 * the report id and the payload.  Get the length or the CRC wrong and the pad
 * silently discards the report, which is the single most likely reason for
 * "nothing happens".
 */
export function buildOutputReport(
  data: Uint8Array,
  bluetooth: boolean,
  seq: number,
): { reportId: number; bytes: Uint8Array } {
  if (!bluetooth) {
    return { reportId: REPORT.USB_REPORT_ID, bytes: data };
  }
  const payload = new Uint8Array(2 + data.length + REPORT.BT_RESERVED + 4);
  payload[0] = (seq & 0x0f) << 4;
  payload[1] = 0x10;
  payload.set(data, 2);
  // The reserved span stays zero; it is padding, but the LENGTH is not
  // optional — a short report is not a partial write, it is a dropped one.

  const body = payload.subarray(0, payload.length - 4);
  const crcInput = new Uint8Array(2 + body.length);
  crcInput[0] = REPORT.BT_CRC_SEED;
  crcInput[1] = REPORT.BT_REPORT_ID;
  crcInput.set(body, 2);

  const crc = crc32(crcInput);
  const at = payload.length - 4;
  payload[at] = crc & 0xff;
  payload[at + 1] = (crc >>> 8) & 0xff;
  payload[at + 2] = (crc >>> 16) & 0xff;
  payload[at + 3] = (crc >>> 24) & 0xff;
  return { reportId: REPORT.BT_REPORT_ID, bytes: payload };
}

/** Sony's vendor id, and the two DualSense product ids (original + Edge). */
const SONY_VENDOR_ID = 0x054c;
const DUALSENSE_PRODUCT_IDS = [0x0ce6, 0x0df2];

type HIDDeviceLike = {
  opened: boolean;
  productId: number;
  productName?: string;
  collections?: { outputReports?: { reportId: number }[] }[];
  open(): Promise<void>;
  close(): Promise<void>;
  sendReport(reportId: number, data: BufferSource): Promise<void>;
};

export class DualSenseHID {
  private device: HIDDeviceLike | null = null;
  private bluetooth = false;
  private seq = 0;
  private lastHex = '';
  private lastError = '';
  private lastSentAt = 0;
  /** Which trigger encoding is in use.  Runtime-switchable so the working
   *  one can be found on hardware rather than guessed at in a commit. */
  public encoding: TriggerEncoding = 'zones';
  /** The effect currently applied, so a redundant write is skipped — these
   *  reports drive a physical actuator, not a frame buffer. */
  private currentRight: TriggerProfile = TRIGGER_OFF;
  private currentLeft: TriggerProfile = TRIGGER_OFF;

  /** WebHID at all?  False on every mobile browser and on Safari, which is
   *  why nothing else in the game may depend on this class. */
  public static isSupported(): boolean {
    return typeof navigator !== 'undefined'
      && typeof (navigator as Navigator & { hid?: unknown }).hid === 'object'
      && (navigator as Navigator & { hid?: { requestDevice?: unknown } }).hid?.requestDevice !== undefined;
  }

  public isConnected(): boolean {
    return this.device !== null && this.device.opened;
  }

  /**
   * Ask the player to pick their pad.  MUST be called from a user gesture —
   * the browser requires one for the device picker, and that requirement is a
   * feature: nothing about this is automatic.
   */
  public async connect(): Promise<boolean> {
    if (!DualSenseHID.isSupported()) return false;
    try {
      const hid = (navigator as Navigator & {
        hid: { requestDevice(o: object): Promise<HIDDeviceLike[]> };
      }).hid;
      const devices = await hid.requestDevice({
        filters: DUALSENSE_PRODUCT_IDS.map(productId => ({ vendorId: SONY_VENDOR_ID, productId })),
      });
      const device = devices[0];
      if (!device) return false;
      if (!device.opened) await device.open();
      this.device = device;
      // Transport is inferred from the report ids the device advertises: the
      // 0x31 output report is the Bluetooth framing, and its presence is a
      // more reliable signal than anything else exposed to the page.
      this.bluetooth = !!device.collections?.some(c =>
        c.outputReports?.some(r => r.reportId === REPORT.BT_REPORT_ID));
      this.lastError = '';
      return true;
    } catch (e) {
      // A cancelled picker throws too; there is nothing to report and nothing
      // to fix, so it is recorded for the debug row and otherwise ignored.
      this.lastError = e instanceof Error ? e.message : 'request failed';
      return false;
    }
  }

  /** Release the clutch and close.  Always worth doing: a pad left with a
   *  stiff trigger stays stiff in whatever the player opens next. */
  public async disconnect(): Promise<void> {
    if (!this.device) return;
    try {
      await this.applyTriggers(TRIGGER_OFF, TRIGGER_OFF, true);
      await this.device.close();
    } catch { /* closing a pad that has already gone is not a problem */ }
    this.device = null;
    this.currentRight = TRIGGER_OFF;
    this.currentLeft = TRIGGER_OFF;
  }

  /** True when the two profiles describe the same actuator state. */
  private static same(a: TriggerProfile, b: TriggerProfile): boolean {
    return a.kind === b.kind && a.start === b.start && a.end === b.end && a.strength === b.strength;
  }

  /** Switch encodings and re-send, so the change is felt immediately rather
   *  than at the next weapon swap. */
  public setEncoding(encoding: TriggerEncoding): void {
    if (this.encoding === encoding) return;
    this.encoding = encoding;
    void this.applyTriggers(this.currentRight, this.currentLeft, true);
  }

  /**
   * Apply trigger effects.  Skips the write when nothing changed, because
   * this drives a physical clutch: re-sending the same state at frame rate
   * would flood the pad's endpoint for no benefit.
   */
  public async applyTriggers(right: TriggerProfile, left: TriggerProfile, force = false): Promise<void> {
    if (!this.isConnected()) return;
    if (!force
        && DualSenseHID.same(right, this.currentRight)
        && DualSenseHID.same(left, this.currentLeft)) return;
    this.currentRight = right;
    this.currentLeft = left;
    await this.send(buildTriggerData(right, left, this.encoding));
  }

  /** Run the motors straight off the HID report — see `buildRumbleData` for
   *  why this exists.  Stops itself, because a stuck motor is worse than a
   *  silent one. */
  public async pulseRumble(ms = 400): Promise<void> {
    if (!this.isConnected()) return;
    await this.send(buildRumbleData(1, 1));
    setTimeout(() => { void this.send(buildRumbleData(0, 0)); }, ms);
  }

  private async send(data: Uint8Array): Promise<void> {
    const { reportId, bytes } = buildOutputReport(data, this.bluetooth, this.seq++);
    this.lastHex = Array.from(bytes.slice(0, 14))
      .map(b => b.toString(16).padStart(2, '0')).join(' ');
    this.lastSentAt = Date.now();
    try {
      await this.device!.sendReport(reportId, bytes);
      this.lastError = '';
    } catch (e) {
      // The most useful line in the whole feature: Chrome refuses a report
      // whose length disagrees with the descriptor, and says so.
      this.lastError = e instanceof Error ? e.message : 'send failed';
    }
  }

  /** One line for the DBG panel: enough to tell "not supported" from "not
   *  connected" from "sending, and here are the bytes". */
  public debugInfo(): string {
    if (!DualSenseHID.isSupported()) return 'unsupported (needs desktop Chromium/Edge)';
    if (!this.isConnected()) return this.lastError ? `not connected · ${this.lastError}` : 'not connected';
    const age = this.lastSentAt ? `${((Date.now() - this.lastSentAt) / 1000).toFixed(1)}s ago` : 'nothing sent';
    return `${this.bluetooth ? 'bt' : 'usb'} · ${this.encoding} · ${this.lastError || age}`;
  }

  public lastReportHex(): string {
    return this.lastHex || '—';
  }
}
