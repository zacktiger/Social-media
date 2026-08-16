'use client';

import { useEffect, type RefObject } from 'react';

/**
 * Closes a popover on Escape or on a click outside it, and only listens while
 * one is actually open.
 *
 * `pointerdown` rather than `click`: a click fires after the mouse comes back
 * up, so pressing on a link behind the panel would dismiss it and re-fire
 * against whatever had moved into that spot.
 */
export function useDismiss(
  ref: RefObject<HTMLElement | null>,
  onDismiss: () => void,
  active: boolean,
) {
  useEffect(() => {
    if (!active) return;

    const onPointerDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) onDismiss();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onDismiss();
    };

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [ref, onDismiss, active]);
}
