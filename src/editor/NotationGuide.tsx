/**
 * Notation key.
 *
 * A read-only reference explaining the symbols the editor draws: technique
 * marks on the tab, the rhythm stems below it, and — the part that needs it
 * most — the five-line drum staff, whose noteheads and stem directions are not
 * obvious to a reader who has only seen tab.
 *
 * The little glyphs here are drawn with the same CSS classes the score uses
 * (`qtm-drum-note`, `qtm-technique`, …), so they re-colour with the theme and
 * cannot drift far from what the renderer actually paints.
 */

import { useDialogA11y } from '../components/useDialogA11y';
import { DRUM_ROWS } from '../theory/drums';
import './shortcuts.css';
import './notation-guide.css';

export interface NotationGuideProps {
  onClose: () => void;
}

/* -------------------------------------------------------------------------- */
/* Small glyphs, matched to the renderer.                                     */

/** A cross notehead (cymbals, closed hi-hat). */
function Cross({ open = false }: { open?: boolean }) {
  return (
    <svg viewBox="-10 -12 20 24" width={22} height={26} aria-hidden="true">
      <g className="qtm-drum-note">
        <line x1={-5} y1={-5} x2={5} y2={5} />
        <line x1={-5} y1={5} x2={5} y2={-5} />
        {open && <circle className="qtm-drum-ring" cx={0} cy={-9} r={3} fill="none" />}
      </g>
    </svg>
  );
}

/** A filled notehead (drums). */
function Dot() {
  return (
    <svg viewBox="-10 -12 20 24" width={22} height={26} aria-hidden="true">
      <g className="qtm-drum-note">
        <circle cx={0} cy={0} r={5} />
      </g>
    </svg>
  );
}

/** A diamond notehead (bells, cowbell). */
function Diamond() {
  return (
    <svg viewBox="-10 -12 20 24" width={22} height={26} aria-hidden="true">
      <g className="qtm-drum-note">
        <polygon points="0,-5 5,0 0,5 -5,0" />
      </g>
    </svg>
  );
}

/** A notehead with a stem, up (hands) or down (feet). */
function Stemmed({ dir }: { dir: 'up' | 'down' }) {
  const up = dir === 'up';
  return (
    <svg viewBox="-10 -16 20 32" width={22} height={34} aria-hidden="true">
      <g className="qtm-drum-note">
        <circle cx={0} cy={0} r={5} />
      </g>
      <g className="qtm-drum-stem">
        {up ? (
          <line x1={5} y1={0} x2={5} y2={-14} />
        ) : (
          <line x1={-5} y1={0} x2={-5} y2={14} />
        )}
      </g>
    </svg>
  );
}

/**
 * A rhythm stem with `flags` flags, as drawn below a guitar/bass beat: bare
 * stem = quarter, one flag = eighth, two = sixteenth, and so on.
 */
function RhythmStem({ flags }: { flags: number }) {
  const top = -14;
  return (
    <svg viewBox="-6 -18 16 24" width={18} height={26} aria-hidden="true">
      <g className="qtm-stem">
        <line x1={0} y1={4} x2={0} y2={top} />
        {Array.from({ length: flags }, (_, i) => (
          <line key={i} x1={0} y1={top + i * 4} x2={6} y2={top + i * 4 + 5} />
        ))}
      </g>
    </svg>
  );
}

/* -------------------------------------------------------------------------- */

interface RowProps {
  glyph: React.ReactNode;
  term: React.ReactNode;
  children: React.ReactNode;
}

function GuideRow({ glyph, term, children }: RowProps) {
  return (
    <div className="qtm-guide-row">
      <span className="qtm-guide-glyph">{glyph}</span>
      <div className="qtm-guide-text">
        <dt>{term}</dt>
        <dd>{children}</dd>
      </div>
    </div>
  );
}

export function NotationGuide({ onClose }: NotationGuideProps) {
  const dialogRef = useDialogA11y<HTMLDivElement>(onClose);

  return (
    <div className="qtm-modal-backdrop" onClick={onClose} role="presentation">
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="qtm-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Notation key"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="qtm-modal-header">
          <h2>Notation key</h2>
          <button type="button" className="qtm-button" onClick={onClose}>
            Close
          </button>
        </header>

        <div className="qtm-guide-groups">
          <section className="qtm-guide-group">
            <h3>Reading the tab</h3>
            <dl>
              <GuideRow glyph={<span className="qtm-guide-mono">5</span>} term="Fret number">
                Which fret to press on that string. <code>0</code> is the open string.
              </GuideRow>
              <GuideRow glyph={<span className="qtm-guide-mono qtm-guide-dim">5</span>} term="Ghost / dead note">
                A dimmed number is a ghost note — struck, but choked almost silent.
              </GuideRow>
            </dl>
          </section>

          <section className="qtm-guide-group">
            <h3>Techniques</h3>
            <p className="qtm-guide-note">Marked above the staff, on the beat they apply to.</p>
            <dl>
              <GuideRow glyph={<span className="qtm-technique">PM</span>} term="Palm mute">
                Damp the strings with the picking-hand palm for a muted, chunky tone.
              </GuideRow>
              <GuideRow glyph={<span className="qtm-technique">H</span>} term="Hammer-on">
                Sound the next note by hammering a finger down, without picking.
              </GuideRow>
              <GuideRow glyph={<span className="qtm-technique">P</span>} term="Pull-off">
                Sound the next note by pulling a finger off, without picking.
              </GuideRow>
              <GuideRow glyph={<span className="qtm-technique">/</span>} term="Slide">
                Slide from this fret into the next.
              </GuideRow>
              <GuideRow glyph={<span className="qtm-technique">b</span>} term="Bend">
                Bend the string up to raise the pitch.
              </GuideRow>
              <GuideRow glyph={<span className="qtm-technique">~</span>} term="Vibrato">
                Waver the pitch by rocking the finger.
              </GuideRow>
              <GuideRow glyph={<span className="qtm-technique">◇</span>} term="Harmonic">
                A harmonic — a chiming, bell-like note.
              </GuideRow>
            </dl>
          </section>

          <section className="qtm-guide-group">
            <h3>Note values</h3>
            <p className="qtm-guide-note">
              The stem below each beat shows how long it lasts. Each extra flag halves it.
            </p>
            <dl>
              <GuideRow glyph={<RhythmStem flags={0} />} term="Quarter">
                A plain stem: one beat in 4/4.
              </GuideRow>
              <GuideRow glyph={<RhythmStem flags={1} />} term="Eighth">
                One flag: half a beat.
              </GuideRow>
              <GuideRow glyph={<RhythmStem flags={2} />} term="Sixteenth">
                Two flags: a quarter of a beat.
              </GuideRow>
              <GuideRow
                glyph={<span className="qtm-guide-symbol">▪</span>}
                term="Rest"
              >
                A small bar on the line marks a beat with no note.
              </GuideRow>
            </dl>
          </section>

          <section className="qtm-guide-group qtm-guide-group--wide">
            <h3>Drum staff</h3>
            <p className="qtm-guide-note">
              Drums use a five-line staff. What a note <em>is</em> comes from its notehead and
              where it sits; how it is played comes from the stem.
            </p>
            <dl>
              <GuideRow glyph={<Cross />} term="Cross — cymbal or closed hi-hat">
                Crashes, the ride, and the closed hi-hat are crosses.
              </GuideRow>
              <GuideRow glyph={<Cross open />} term="Ringed cross — open hi-hat">
                A small circle above the cross means the hi-hat rings open.
              </GuideRow>
              <GuideRow glyph={<Dot />} term="Filled note — drum">
                Snare, toms and kick are solid noteheads.
              </GuideRow>
              <GuideRow glyph={<Diamond />} term="Diamond — bell / cowbell">
                The ride bell and cowbell are diamonds.
              </GuideRow>
              <GuideRow glyph={<Stemmed dir="up" />} term="Stem up — hands">
                Anything the hands play (cymbals, snare, toms) stems upward.
              </GuideRow>
              <GuideRow glyph={<Stemmed dir="down" />} term="Stem down — feet">
                The kick and hi-hat pedal stem downward, so a foot pattern reads at a glance.
              </GuideRow>
              <GuideRow glyph={<span className="qtm-accent qtm-guide-symbol">&gt;</span>} term="Accent">
                A <code>&gt;</code> above a note means hit it harder.
              </GuideRow>
              <GuideRow glyph={<span className="qtm-guide-glyph-ghost"><Dot /></span>} term="Ghost note">
                A faint notehead is a ghost note — a soft, barely-there tap.
              </GuideRow>
            </dl>

            <h4 className="qtm-guide-subhead">Where each piece sits</h4>
            <p className="qtm-guide-note">Top of the staff to the bottom:</p>
            <ul className="qtm-guide-pieces">
              {DRUM_ROWS.map((row) => (
                <li key={row.row}>{row.name}</li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
