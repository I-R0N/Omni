/** THE DOM OVERLAY'S NAMED CLASS VOCABULARY (gauntlet 5d, U2).
 *
 *  Lived at module scope in `UIOverlay.tsx` until the debug menu became its
 *  own component (`DebugMenu.tsx`): two modules now draw the same panels,
 *  chips and toggles, and a vocabulary that one of them has to copy is a
 *  vocabulary that drifts.  So it is a leaf module both import — it imports
 *  nothing itself, which also keeps it clear of the UIOverlay ⇄ DebugMenu
 *  edge.  The comments below are the originals and still describe the call
 *  sites in UIOverlay.
 */

/**
 * Shared full-screen overlay scrim (user call: "all menus slightly
 * transparent to continue displaying the dynamic map").
 *
 * ONE constant for all five overlays — main menu, pause, station, death,
 * stage-clear — so the game never has two different ideas of how much world
 * shows through.  Two deliberate choices:
 *
 * - **The alpha is a legibility floor, not a taste knob.**  The map behind is
 *   a starfield with nebulae, salvage glints and explosions, i.e. arbitrary
 *   bright colour under arbitrary text.  55% slate-950 is what keeps
 *   `text-slate-500` body copy readable over the worst case (a lit nebula)
 *   while still reading clearly as "the world is still there".
 * - **The blur is SMALL on purpose.**  A heavy `backdrop-blur` is the usual
 *   way to buy legibility, but it defeats the point — the ask is to SEE the
 *   map move, and 12px of blur turns motion into a smear.  3px softens the
 *   high-frequency starfield (which is what actually fights small text)
 *   without hiding anything that moves.
 *
 * Note this does NOT track whether the sim is running: the pause menu freezes
 * the world and still shows it, which is exactly what was asked for.
 */
export const OVERLAY_SCRIM = 'bg-slate-950/55 backdrop-blur-[3px]';

/**
 * Backing for content that must stay readable REGARDLESS of what is on the
 * map behind it — dense, small, information-bearing panels where the scrim's
 * legibility floor isn't enough.  Today that is the debug menu (rows of 10px
 * mono readouts, explicitly called out as needing to stay visible).  Nearly
 * opaque plus its own blur, so it reads like a panel sitting ON the scrim
 * rather than more transparency stacked on transparency.
 */
export const PANEL_OPAQUE = 'bg-slate-950/95 backdrop-blur-md';

/** The overlay fade-in.  Death and stage-clear both interrupt live play, so
 *  both ease in rather than snapping over the frame the fight ended. */
export const OVERLAY_FADE_IN = { animation: 'omniFadeIn 420ms ease-out both' } as const;
export const OVERLAY_KEYFRAMES = '@keyframes omniFadeIn{from{opacity:0}to{opacity:1}}';

/* ── The shared class vocabulary (gauntlet 5d, U2) ──────────────────────
 *
 * `OVERLAY_SCRIM` and `PANEL_OPAQUE` above already set the pattern: when
 * more than one surface needs to look like the same thing, the class string
 * becomes a named constant so the surfaces cannot drift apart.  The 5d audit
 * (docs/GAUNTLET_5D_LOG.md, U1) counted what happens without that discipline
 * — three neutral-panel recipes meaning one thing, the primary action button
 * in three colours across five overlays, four treatments of one collapsible
 * toggle — so the rest of the vocabulary is named here.
 *
 * The rule for reading these: a constant is the DEFAULT, and a call site that
 * departs from it should say why in a comment.  There are three such
 * departures today and each is labelled at its call site.
 */

/** TYPE SCALE.  Five steps, and the names say what each is FOR rather than
 *  how big it is, because "10px vs 11px" is the question that produced the
 *  drift.  `MICRO` is the readability floor on glass — the audit found 7px
 *  badges, which is below anything legible on a phone held at arm's length. */
export const T_MICRO = 'text-[9px]';   // badges, pips, slot numbers
export const T_NOTE  = 'text-[10px]';  // secondary captions hanging off a value
export const T_BODY  = 'text-[11px]';  // section headings, help rows, prose
export const T_ROW   = 'text-xs';      // 12px — data rows, button labels

/** The neutral information PANEL.  Sixteen of the nineteen panels in the
 *  overlay already wanted exactly this; the other three said the same thing
 *  in slightly different slate. */
export const PANEL = 'bg-slate-800/60 border border-slate-600/40 rounded-lg p-3';
/** Same panel, tighter — for a single-row strip rather than a stack. */
export const PANEL_ROW = 'bg-slate-800/60 border border-slate-600/40 rounded-lg px-3 py-2';
/** An ACCENT panel keeps the neutral body and swaps only the border, so the
 *  accent reads as a label on a familiar shape rather than a different
 *  component.  Today: amber (commerce), rose (repair), sky (outfitting),
 *  emerald (reward). */
export const panelAccent = (border: string) =>
  `bg-slate-800/60 border ${border} rounded-lg p-3`;

/** SECTION HEADING — the 11px uppercase rule the overlay already follows in
 *  every panel; named so the colour is the only thing a call site varies. */
export const HEADING = `${T_BODY} font-bold uppercase tracking-widest`;

/** SCREEN TITLE (pause, station).  Steps down at phone width: the audit
 *  measured `text-3xl` + `tracking-[0.2em]` wrapping "PLAYER MENU" onto two
 *  lines at 390px, which is the viewport this game is designed for. */
export const SCREEN_TITLE = 'text-2xl sm:text-3xl font-bold tracking-[0.15em] truncate min-w-0';
/** OUTCOME TITLE (death, stage-clear) — the two screens that interrupt play
 *  and get to shout.  Heavier than a screen title on purpose. */
export const OUTCOME_TITLE = 'text-3xl sm:text-4xl font-black tracking-[0.2em]';

/** The TAP-TARGET FLOOR.  40px is what `screens.spec.ts` already asserts on
 *  the death screen; U1 found it held nowhere else (a 16.5px front-door
 *  toggle, 24.5px shop rows).  Applied as a min-height rather than by
 *  re-padding every control, so a dense row keeps its visual density and
 *  gains only its hit area. */
export const TAP = 'min-h-[40px]';

/** PRIMARY ACTION — "carry on playing".  Station UNDOCK, pause CONTINUE,
 *  death RESPAWN and stage-clear CONTINUE all mean this, and emerald is what
 *  three of the four already were. */
export const BTN_PRIMARY =
  `bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-3 rounded-lg shadow-lg ` +
  `transition-all active:scale-95 tracking-widest uppercase ${TAP}`;
/** SECONDARY ACTION — a real choice, but not the one the screen is steering
 *  you toward. */
export const BTN_SECONDARY =
  `bg-slate-700/70 hover:bg-slate-600/70 text-slate-200 font-bold py-3 rounded-lg ` +
  `${T_ROW} tracking-widest uppercase transition-all active:scale-95 ${TAP}`;
/** A COMPACT action inside a panel (repair, sell, scrap, unmount). */
export const BTN_COMPACT =
  `px-3 py-1.5 rounded ${T_BODY} font-bold transition-all active:scale-95 ${TAP} ` +
  `disabled:opacity-40 disabled:cursor-not-allowed`;
/** A SELECTABLE chip in a grid (difficulty, maps, enemy test, dragon…).
 *  `on` is the selected accent; `off` is the shared resting state, so an
 *  unselected chip looks the same everywhere and only the hover accent
 *  differs by group. */
export const CHIP_BASE =
  `px-3 py-2 rounded-lg ${T_ROW} font-bold border transition-all active:scale-95 ${TAP}`;
export const CHIP_OFF = 'bg-slate-800 border-slate-700 text-slate-300 hover:text-white';

/** A HUD CHIP — the top-right readout stack.  One padding for the whole
 *  column; the audit found the status badges at `px-3 py-1` against
 *  `px-4 py-1.5` everywhere else, which is what made the stack's left edge
 *  ragged. */
/*  TRANSPARENCY (user call): a HUD chip sits ON the world, so the world reads
 *  through it.  The fill is the transparent half — the TEXT stays at full
 *  strength and keeps its drop shadow, so legibility comes from the marks
 *  rather than from hiding the map.  The blur is kept tiny for the same
 *  reason `OVERLAY_SCRIM`'s is: a heavy backdrop-blur buys legibility by
 *  smearing the motion the transparency exists to show. */
export const HUD_CHIP =
  'bg-slate-900/35 border rounded-lg px-2.5 py-1 shadow-lg backdrop-blur-[2px] text-right ' +
  'drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]';

/** A COLLAPSIBLE SECTION toggle.  Colour is the semantic (amber = debug,
 *  sky = help, slate = neutral) and is passed in; everything else — size,
 *  padding, tap area, the ▸/▾ affordance — is shared. */
export const SECTION_TOGGLE =
  `pointer-events-auto cursor-pointer ${T_BODY} uppercase tracking-widest ` +
  `select-none py-2 px-3 ${TAP} transition-colors`;

/** Room at the FOOT of every full-screen overlay for the floating DEBUG
 *  launcher (`DebugMenu.tsx`), which sits in the bottom-right corner over
 *  whichever overlay is up.  Content can still pass under a floating button
 *  mid-scroll — that is what floating means — but with this padding the END
 *  of every overlay scrolls clear of it, so nothing is permanently covered.
 *  Written after the overlay's own `p-*` so it wins the bottom edge; a new
 *  overlay that copies an existing overlay's container classes gets it too. */
export const OVERLAY_FAB_CLEARANCE = 'pb-16';
