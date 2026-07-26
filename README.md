# Quick Tab Maker

A fast, browser-based tab editor and player for **guitar, bass, and drums**.
Local-first — no backend, no accounts, no sign-up. Sketch a riff in seconds,
hear it back, and export a clean PDF.

Songs live in your browser (IndexedDB) and export as portable `.qtm` JSON files.

## Features

- **Editable tab sheet** for guitar, bass, and drums, with undo/redo.
- **Three ways to enter notes** — click a position on the sheet and type, use the
  computer keyboard, or click the on-screen fretboard / drum-kit illustration.
  (All input funnels through one event shape, so Web MIDI can drop in later.)
- **Exact rhythmic time** — positions and durations are exact fractions, so
  triplets and dotted notes stay perfectly in order over hundreds of bars.
- **Guitar/bass techniques** — hammer-on, pull-off, slide, bend, vibrato, palm
  mute, ghost notes, and harmonics, marked above the beat.
- **Standard drum notation** — a five-line percussion staff with conventional
  noteheads (crosses for cymbals, diamonds for bells), per-note stems (hands up,
  feet down), accents, and ghost notes.
- **Playback** via Tone.js — transport with a synced playhead, metronome with
  accents and count-in, loop region, tap tempo, and a per-track mixer
  (volume / pan / mute / solo).
- **Key, scale & chord helper** — diatonic chords and suggested progressions for
  the song's key, with in-key notes and chord tones overlaid on the fretboard.
- **Sticky instrument dock** — the fretboard/kit and key & scale helper stay
  pinned below the score while you scroll a long tab; collapsible to reclaim room.
- **PDF export** — paginated A4/Letter output that reuses the on-screen renderer,
  so the print matches the screen. Configurable orientation and bars per line.
- **Song manager** — create, duplicate, rename, delete, import, and export songs.
- **Theming & preferences** — light / dark / system themes, accent colour, UI and
  tab fonts, size scaling, and bars-per-line, all per-device.
- **Built-in help** — a keyboard-shortcut sheet and a notation-key reference that
  explains every symbol the editor draws.

## Tech stack

| Concern | Choice |
|---|---|
| Build | Vite + React 19 + TypeScript (strict) |
| State | Zustand + Immer (patch-based undo/redo) |
| Audio | Tone.js |
| Music theory | tonal |
| PDF | jsPDF + svg2pdf.js |
| Persistence | IndexedDB (via `idb`) |
| Tests | Vitest (unit) + Playwright (end-to-end) |

The tab sheet is a **custom SVG renderer** (not an engraving library), which is
what makes click-to-edit and cursor hit-testing simple.

## Getting started

**Prerequisites:** [Node.js](https://nodejs.org/) LTS (18+) and npm.

```bash
npm install     # install dependencies
npm run dev     # start the dev server, then open the printed localhost URL
```

To build and preview a production bundle:

```bash
npm run build
npm run preview
```

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start the Vite dev server with hot reload |
| `npm run build` | Type-check and build for production |
| `npm run preview` | Serve the production build locally |
| `npm test` | Run unit tests once (Vitest) |
| `npm run test:watch` | Run unit tests in watch mode |
| `npm run e2e` | Run Playwright end-to-end flows (needs `npx playwright install chromium` once) |
| `npm run typecheck` | Type-check without emitting |
| `npm run lint` | Lint with oxlint |
| `npm run format` | Format with Prettier |

## Project structure

```
src/
  model/      document types, exact-rational time, edit operations, (de)serialisation
  theory/     MIDI resolution, fretboard maths, scales/chords (wraps tonal)
  store/      zustand store, patch-based undo/redo, IndexedDB persistence
  audio/      engine interface + Tone.js backend, scheduler, metronome
  render/     pure layout engine + SVG components
  editor/     cursor, keymap, input sources
  components/ fretboard, drum kit, transport, panels, instrument dock
  settings/   per-device preferences (theme, fonts, layout)
  library/    song list / manager
  export/     PDF
```

## Your data

Everything stays on your device: songs are saved in the browser's IndexedDB and
never leave it. Use **Export** to save a song as a `.qtm` file (portable JSON)
and **Import** to bring one back — that's your backup and sharing format.
Editor preferences (theme, fonts, layout) are stored separately in
`localStorage`, so importing a song never changes your appearance settings.

## License

See [LICENSE](LICENSE).
