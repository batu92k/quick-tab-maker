/**
 * One page of the printed score, as a standalone SVG.
 *
 * It reuses the screen renderer's `Staff` so the PDF is drawn by exactly the
 * same code as the editor — the whole reason layout is a pure function. The
 * interactive chrome (ruler, cursor, playhead) is dropped; annotations are
 * drawn as plain SVG text, since the HTML input overlay the editor uses has no
 * place on paper.
 */

import { Staff } from '../render/Score';
import type { LaidOutPage, LayoutOptions } from '../render/layout';

export interface PrintAnnotation {
  readonly text: string;
  readonly x: number;
  readonly y: number;
}

export interface PrintPageProps {
  readonly page: LaidOutPage;
  readonly options: LayoutOptions;
  readonly annotations: readonly PrintAnnotation[];
  readonly width: number;
  readonly height: number;
}

export function PrintPage({ page, options, annotations, width, height }: PrintPageProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className="qtm-score"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
    >
      {page.systems.map((system, i) => {
        // Pagination re-anchors `system.y` to the page top but leaves the staves
        // (and their notes) at their original, continuous y. The renderer draws
        // from staff geometry, so without this translate a later page's systems
        // would appear wherever they sat in the full scroll — at the bottom of
        // the sheet, or off it. The first staff starts at the system's original
        // top, so the gap between the two is exactly the shift to apply.
        const anchorY = system.staves[0]?.y ?? system.y;
        const dy = system.y - anchorY;
        return (
          <g key={i} transform={dy ? `translate(0 ${dy})` : undefined}>
            {system.staves.map((staff) => (
              <Staff key={staff.track.id} staff={staff} system={system} options={options} />
            ))}
          </g>
        );
      })}
      {annotations.map((a, i) => (
        <text
          key={i}
          x={a.x}
          y={a.y}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={options.fontSize}
          style={{ fill: 'var(--qtm-text)', fontFamily: 'var(--qtm-font-ui)', fontWeight: 600 }}
        >
          {a.text}
        </text>
      ))}
    </svg>
  );
}
