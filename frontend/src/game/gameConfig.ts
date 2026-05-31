// Game-loop tunables shared by both modes: the ring BOOST mechanic and the
// fixed-step loop safety clamp. These live in `src/debug/playgroundConfig.ts`
// (first tuned in the Person A playground) and are re-exported here so the
// official game code imports them from `game/` rather than `debug/`.

export { MAX_FRAME_DT, BOOST, BOOST_SLIDERS } from '../debug/playgroundConfig'
