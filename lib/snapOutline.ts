/**
 * Text outline for the "Snap!" capture stamp (demo + real Scanner), shared
 * so a future tweak can't leave the two out of sync.
 *
 * Built from 8 fixed-pixel text-shadow offsets rather than a scaled
 * duplicate copy of the text: scaling grows the halo in proportion to the
 * text block's own width/height, so a wide tracked-out word like "SNAP!"
 * spills out the sides far more than top/bottom. A fixed offset in every
 * direction stays even regardless of the text's aspect ratio. This also
 * avoids -webkit-text-stroke, which visibly artifacts/ghosts when combined
 * with the badge's animated transform (see index.css's stamp-pop keyframes).
 */
const OFFSET_PX = 1.5;

export const SNAP_TEXT_OUTLINE = [
  [OFFSET_PX, 0],
  [-OFFSET_PX, 0],
  [0, OFFSET_PX],
  [0, -OFFSET_PX],
  [OFFSET_PX, OFFSET_PX],
  [-OFFSET_PX, -OFFSET_PX],
  [OFFSET_PX, -OFFSET_PX],
  [-OFFSET_PX, OFFSET_PX],
]
  .map(([x, y]) => `${x}px ${y}px 0 var(--color-snap-outline)`)
  .join(', ');
