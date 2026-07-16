/**
 * Timeline for the landing page's scripted scan demo. Each album runs
 * through scanning (breathing skeletons) → snap (stamp animation) →
 * result (matched card), then the demo moves to the next album.
 */
export type DemoPhase = 'scanning' | 'snap' | 'result';

export type DemoState = { phase: DemoPhase; albumIndex: number };

export const DEMO_PHASE_MS: Record<DemoPhase, number> = {
  scanning: 0,
  snap: 0,
  result: 0,
};

export function advanceDemo(state: DemoState, _albumCount: number): DemoState {
  return state;
}
