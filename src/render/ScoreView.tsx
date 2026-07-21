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
import type { Cursor, Song } from '../model/types';
import { Score } from './Score';
import {
  cursorPosition,
  hitTest,
  layoutSong,
  measureDurations,
  playheadPosition,
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
  /** Called with the document position under a click. */
  onHit?: ((hit: HitResult) => void) | undefined;
}

export function ScoreView({ song, options, cursor, playhead, onHit }: ScoreViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

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

  // Recomputed every frame during playback, so both halves stay cheap: the bar
  // durations are memoised against the song, and only the interpolation runs.
  const barDurations = useMemo(() => measureDurations(song), [song]);
  const playheadGeometry = useMemo(() => {
    if (!playhead) return undefined;
    const bar = barDurations[playhead.bar];
    if (!bar) return undefined;
    return playheadPosition(layout, playhead.bar, playhead.offset, F.toNumber(bar));
  }, [layout, playhead, barDurations]);

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      if (!onHit) return;
      // The SVG is rendered at its intrinsic size, so viewBox units and CSS
      // pixels are 1:1 and subtracting the bounding rect is enough. If a zoom
      // control is added later this is the single place that has to change.
      const rect = event.currentTarget.getBoundingClientRect();
      const hit = hitTest(layout, event.clientX - rect.left, event.clientY - rect.top);
      if (hit) onHit(hit);
    },
    [layout, onHit],
  );

  return (
    <div className="qtm-score-container" ref={containerRef}>
      {width > 0 && (
        <Score
          layout={layout}
          cursor={caret}
          playhead={playheadGeometry}
          onPointerDown={onHit ? handlePointerDown : undefined}
        />
      )}
    </div>
  );
}
