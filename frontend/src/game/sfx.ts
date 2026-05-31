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

const QUACK_URL = '/sounds/quack.mp3'

/** The duck quack, played on the rising edge of an open mouth. playSfx already
 *  skips while it is mid-play, so rapid quacks never overlap or queue. */
export function playQuack(): void {
  playSfx(QUACK_URL)
}
