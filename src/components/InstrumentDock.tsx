/**
 * Sticky instrument dock.
 *
 * Pins the input surface — the fretboard and key/scale helper for a string
 * track, the drum kit for a percussion track — to the bottom of the viewport so
 * it stays in reach while a long score scrolls above it. The dock collapses to
 * its title bar (state remembered per device) for when the score needs the room.
 *
 * It is a thin shell: App assembles the panels (they need its editing state) and
 * passes them as children, so the dock owns only the chrome and the collapse.
 */

import type { ReactNode } from 'react';
import './instrument-dock.css';

export interface InstrumentDockProps {
  /** Name of the track the cursor is on, shown on the bar. */
  trackName: string;
  collapsed: boolean;
  onToggle: () => void;
  children: ReactNode;
}

export function InstrumentDock({ trackName, collapsed, onToggle, children }: InstrumentDockProps) {
  return (
    <section className="qtm-dock" aria-label="Instrument input">
      <button
        type="button"
        className="qtm-dock-bar"
        onClick={onToggle}
        aria-expanded={!collapsed}
      >
        <span className="qtm-dock-title">{trackName}</span>
        <span className="qtm-dock-toggle">{collapsed ? '▸ Show' : '▾ Hide'}</span>
      </button>
      {!collapsed && <div className="qtm-dock-body">{children}</div>}
    </section>
  );
}
