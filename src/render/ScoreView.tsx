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
import type { Cursor, Song } from '../model/types';
import { Score } from './Score';
import {
  cursorPosition,
  hitTest,
  layoutSong,
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
}

export function ScoreView({ song, options, cursor, playhead, snap, onHit, onScrub }: ScoreViewProps) {
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

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
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
      if (hit) onHit(hit);
    },
    [layout, onHit, scrubAt],
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
    </div>
  );
}
