/**
 * The score, laid out to the width actually available on screen.
 *
 * Layout depends on container width, so the width has to be measured rather
 * than assumed. A `ResizeObserver` is used instead of a window resize listener
 * because the editor will gain collapsible side panels, which change the score
 * width without the window changing size at all.
 */

import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Song } from '../model/types';
import { Score } from './Score';
import { layoutSong, type LayoutOptions } from './layout';
import './score.css';

export interface ScoreViewProps {
  song: Song;
  options?: Partial<LayoutOptions>;
  cursor?: { x: number; y: number } | undefined;
  onPointerDown?: ((event: React.PointerEvent<SVGSVGElement>) => void) | undefined;
}

export function ScoreView({ song, options, cursor, onPointerDown }: ScoreViewProps) {
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

  return (
    <div className="qtm-score-container" ref={containerRef}>
      {width > 0 && <Score layout={layout} cursor={cursor} onPointerDown={onPointerDown} />}
    </div>
  );
}
