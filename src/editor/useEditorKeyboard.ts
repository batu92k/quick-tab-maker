/**
 * Global keyboard handling for the editor.
 *
 * Bound to the document rather than a focused element: the user's attention is
 * on the score, and requiring a click to focus a hidden input before typing
 * frets would be a constant papercut. Typing into a real input is detected and
 * skipped instead.
 */

import { useEffect, useRef } from 'react';
import { useSongStore } from '../store/songStore';
import * as C from './commands';
import { drumPieceForKey } from './input/drumKeys';
import { drumInput } from './input/events';
import { findBinding } from './keymap';

/**
 * How long a second digit still counts as part of the same fret number.
 *
 * Frets go to 24, so "1" then "2" should mean 12, not two separate notes on
 * frets 1 and 2. A window rather than an explicit confirm keeps single-digit
 * entry — by far the common case — at one keystroke with no delay in what is
 * written to the document: fret 1 appears immediately and is replaced by 12 if
 * the second digit arrives in time.
 */
const MULTI_DIGIT_WINDOW_MS = 750;

function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

export function useEditorKeyboard(enabled = true): void {
  // Digit accumulation state is a ref, not React state: it changes on every
  // keystroke and nothing renders from it, so re-rendering would be waste.
  const pendingDigits = useRef<{ value: string; at: number } | null>(null);

  useEffect(() => {
    if (!enabled) return;

    function onKeyDown(event: KeyboardEvent): void {
      if (isTextEntry(event.target)) return;

      const { song, cursor } = useSongStore.getState();
      if (!song || !cursor) return;

      const ctrl = event.ctrlKey || event.metaKey;

      /* Undo/redo first: these must work regardless of any other state. */
      if (ctrl && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        pendingDigits.current = null;
        if (event.shiftKey) useSongStore.getState().redo();
        else useSongStore.getState().undo();
        return;
      }
      if (ctrl && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        pendingDigits.current = null;
        useSongStore.getState().redo();
        return;
      }

      /* Fret entry. */
      if (!ctrl && /^\d$/.test(event.key)) {
        const track = C.currentTrack();
        if (!track || track.kind === 'drums') return;
        event.preventDefault();

        const now = Date.now();
        const pending = pendingDigits.current;
        const continuing = pending !== null && now - pending.at < MULTI_DIGIT_WINDOW_MS;
        const combined = continuing ? `${pending.value}${event.key}` : event.key;
        const fret = Number(combined);

        // A two-digit combination past the end of the neck means the user
        // started a new number rather than continuing the old one.
        if (fret > track.fretCount) {
          pendingDigits.current = { value: event.key, at: now };
          C.setFretAtCursor(Number(event.key));
          return;
        }

        // The second digit replaces the note just written, so the document
        // never shows a fret the user did not intend for longer than a frame.
        if (continuing) useSongStore.getState().undo();
        if (C.setFretAtCursor(fret)) {
          pendingDigits.current = { value: combined, at: now };
        }
        return;
      }

      /* Everything else invalidates a partly-typed fret. */
      pendingDigits.current = null;

      /* Finger drumming. These letters overlap the technique shortcuts, but
         those are string-only, so the two sets are never live together. */
      if (!ctrl && !event.shiftKey) {
        const track = C.currentTrack();
        if (track?.kind === 'drums') {
          const piece = drumPieceForKey(event.key);
          if (piece) {
            event.preventDefault();
            C.applyNoteInput(drumInput(piece, { source: 'keyboard' }));
            return;
          }
        }
      }

      const binding = findBinding(event);
      if (!binding) return;

      const track = C.currentTrack();
      if (binding.stringOnly && track?.kind === 'drums') return;

      event.preventDefault();
      binding.run();
    }

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [enabled]);
}
