/**
 * Timeline for the landing page's scripted scan demo. Each album runs
 * through scanning (breathing skeletons) → snap (stamp animation) →
 * result (matched card), then the demo moves to the next album.
 */
export type DemoPhase = 'scanning' | 'snap' | 'result';

export type DemoState = { phase: DemoPhase; albumIndex: number };

export const DEMO_PHASE_MS: Record<DemoPhase, number> = {
  scanning: 2400,
  snap: 700,
  result: 2400,
};

export function advanceDemo(state: DemoState, albumCount: number): DemoState {
  switch (state.phase) {
    case 'scanning':
      return { phase: 'snap', albumIndex: state.albumIndex };
    case 'snap':
      return { phase: 'result', albumIndex: state.albumIndex };
    case 'result':
      return { phase: 'scanning', albumIndex: (state.albumIndex + 1) % Math.max(albumCount, 1) };
  }
}
