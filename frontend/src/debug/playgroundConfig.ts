// =============================================================================
// Person A playground — central config (the playground's OWN tunables)
// =============================================================================
//
// WHERE EVERY KNOB LIVES (so "there are so many values" stops being confusing):
//   - Flight physics  (gravity, lift, forward speed, banking, pitch ...)
//       -> src/debug/flightModel.ts            (DEFAULT_FLIGHT)
//   - Chase camera    (distance back, height, look-ahead, damping ...)
//       -> src/avatar/followConfig.ts          (DEFAULT_FOLLOW)
//   - Animation       (when flap/turn clips kick in, crossfade ...)
//       -> src/avatar/animationMap.ts          (DEFAULT_ANIM_MAP)
//   - World gen       (track length/width, ring count, tree heights ...)
//       -> src/map/config.ts                   (DEFAULT_MAP_CONFIG)
//
// THIS FILE owns only what the playground itself runs that has no other home:
// the ring BOOST mechanic (it lives in the playground sim loop, not the physics
// model) plus two loop-safety constants. Every related leva slider in
// PersonAPlayground reads its default + range from here.

// --- Loop safety -------------------------------------------------------------

/**
 * Largest time step (seconds) the sim advances in a single rendered frame.
 *
 * If the tab is backgrounded or stutters, the browser hands us a huge `delta`.
 * Without this clamp the fixed-step loop would try to "catch up" all that lost
 * time at once — hundreds of sub-steps in one frame — and lock up the page (the
 * classic "spiral of death"). 0.1 means we never simulate more than 100 ms of
 * catch-up per frame; anything beyond that is simply dropped.
 */
export const MAX_FRAME_DT = 0.1

// --- Ring boost --------------------------------------------------------------
//
// HOW THE BOOST ACTUALLY WORKS (read this once and the numbers make sense):
//
//   Fly cleanly through a ring's hole -> you get a forward "kick".
//
//   The flight model constantly eases your speed back toward its normal cruise
//   target, so simply adding speed once would be cancelled within a fraction of
//   a second. Instead the boost is a SEPARATE, TEMPORARY overspeed that lives
//   only in the playground loop: the instant you pass a ring it jumps to
//   `BOOST.speed`, then shrinks a little every step until it fades to nothing
//   after about `BOOST.durationSec` seconds. While it is non-zero it pushes you
//   forward EXTRA, on top of normal flight.
//
// THE KNOBS, AND WHAT EACH ONE ACTUALLY CHANGES:
//
//   speed        -> HOW BIG the kick is the instant you pass a ring (units/sec).
//                   Bigger = a harder, faster shove forward. (leva slider)
//
//   durationSec  -> HOW LONG the kick lasts before it's basically gone (seconds).
//                   Bigger = the surge lingers longer. (leva slider)
//
//   decaySharpness (advanced) -> the SHAPE of the fade *within* durationSec, i.e.
//                   how much of the kick is left right at durationSec:
//                       6 -> ~0.2% left (exp(-6)) — snappy, surge dies fast
//                       3 -> ~5%   left (exp(-3)) — softer, lingering tail
//                   Tune `speed` and `durationSec` FIRST; only touch this if the
//                   fade feels wrong.
//
//   cutoff / minDurationSec -> tiny housekeeping guards (see each below). You can
//                   almost always ignore these.
//
// Only `speed` + `durationSec` are exposed as live sliders — they are the two you
// will actually reach for. The rest are plain constants.

export const BOOST = {
  /** Default initial kick size (units/sec). Drives the `boostSpeed` slider value. */
  speed: 10000,

  /** Default fade time (seconds). Drives the `boostDuration` slider value. */
  durationSec: 20,

  /**
   * Shape of the fade (unitless). After `durationSec` the remaining boost is
   * exp(-decaySharpness) of the initial kick: 6 -> ~0.2% left, 3 -> ~5% left.
   * Higher = more abrupt cut-off; lower = a longer lingering tail.
   */
  decaySharpness: 0.001,

  /**
   * Below this many units/sec the leftover boost is imperceptible, so we snap it
   * straight to 0 — that ends the per-frame decay math once the surge is spent.
   */
  cutoff: 0.05,

  /**
   * Lower bound used for `durationSec` when computing the decay rate, so an
   * absurdly small duration can never divide-by-zero or spike the rate.
   */
  minDurationSec: 0.2,
} as const

/**
 * Leva slider definitions for the two boost knobs tuned live in-game. Spread
 * straight into `useControls('Boost (rings)', { ...BOOST_SLIDERS })`. The starting
 * values come from BOOST above so the slider and the constant never drift apart.
 */
export const BOOST_SLIDERS = {
  // initial overspeed on a fly-through (units/sec)
  boostSpeed: { value: BOOST.speed, min: 0, max: 200, step: 1 },
  // ~time for the surge to fade (seconds)
  boostDuration: { value: BOOST.durationSec, min: 0.2, max: 4, step: 0.1 },
}

/// NOTE THESE VALUES ARE FUNKY AND I FEEL LIKE THEY DONT WORK BUT WE ARE GETTING BOBA NOW