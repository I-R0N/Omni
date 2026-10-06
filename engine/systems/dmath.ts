/**
 * dmath — the DETERMINISTIC MATH LAYER (engine-core S3, plan D30).
 *
 * WHY.  ECMAScript lets every engine approximate `Math.sin / cos / pow / exp /
 * log / atan2 …` however it likes, and they do differ in the last place: Node
 * 22's V8 ships fdlibm trig, Chromium 141's ships a glibc-derived one, and iOS
 * (JavaScriptCore, which is also what a Capacitor WKWebView runs) has a third
 * libm.  One ULP in an asteroid's velocity is amplified by every collision it
 * takes part in, so a replay was bit-exact WITHIN one JS engine and nowhere
 * else — which leaves "a port is a verified translation, checked by replaying
 * inputs against state hashes" (plan §1 / D0b) unbacked.
 *
 * HOW.  Everything here is built ONLY from operations the language fixes
 * exactly: `+ − × ÷` (IEEE-754 binary64, round-to-nearest-even, no fused
 * multiply-add — ECMAScript forbids contraction), `Math.sqrt` (every engine
 * lowers it to the hardware correctly-rounded instruction), `Math.floor` /
 * `Math.round` / `Math.abs` (exact by definition), and an integer VIEW of a
 * double's bits.  No other `Math.*` function is called.  The algorithms are the
 * fdlibm ones (argument reduction + the minimax kernels), which is why the
 * constants below are the familiar ones; they are accurate to a few ULP, which
 * is more than the sim needs.  ACCURACY IS NOT THE POINT — AGREEMENT IS: the
 * same input gives the same bits on every conforming engine.  `tests/sim/
 * dmath.test.ts` pins both halves (agreement through a table of bit patterns
 * that Node and the browser must reproduce, accuracy against `Math.*`).
 *
 * WHAT USES IT.  The sim: everything under `engine/` and `constants.ts` except
 * the presentation files listed in `tests/sim/guard.test.ts`
 * (`MATH_PRESENTATION`), which draw, sound and decorate and never reach a
 * replay hash.  A file not on that list may not call the libm functions this
 * module replaces — the guard fails it — so a new file is deterministic by
 * default.
 *
 * IMPORTS NOTHING, so `constants.ts` (which evaluates trig and pow at module
 * load) can take it without a cycle.
 *
 * `sqrt`, `floor`, `round`, `abs`, `min`, `max`, `sign`, `trunc` and the
 * integer helpers are exact in every engine and stay on `Math`.
 */

export const PI = 3.141592653589793;
export const TWO_PI = 6.283185307179586;
export const HALF_PI = 1.5707963267948966;
const LN2 = 0.6931471805599453;

// ── bit access ───────────────────────────────────────────────────────────────
const f64 = new Float64Array(1);
const u32 = new Uint32Array(f64.buffer);
// Which word of the pair holds the sign/exponent half.  Every engine we ship on
// is little-endian; this makes the module correct on a big-endian one too.
f64[0] = 1;
const HI = u32[1] === 0x3ff00000 ? 1 : 0;
const LO = 1 - HI;

/** 2^n for an integer n in [-1022, 1023], built from its exponent bits. */
function pow2(n: number): number {
  u32[HI] = (n + 1023) << 20;
  u32[LO] = 0;
  return f64[0];
}

/** y × 2^k for any integer k a double can express (two steps keep each
 *  factor in the normal range). */
function scalb(y: number, k: number): number {
  if (k > 2046) k = 2046;
  else if (k < -2092) k = -2092;
  const h = k >> 1;
  return y * pow2(h) * pow2(k - h);
}

// ── sin / cos ────────────────────────────────────────────────────────────────
const S1 = -1.66666666666666324348e-01;
const S2 = 8.33333333332248946124e-03;
const S3 = -1.98412698298579493134e-04;
const S4 = 2.75573137070700676789e-06;
const S5 = -2.50507602534068634195e-08;
const S6 = 1.58969099521155010221e-10;
const C1 = 4.16666666666666019037e-02;
const C2 = -1.38888888888741095749e-03;
const C3 = 2.48015872894767294178e-05;
const C4 = -2.75573143513906633035e-07;
const C5 = 2.08757232129817482790e-09;
const C6 = -1.13596475577881948265e-11;

/** sin on |x| <= pi/4. */
function ksin(x: number): number {
  const z = x * x;
  const v = z * x;
  const r = S2 + z * (S3 + z * (S4 + z * (S5 + z * S6)));
  return x + v * (S1 + z * r);
}
/** cos on |x| <= pi/4. */
function kcos(x: number): number {
  const z = x * x;
  const r = z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6)))));
  return 1 - (0.5 * z - z * r);
}

// pi/2 in three pieces (Cody-Waite): the first two have 33 significant bits, so
// n * piece is exact for |n| < 2^20 and the subtraction loses nothing.
const INV_PIO2 = 6.36619772367581382433e-01;
const PIO2_1 = 1.57079632673412561417e+00;
const PIO2_2 = 6.07710050630396597660e-11;
const PIO2_2T = 2.02226624879595063154e-21;
const REDUCE_LIMIT = 1.0e5; // |x| below this reduces with n < 2^20

/** x reduced to r in [-pi/4, pi/4] with the quadrant in `quad` (module state —
 *  the sim is single-threaded and these two never outlive the call). */
let quad = 0;
function reduce(x: number): number {
  let ax = x < 0 ? -x : x;
  if (ax <= 0.7853981633974483) { quad = 0; return x; }
  if (ax > REDUCE_LIMIT) {
    // Far outside anything the sim produces (an angle accumulating for hours):
    // fold by whole turns first.  Still pure arithmetic, so still agreed on.
    const turns = Math.floor(x / TWO_PI);
    x = x - turns * 6.28318530717958623200e+00 - turns * 2.44929359829470635445e-16;
    ax = x < 0 ? -x : x;
    if (ax <= 0.7853981633974483) { quad = 0; return x; }
  }
  const n = Math.round(x * INV_PIO2);
  const r = x - n * PIO2_1 - n * PIO2_2 - n * PIO2_2T;
  const q = n % 4;
  quad = q < 0 ? q + 4 : q;
  return r;
}

export function sin(x: number): number {
  if (!(x - x === 0)) return NaN; // NaN or ±Infinity
  const r = reduce(x);
  switch (quad) {
    case 0: return ksin(r);
    case 1: return kcos(r);
    case 2: return -ksin(r);
    default: return -kcos(r);
  }
}

export function cos(x: number): number {
  if (!(x - x === 0)) return NaN;
  const r = reduce(x);
  switch (quad) {
    case 0: return kcos(r);
    case 1: return -ksin(r);
    case 2: return -kcos(r);
    default: return ksin(r);
  }
}

export function tan(x: number): number {
  return sin(x) / cos(x);
}

// ── exp / log ────────────────────────────────────────────────────────────────
const LN2_HI = 6.93147180369123816490e-01;
const LN2_LO = 1.90821492927058770002e-10;
const INV_LN2 = 1.44269504088896338700e+00;
const P1 = 1.66666666666666019037e-01;
const P2 = -2.77777777770155933842e-03;
const P3 = 6.61375632143793436117e-05;
const P4 = -1.65339022054652515390e-06;
const P5 = 4.13813679705723846039e-08;

export function exp(x: number): number {
  if (x !== x) return NaN;
  if (x > 709.782712893384) return Infinity;
  if (x < -745.1332191019411) return 0;
  const k = Math.round(x * INV_LN2);
  const r = x - k * LN2_HI - k * LN2_LO;
  const t = r * r;
  const c = r - t * (P1 + t * (P2 + t * (P3 + t * (P4 + t * P5))));
  const y = 1 + (r + (r * c) / (2 - c));
  return scalb(y, k);
}

const LG1 = 6.666666666666735130e-01;
const LG2 = 3.999999999940941908e-01;
const LG3 = 2.857142874366239149e-01;
const LG4 = 2.222219843214978396e-01;
const LG5 = 1.818357216161805012e-01;
const LG6 = 1.531383769920937332e-01;
const LG7 = 1.479819860511658591e-01;

export function log(x: number): number {
  if (x !== x || x < 0) return NaN;
  if (x === 0) return -Infinity;
  if (x === Infinity) return Infinity;
  let k = 0;
  if (x < 2.2250738585072014e-308) { x *= 18014398509481984; k = -54; } // subnormal: scale by 2^54
  f64[0] = x;
  let hx = u32[HI];
  k += (hx >> 20) - 1023;
  hx &= 0x000fffff;
  // Normalise the mantissa into [sqrt(2)/2, sqrt(2)): fold the top of the range
  // down one binade so f stays small.
  const i = (hx + 0x95f64) & 0x100000;
  u32[HI] = hx | (i ^ 0x3ff00000);
  const m = f64[0];
  k += i >> 20;
  const f = m - 1;
  const s = f / (2 + f);
  const dk = k;
  const z = s * s;
  const w = z * z;
  const t1 = w * (LG2 + w * (LG4 + w * LG6));
  const t2 = z * (LG1 + w * (LG3 + w * (LG5 + w * LG7)));
  const R = t2 + t1;
  const hfsq = 0.5 * f * f;
  return dk * LN2_HI - ((hfsq - (s * (hfsq + R) + dk * LN2_LO)) - f);
}

export function log2(x: number): number {
  return log(x) / LN2;
}

// ── pow ──────────────────────────────────────────────────────────────────────
function isInt(y: number): boolean {
  return Math.floor(y) === y;
}

/** x^n by repeated squaring, n a non-negative integer. */
function ipow(x: number, n: number): number {
  let result = 1;
  while (n > 0) {
    if (n % 2 === 1) result *= x;
    x *= x;
    n = Math.floor(n / 2);
  }
  return result;
}

export function pow(x: number, y: number): number {
  if (y === 0) return 1;
  if (x !== x || y !== y) return NaN; // ES: pow(1, NaN) is NaN too
  if (y === 1) return x;
  if (y === 2) return x * x;
  if (y === 0.5) return x < 0 ? NaN : Math.sqrt(x);
  if (y === -1) return 1 / x;

  // Infinite exponent.
  if (y === Infinity || y === -Infinity) {
    const ax = x < 0 ? -x : x;
    if (ax === 1) return NaN;
    return (ax > 1) === (y > 0) ? Infinity : 0;
  }

  const yInt = isInt(y);
  // Small integer powers: exact repeated squaring, and the common sim case
  // (frame-rate damping ladders, squares, cubes).
  if (yInt && y >= -64 && y <= 64 && x === x && x !== Infinity && x !== -Infinity) {
    return y >= 0 ? ipow(x, y) : 1 / ipow(x, -y);
  }

  if (x === 0) {
    const negZero = 1 / x < 0;
    if (y > 0) return negZero && yInt && y % 2 !== 0 ? -0 : 0;
    return negZero && yInt && y % 2 !== 0 ? -Infinity : Infinity;
  }
  if (x === Infinity) return y > 0 ? Infinity : 0;
  if (x === -Infinity) {
    const odd = yInt && y % 2 !== 0;
    return y > 0 ? (odd ? -Infinity : Infinity) : (odd ? -0 : 0);
  }
  if (x < 0) {
    if (!yInt) return NaN;
    const mag = exp(y * log(-x));
    return y % 2 !== 0 ? -mag : mag;
  }
  return exp(y * log(x));
}

export function cbrt(x: number): number {
  if (x === 0 || x !== x || x === Infinity || x === -Infinity) return x;
  const ax = x < 0 ? -x : x;
  let r = exp(log(ax) / 3);
  r = r - (r * r * r - ax) / (3 * r * r); // one Newton step: ~full precision
  return x < 0 ? -r : r;
}

// ── atan / atan2 / asin / acos ───────────────────────────────────────────────
const ATAN_HI = [
  4.63647609000806093515e-01, 7.85398163397448278999e-01,
  9.82793723247329054082e-01, 1.57079632679489655800e+00,
];
const ATAN_LO = [
  2.26987774529616870924e-17, 3.06161699786838301793e-17,
  1.39033110312309984516e-17, 6.12323399573676603587e-17,
];
const AT0 = 3.33333333333329318027e-01;
const AT1 = -1.99999999998764832476e-01;
const AT2 = 1.42857142725034663711e-01;
const AT3 = -1.11111104054623557880e-01;
const AT4 = 9.09088713343650656196e-02;
const AT5 = -7.69187620504482999495e-02;
const AT6 = 6.66107313738753120669e-02;
const AT7 = -5.83357013379057348645e-02;
const AT8 = 4.97687799461593236017e-02;
const AT9 = -3.65315727442169155270e-02;
const AT10 = 1.62858201153657823623e-02;

export function atan(x: number): number {
  if (x !== x) return NaN;
  const neg = x < 0;
  const ax = neg ? -x : x;
  if (ax >= 6.8056473384187693e+38) return neg ? -HALF_PI : HALF_PI; // ≥ 2^66 (and ±Infinity)
  let id: number;
  let t = ax;
  if (ax < 0.4375) {
    if (ax < 3.725290298461914e-9) return x; // 2^-28: atan(x) = x to double precision
    id = -1;
  } else if (ax < 1.1875) {
    if (ax < 0.6875) { id = 0; t = (2 * ax - 1) / (2 + ax); }
    else { id = 1; t = (ax - 1) / (ax + 1); }
  } else if (ax < 2.4375) {
    id = 2; t = (ax - 1.5) / (1 + 1.5 * ax);
  } else {
    id = 3; t = -1 / ax;
  }
  const z = t * t;
  const w = z * z;
  const s1 = z * (AT0 + w * (AT2 + w * (AT4 + w * (AT6 + w * (AT8 + w * AT10)))));
  const s2 = w * (AT1 + w * (AT3 + w * (AT5 + w * (AT7 + w * AT9))));
  if (id < 0) {
    const r = t - t * (s1 + s2);
    return neg ? -r : r;
  }
  const r = ATAN_HI[id] - ((t * (s1 + s2) - ATAN_LO[id]) - t);
  return neg ? -r : r;
}

const PI_LO = 1.2246467991473531772e-16;

export function atan2(y: number, x: number): number {
  if (x !== x || y !== y) return NaN;
  const yNeg = y < 0 || (y === 0 && 1 / y < 0);
  const xNeg = x < 0 || (x === 0 && 1 / x < 0);
  const yInf = y === Infinity || y === -Infinity;
  const xInf = x === Infinity || x === -Infinity;
  if (yInf) {
    if (xInf) {
      const q = xNeg ? 3 * PI / 4 : PI / 4;
      return yNeg ? -q : q;
    }
    return yNeg ? -HALF_PI : HALF_PI;
  }
  if (xInf) {
    if (!xNeg) return yNeg ? -0 : 0;
    return yNeg ? -PI : PI;
  }
  if (y === 0) {
    if (!xNeg) return y; // ±0
    return yNeg ? -PI : PI;
  }
  if (x === 0) return yNeg ? -HALF_PI : HALF_PI;
  const ay = yNeg ? -y : y;
  const ax = xNeg ? -x : x;
  // |y/x| may overflow or underflow: the ratio's atan saturates correctly in
  // both directions, so only the infinities need care.
  const q = ay / ax;
  let z = atan(q);
  if (xNeg) z = PI - (z - PI_LO);
  return yNeg ? -z : z;
}

export function asin(x: number): number {
  if (x !== x || x > 1 || x < -1) return NaN;
  return atan2(x, Math.sqrt((1 - x) * (1 + x)));
}

export function acos(x: number): number {
  if (x !== x || x > 1 || x < -1) return NaN;
  return atan2(Math.sqrt((1 - x) * (1 + x)), x);
}

// ── hypot ────────────────────────────────────────────────────────────────────
/** sqrt(x² + y²).  The sum is plain IEEE arithmetic and sqrt is correctly
 *  rounded, so this agrees everywhere; the native `Math.hypot` is allowed to
 *  differ.  No overflow guard: nothing in the sim comes within 10^150 of one. */
export function hypot(x: number, y: number): number {
  return Math.sqrt(x * x + y * y);
}

/** Everything above, for `window.__omniDmath` and the tests. */
export const dmath = { sin, cos, tan, exp, log, log2, pow, cbrt, atan, atan2, asin, acos, hypot };
