/**
 * The score, laid out to the width actually available on screen.
 *
 * Layout depends on container width, so the width has to be measured rather
 * than assumed. A `ResizeObserver` is used instead of a window resize listener
 * because the editor will gain collapsible side panels, which change the score
 * width without the window changing size at all.
 *
 * This component owns the layout, so it also owns both directions of the
 * pixel/document mapping: it converts a pointer event into a document position
 * via `hitTest`, and the cursor's document position back into pixels via
 * `cursorPosition`. Keeping both here means callers deal only in document terms.
 */

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as F from '../model/fraction';
import type { Fraction } from '../model/fraction';
import { measureCapacity, snapPositionInMeasure } from '../model/song';
import type { Cursor, Song } from '../model/types';
import { Score } from './Score';
import {
  cursorPosition,
  hitTest,
  layoutSong,
  measureAt,
  offsetAtX,
  playheadPosition,
  positionAtX,
  type HitResult,
  type LayoutOptions,
} from './layout';
import './score.css';

export interface ScoreViewProps {
  song: Song;
  options?: Partial<LayoutOptions>;
  cursor?: Cursor | null;
  /** Musical position of the playhead, or undefined when not playing. */
  playhead?: { bar: number; offset: number } | undefined;
  /**
   * Snap grid for the scrub ruler. When provided (with `onScrub`), the ruler is
   * drawn and clicks on it move the playhead; `null` means free positioning but
   * the ruler still shows a beat grid.
   */
  snap?: Fraction | null | undefined;
  /** Called with the document position under a click. */
  onHit?: ((hit: HitResult) => void) | undefined;
  /** Called with a bar and continuous offset when the ruler is scrubbed. */
  onScrub?: ((bar: number, offset: number) => void) | undefined;
  /**
   * When set, on-sheet text annotations are shown as always-editable inputs
   * over the score. `onAnnotationEdit` receives each keystroke; `onAnnotation
   * Commit` fires on blur, where the caller can drop a note left blank.
   */
  onAnnotationEdit?: ((id: string, text: string) => void) | undefined;
  onAnnotationCommit?: ((id: string) => void) | undefined;
  /** Id of a freshly added note to focus for immediate typing. */
  autoFocusAnnotation?: string | undefined;
}

export function ScoreView({
  song,
  options,
  cursor,
  playhead,
  snap,
  onHit,
  onScrub,
  onAnnotationEdit,
  onAnnotationCommit,
  autoFocusAnnotation,
}: ScoreViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const scrubbing = useRef(false);

  useLayoutEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    const observer = new ResizeObserver(([entry]) => {
      const measured = entry?.contentRect.width ?? 0;
      // Round to whole pixels: sub-pixel jitter during a resize would re-run
      // layout on every frame for no visible difference.
      setWidth(Math.round(measured));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const layout = useMemo(
    () => layoutSong(song, { ...options, width: Math.max(width, 320) }),
    [song, options, width],
  );

  const caret = useMemo(() => {
    if (!cursor) return undefined;
    return cursorPosition(
      layout,
      cursor.trackId,
      cursor.measureIndex,
      cursor.beatIndex,
      cursor.line,
      cursor.insertAt,
    );
  }, [layout, cursor]);

  // Recomputed every frame during playback, which is cheap: the layout is
  // memoised against the song, and this walks one bar's onset grid.
  const playheadGeometry = useMemo(
    () => (playhead ? playheadPosition(layout, playhead.bar, playhead.offset) : undefined),
    [layout, playhead],
  );

  // The SVG is rendered at its intrinsic size, so viewBox units and CSS pixels
  // are 1:1 and subtracting the bounding rect is enough. If a zoom control is
  // added later this is the single place that has to change.
  const localPoint = (event: React.PointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const scrubAt = useCallback(
    (event: React.PointerEvent<SVGSVGElement>): boolean => {
      if (!onScrub) return false;
      const { x, y } = localPoint(event);
      const target = positionAtX(layout, x, y);
      if (!target) return false;
      onScrub(target.bar, target.offset);
      return true;
    },
    [layout, onScrub],
  );

  /**
   * Turns a raw staff hit into an edit position. On a fretted staff with a snap
   * grid, the click is snapped to the grid (and to note onsets): landing on a
   * note edits it, past the last note appends, and a grid line between two notes
   * becomes an insert position, so a shorter note can be placed between longer
   * ones just by clicking. Drums and snap-off keep the plain beat under the click.
   */
  const resolveHit = useCallback(
    (hit: HitResult, x: number): HitResult => {
      if (!snap) return hit;
      const track = song.tracks.find((t) => t.id === hit.trackId);
      // Both fretted and drum staves snap the same way — a drum hit belongs on
      // the 16th between two eighths just as much as a fret note does.
      if (!track) return hit;
      const measure = measureAt(layout, hit.trackId, hit.measureIndex);
      if (!measure) return hit;

      const rawOffset = offsetAtX(measure, x);
      const capacity = measureCapacity(song, track, hit.measureIndex);
      const beats = measure.measure.beats;
      const snapped = snapPositionInMeasure(beats, capacity, snap, rawOffset);

      // Landing on an existing onset edits it; the bar start of an empty bar and
      // anything at/past the bar line are plain appends. Every other position —
      // inside a note, or out in an empty stretch — becomes an insert, which the
      // model places by splitting the covered beat or filling the gap with a
      // rest. That is what lets a click land where it was aimed in a bar that
      // was cleared, rather than every note stacking against the start.
      const onset = beats.findIndex((b) => F.eq(b.start, snapped));
      if (onset >= 0) return { ...hit, beatIndex: onset };
      if (F.isZero(snapped) || F.gte(snapped, capacity)) {
        return { ...hit, beatIndex: beats.length };
      }
      return { ...hit, beatIndex: beats.length, insertAt: snapped };
    },
    [layout, snap, song],
  );

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      // Clicking into the score means the user wants to work here: pull keyboard
      // focus off any form control (tempo, snap, key, scale…) that still holds
      // it, or the arrow keys would keep driving that control instead of moving
      // between beats. The document-level key handler only navigates while focus
      // is not in an input.
      const active = document.activeElement;
      if (active instanceof HTMLElement) active.blur();

      // A click that lands on the ruler scrubs and starts a drag; anything else
      // is an edit. The ruler sits above the staves, so the two never overlap.
      if (scrubAt(event)) {
        scrubbing.current = true;
        event.currentTarget.setPointerCapture(event.pointerId);
        return;
      }
      if (!onHit) return;
      const { x, y } = localPoint(event);
      const hit = hitTest(layout, x, y);
      if (hit) onHit(resolveHit(hit, x));
    },
    [layout, onHit, scrubAt, resolveHit],
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      if (scrubbing.current) scrubAt(event);
    },
    [scrubAt],
  );

  const handlePointerUp = useCallback((event: React.PointerEvent<SVGSVGElement>) => {
    if (!scrubbing.current) return;
    scrubbing.current = false;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // The pointer may already be released; nothing to undo.
    }
  }, []);

  const interactive = onHit || onScrub;
  const rulerSub = onScrub ? F.toNumber(snap ?? F.QUARTER) : undefined;

  return (
    <div className="qtm-score-container" ref={containerRef}>
      {width > 0 && (
        <Score
          layout={layout}
          cursor={caret}
          playhead={playheadGeometry}
          rulerSub={rulerSub}
          onPointerDown={interactive ? handlePointerDown : undefined}
          onPointerMove={onScrub ? handlePointerMove : undefined}
          onPointerUp={onScrub ? handlePointerUp : undefined}
        />
      )}
      {/*
        Annotations are HTML inputs over the SVG rather than SVG text, so they
        are genuinely editable in place. The layer passes clicks through to the
        score except on the inputs themselves, so scrubbing and note entry still
        work underneath. The layout positions them, so screen and a future PDF
        (which will draw them as plain SVG text) cannot disagree.
      */}
      {width > 0 && onAnnotationEdit && (
        <div className="qtm-annotation-layer">
          {layout.annotations.map(({ annotation, x, y }) => (
            <input
              key={annotation.id}
              className="qtm-annotation-input"
              style={{ left: x, top: y }}
              size={Math.max(4, annotation.text.length)}
              value={annotation.text}
              placeholder="text…"
              aria-label={`Sheet note in bar ${annotation.bar + 1}`}
              autoFocus={annotation.id === autoFocusAnnotation}
              onChange={(e) => onAnnotationEdit(annotation.id, e.target.value)}
              onBlur={() => onAnnotationCommit?.(annotation.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
