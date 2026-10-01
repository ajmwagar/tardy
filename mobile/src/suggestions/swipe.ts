/**
 * The swipe rules for reviewing suggested tardies, Tinder-style: drag right to post, left to
 * drop. A release counts as a decision past a distance or a fast flick; anything else springs
 * back. Pure, so the gesture and the tests agree.
 */
export const SWIPE_DISTANCE = 0.32; // of the card width
export const SWIPE_VELOCITY = 800; // points per second

export type SwipeOutcome = 'approve' | 'reject' | null;

export function swipeOutcome(translationX: number, velocityX: number, cardWidth: number): SwipeOutcome {
  'worklet';
  const far = Math.abs(translationX) > cardWidth * SWIPE_DISTANCE;
  const flicked = Math.abs(velocityX) > SWIPE_VELOCITY && Math.sign(velocityX) === Math.sign(translationX);
  if (!far && !flicked) return null;
  return translationX > 0 ? 'approve' : 'reject';
}

/** How strongly to show the POST / NOPE stamp while dragging (0..1). */
export function stampOpacity(translationX: number, cardWidth: number): number {
  'worklet';
  return Math.min(1, Math.abs(translationX) / (cardWidth * SWIPE_DISTANCE));
}
