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
 *  UNVERIFIED BY CONSTRUCTION: the byte offsets below come from the public
 *  reverse-engineering of the DualSense output report, and there is no pad in
 *  this environment to check them against.  They are collected in ONE table
 *  (`REPORT`) so a correction is a single edit, and `lastReportHex()` exposes
 *  what was actually sent so a wrong layout can be diagnosed by looking
 *  rather than by guessing.
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

/** Trigger effect modes the pad understands.  Only the three the game has a
 *  use for; the DualSense has more. */
export const TRIGGER_MODE = {
  /** No resistance — a free pull. */
  OFF: 0x00,
  /** Constant resistance from `start` onward. */
  RESISTANCE: 0x01,
  /** A "weapon" click: resistance from `start` to `end`, then it gives way. */
  WEAPON: 0x02,
} as const;

export interface TriggerEffect {
  mode: number;
  /** 0–255 along the trigger's travel. */
  start: number;
  end: number;
  /** 0–255. */
  force: number;
}

export const TRIGGER_OFF: TriggerEffect = { mode: TRIGGER_MODE.OFF, start: 0, end: 0, force: 0 };

/** Output-report geometry.  THE UNVERIFIED PART — see the file header. */
const REPORT = {
  /** Bytes of the common output block, excluding the report id. */
  DATA_LEN: 47,
  USB_REPORT_ID: 0x02,
  BT_REPORT_ID: 0x31,
  /** Prefix byte the DualSense's Bluetooth CRC is computed over. */
  BT_CRC_SEED: 0xa2,
  FLAG0: 0,
  FLAG1: 1,
  /** Enable bits in FLAG0 for the two trigger actuators. */
  FLAG0_RIGHT_TRIGGER: 0x04,
  FLAG0_LEFT_TRIGGER: 0x08,
  /** Start of each trigger's 11-byte effect block (mode + 10 parameters). */
  RIGHT_TRIGGER: 11,
  LEFT_TRIGGER: 22,
} as const;

const clampByte = (v: number) => Math.max(0, Math.min(255, Math.round(v)));

/**
 * Build the common 47-byte output block for a pair of trigger effects.
 *
 * Pure, and exported, because it is the whole of what can be checked without
 * hardware: which bytes are set, and to what.
 */
export function buildTriggerData(right: TriggerEffect, left: TriggerEffect): Uint8Array {
  const d = new Uint8Array(REPORT.DATA_LEN);
  d[REPORT.FLAG0] = REPORT.FLAG0_RIGHT_TRIGGER | REPORT.FLAG0_LEFT_TRIGGER;
  d[REPORT.FLAG1] = 0;

  const write = (at: number, e: TriggerEffect) => {
    d[at] = e.mode;
    if (e.mode === TRIGGER_MODE.RESISTANCE) {
      d[at + 1] = clampByte(e.start);
      d[at + 2] = clampByte(e.force);
    } else if (e.mode === TRIGGER_MODE.WEAPON) {
      d[at + 1] = clampByte(e.start);
      d[at + 2] = clampByte(Math.max(e.end, e.start + 1));
      d[at + 3] = clampByte(e.force);
    }
    // OFF writes the mode and leaves the parameters zeroed, which is what
    // releases the clutch.
  };
  write(REPORT.RIGHT_TRIGGER, right);
  write(REPORT.LEFT_TRIGGER, left);
  return d;
}

/**
 * Wrap the common block for the transport in use.  Over USB the block is sent
 * as-is; over Bluetooth it is preceded by a sequence/tag pair and followed by
 * a CRC-32 computed over the seed byte, the report id and the payload — get
 * that wrong and the pad silently discards the report, which is the single
 * most likely reason for "nothing happens".
 */
export function buildOutputReport(
  data: Uint8Array,
  bluetooth: boolean,
  seq: number,
): { reportId: number; bytes: Uint8Array } {
  if (!bluetooth) {
    return { reportId: REPORT.USB_REPORT_ID, bytes: data };
  }
  const payload = new Uint8Array(2 + data.length + 4);
  payload[0] = (seq & 0x0f) << 4;
  payload[1] = 0x10;
  payload.set(data, 2);

  const crcInput = new Uint8Array(2 + 2 + data.length);
  crcInput[0] = REPORT.BT_CRC_SEED;
  crcInput[1] = REPORT.BT_REPORT_ID;
  crcInput[2] = payload[0];
  crcInput[3] = payload[1];
  crcInput.set(data, 4);

  const crc = crc32(crcInput);
  const at = 2 + data.length;
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
  /** The effects currently applied, so a redundant write is skipped — these
   *  reports are a physical actuator, not a frame buffer. */
  private currentRight: TriggerEffect = TRIGGER_OFF;
  private currentLeft: TriggerEffect = TRIGGER_OFF;

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

  /** True when the two effects are the same actuator state. */
  private static same(a: TriggerEffect, b: TriggerEffect): boolean {
    return a.mode === b.mode && a.start === b.start && a.end === b.end && a.force === b.force;
  }

  /**
   * Apply trigger effects.  Skips the write when nothing changed, because
   * this drives a physical clutch: re-sending the same state at frame rate
   * would flood the pad's endpoint for no benefit.
   */
  public async applyTriggers(right: TriggerEffect, left: TriggerEffect, force = false): Promise<void> {
    if (!this.isConnected()) return;
    if (!force
        && DualSenseHID.same(right, this.currentRight)
        && DualSenseHID.same(left, this.currentLeft)) return;

    const data = buildTriggerData(right, left);
    const { reportId, bytes } = buildOutputReport(data, this.bluetooth, this.seq++);
    this.lastHex = Array.from(bytes.slice(0, 16))
      .map(b => b.toString(16).padStart(2, '0')).join(' ');

    try {
      await this.device!.sendReport(reportId, bytes);
      this.currentRight = right;
      this.currentLeft = left;
      this.lastError = '';
    } catch (e) {
      this.lastError = e instanceof Error ? e.message : 'send failed';
    }
  }

  /** One line for the DBG panel: enough to tell "not supported" from "not
   *  connected" from "sending, and here are the bytes". */
  public debugInfo(): string {
    if (!DualSenseHID.isSupported()) return 'unsupported (needs desktop Chromium/Edge)';
    if (!this.isConnected()) return this.lastError ? `not connected · ${this.lastError}` : 'not connected';
    return `${this.bluetooth ? 'bluetooth' : 'usb'}${this.lastError ? ' · ' + this.lastError : ''}`;
  }

  public lastReportHex(): string {
    return this.lastHex || '—';
  }
}
