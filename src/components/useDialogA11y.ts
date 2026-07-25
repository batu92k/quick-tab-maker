/**
 * Focus management for modal dialogs.
 *
 * A dialog that does not manage focus is a keyboard trap in the wrong
 * direction: Tab wanders off into the page behind it, and closing the dialog
 * strands focus wherever it happened to land. This hook moves focus into the
 * dialog on open, keeps Tab and Shift+Tab cycling within it, closes on Escape,
 * and — importantly — returns focus to whatever opened the dialog once it is
 * gone. Attach the returned ref to the dialog container.
 */

import { useEffect, useRef } from 'react';

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export function useDialogA11y<T extends HTMLElement>(onClose: () => void) {
  const ref = useRef<T>(null);
  // Read the latest onClose without re-running the effect, so passing an inline
  // handler does not re-focus the dialog on every render.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const node = ref.current;
    const previouslyFocused = document.activeElement as HTMLElement | null;

    // Focus the container itself (it carries tabindex=-1) rather than a control,
    // so opening a dialog does not fire a button's hover/press affordances.
    node?.focus({ preventScroll: true });

    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab' || !node) return;

      const items = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );
      if (items.length === 0) {
        event.preventDefault();
        return;
      }
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = document.activeElement;

      if (!node.contains(active)) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      // Return focus to the trigger, if it is still in the document.
      if (previouslyFocused && document.contains(previouslyFocused)) {
        previouslyFocused.focus({ preventScroll: true });
      }
    };
  }, []);

  return ref;
}
