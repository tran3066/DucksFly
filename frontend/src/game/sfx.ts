// Tiny sound-effects layer. A lazily-created, reused HTMLAudioElement per sound so
// we do not allocate on every play and the file is fetched once. Every play is
// wrapped so a browser autoplay/restart rejection never throws into the game loop.
//
// Files live in public/ and are referenced by absolute URL so they resolve in dev
// and in a build alike.

const cache: Record<string, HTMLAudioElement> = {}

function getAudio(url: string): HTMLAudioElement | null {
  // jsdom / SSR has no Audio constructor; bail so this stays safe to import anywhere.
  if (typeof Audio === 'undefined') return null
  let a = cache[url]
  if (!a) {
    a = new Audio(url)
    a.preload = 'auto'
    cache[url] = a
  }
  return a
}

/** True while the sound at `url` is actively playing (not paused or finished). */
export function isSfxPlaying(url: string): boolean {
  const a = cache[url]
  return !!a && !a.paused && !a.ended
}

/**
 * Play a one-shot sound from the start. If it is ALREADY playing this is a no-op:
 * we never overlap or queue copies, so repeated triggers play one sound that must
 * finish before another can start.
 */
export function playSfx(url: string): void {
  const a = getAudio(url)
  if (!a) return
  if (!a.paused && !a.ended) return // already playing: do not overlap or queue
  try {
    a.currentTime = 0
    // play() returns a Promise that REJECTS asynchronously under autoplay policy;
    // catch it so a blocked play never surfaces as an unhandled rejection. The
    // outer try also covers the rare synchronous throw.
    void a.play()?.catch(() => {})
  } catch {
    // Autoplay policy or a restart race: non-fatal, just skip this play.
  }
}

const SIX_SEVEN_URL = '/sounds/six-seven-egg.mp3'

/** The "6-7" easter-egg sound, played when the two-handed alternation is detected. */
export function playSixSeven(): void {
  playSfx(SIX_SEVEN_URL)
}

/** True while the 6-7 sound is still playing, so callers can gate re-triggers. */
export function isSixSevenPlaying(): boolean {
  return isSfxPlaying(SIX_SEVEN_URL)
}

/**
 * Play a one-shot sound that MAY overlap itself. Each call plays a fresh, throwaway
 * clone of the cached element from the start, so back-to-back triggers all sound
 * (they layer instead of one swallowing the next). Use for rapid "collect" feedback
 * where every event should ding; use playSfx when overlap is unwanted. The clone is
 * unreferenced after it finishes, so it is garbage-collected.
 */
export function playSfxOverlap(url: string): void {
  const base = getAudio(url)
  if (!base) return
  try {
    const node = base.cloneNode() as HTMLAudioElement
    void node.play()?.catch(() => {})
  } catch {
    // Autoplay policy or a clone race: non-fatal, just skip this play.
  }
}

/**
 * Play a one-shot sound, RESTARTING it from the start if it is already playing.
 * Unlike playSfx (which skips while mid-play), this re-triggers on every call, so a
 * transient effect like a collision always thunks immediately and a fresh hit cuts
 * off the previous one rather than being swallowed. Reuses one cached element, so
 * (unlike playSfxOverlap) it never layers copies on top of each other.
 */
export function playSfxRestart(url: string): void {
  const a = getAudio(url)
  if (!a) return
  try {
    a.currentTime = 0
    void a.play()?.catch(() => {})
  } catch {
    // Autoplay policy or a restart race: non-fatal, just skip this play.
  }
}

const QUACK_URL = '/sounds/quack.mp3'

/** The duck quack, played on the rising edge of an open mouth. playSfx already
 *  skips while it is mid-play, so rapid quacks never overlap or queue. */
export function playQuack(): void {
  playSfx(QUACK_URL)
}

const RING_PASS_URL = '/sounds/ring-pass.mp3'

/** Bright "collect" chime when the duck flies cleanly through a ring. Overlapping
 *  so passing rings in quick succession dings for each one (none get swallowed). */
export function playRingPass(): void {
  playSfxOverlap(RING_PASS_URL)
}

const RING_HIT_URL = '/sounds/ring-hit.mp3'

/** Soft bounce when the duck clips a ring's rim instead of passing through.
 *  Restarts on each hit so every rim clip thunks immediately and a later hit cuts
 *  off the previous bounce rather than being swallowed mid-play. */
export function playRingHit(): void {
  playSfxRestart(RING_HIT_URL)
}

const MUSIC_URL = '/sounds/race-music.mp3'

/**
 * Start the looping race music from the beginning. Idempotent: if it is already
 * playing this is a no-op, so re-renders or repeated calls never restart it. The
 * track loops forever until stopMusic() is called. Reuses the one cached element.
 */
export function startMusic(): void {
  const a = getAudio(MUSIC_URL)
  if (!a) return
  a.loop = true
  if (!a.paused) return // already playing: don't restart on re-render
  try {
    a.currentTime = 0
    void a.play()?.catch(() => {})
  } catch {
    // Autoplay policy or a play race: non-fatal, just skip.
  }
}

/** Stop the race music and rewind, so the next race starts it cleanly from the top. */
export function stopMusic(): void {
  const a = getAudio(MUSIC_URL)
  if (!a) return
  try {
    a.pause()
    a.currentTime = 0
  } catch {
    // Non-fatal: nothing to stop.
  }
}

const FINISH_URL = '/sounds/finish-win.mp3'

/** Celebratory fanfare when the player crosses the finish line. Fired once per
 *  finish (the rig raises onFinish a single time), separate from the music element
 *  so stopping the music does not cut it off. */
export function playFinish(): void {
  playSfx(FINISH_URL)
}
