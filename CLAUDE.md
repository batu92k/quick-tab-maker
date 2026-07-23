# Quick Tab Maker

Browser-based tab editor and player for guitar, bass and drums. Local-first: no
backend, no accounts. Songs live in IndexedDB and export as `.qtm` JSON files.

## Commands

```bash
npm run dev        # dev server
npm test           # vitest run
npm run test:watch
npm run typecheck  # tsc -b --noEmit
npm run lint       # oxlint
npm run build      # tsc -b && vite build
npm run format     # prettier --write .
```

Node is installed at `C:\Program Files\nodejs`. If `node` is not on PATH in a
fresh shell, refresh it:

```powershell
$env:Path = [Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [Environment]::GetEnvironmentVariable("Path","User")
```

## Architecture

```
src/
  model/      document types, exact-rational time, edit operations, (de)serialisation
  theory/     MIDI resolution, fretboard maths, scales/chords   [wraps tonal]
  store/      zustand store, patch-based undo/redo, IndexedDB persistence
  audio/      engine interface + Tone.js backend, scheduler, metronome
  render/     pure layout engine + SVG components
  editor/     cursor, keymap, input sources
  components/ fretboard, drum kit, transport, panels
  export/     PDF
```

### Rules that hold the design together

**Musical time is exact rational arithmetic, never floats.** All positions and
durations are `Fraction` (`{n, d}`) in whole notes — see `src/model/fraction.ts`.
A triplet eighth is exactly `1/12`; in floats it drifts enough over a few hundred
bars to misorder notes. Never introduce a `number` duration.

**Every sound resolves to a MIDI note number** through `src/theory/midi.ts`
(`stringFretToMidi`, `DRUM_PIECE_TO_GM`). The audio engine, theory overlays and
future MIDI I/O all go through it. Do not compute pitches anywhere else.

**Mutation goes through `src/model/edit.ts` on Immer drafts.** Each operation
either completes leaving the document valid, or returns `false` having touched
nothing — a half-applied edit produces a patch that cannot be cleanly inverted
and corrupts undo history. The store's `edit()` records the patch pair; an
operation that returns `false` produces no patches and no history entry.

**Queries in `model/song.ts` are pure** and Immer-free, so the renderer, audio
scheduler and PDF exporter can share them.

**Layout is a pure function** (`render/layout.ts`): screen rendering,
hit-testing and PDF export all consume its output, so the PDF cannot drift from
what is on screen.

### Invariants maintained by `edit.ts`

- a measure's beats are sorted and sit back-to-back from zero, with no trailing rests
- a measure never exceeds its time signature's capacity
- at most one note per string per beat
- measures are *inserted* across all tracks so new bars stay aligned; *deletion*
  is per-track (`deleteMeasure(song, trackId, index)`), so tracks may differ in
  length and a shorter one falls silent for the extra bars. `clearMeasure` empties
  a bar in place when alignment must be kept. Layout (`barCount = max`) and the
  scheduler both key off each track's own measures, so ragged lengths need no
  special handling there.
- marker lists stay sorted, deduplicated, and always have a bar-0 entry

## Testing

Model, theory and layout are pure and carry the bulk of the tests. Component
tests opt into jsdom per file with `// @vitest-environment jsdom`; the default
environment is node. The store's tests mock `store/persistence` — IndexedDB does
not exist under node.

## Deferred but designed for

Web MIDI input (all entry already funnels through one `NoteInputEvent` shape),
sample-based instruments, standard notation view, native app, cloud sync.
