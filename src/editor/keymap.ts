/**
 * The editor keymap.
 *
 * Declared as data rather than a switch statement so the same table drives both
 * key handling and the shortcut reference sheet — a help screen that drifts
 * from the real bindings is worse than none.
 *
 * Digits are reserved for fret entry, so techniques and rhythm use letters and
 * punctuation. That is the one hard constraint the layout has to respect: a
 * guitarist types "12" to mean the twelfth fret, and nothing else may compete.
 */

import { usePlaybackStore } from '../store/playbackStore';
import * as C from './commands';

export interface KeyBinding {
  /** `KeyboardEvent.key`, lowercased for letters. */
  readonly key: string;
  readonly ctrl?: boolean;
  readonly shift?: boolean;
  readonly label: string;
  readonly group:
    | 'Movement'
    | 'Notes'
    | 'Rhythm'
    | 'Techniques'
    | 'Structure'
    | 'Playback'
    | 'History';
  readonly run: () => void;
  /** Bindings that only make sense on a fretted instrument. */
  readonly stringOnly?: boolean;
}

export const KEY_BINDINGS: readonly KeyBinding[] = [
  /* Movement */
  { key: 'arrowleft', label: 'Previous beat', group: 'Movement', run: C.stepLeft },
  { key: 'arrowright', label: 'Next beat', group: 'Movement', run: C.stepRight },
  { key: 'arrowup', label: 'String / row up', group: 'Movement', run: C.stepUp },
  { key: 'arrowdown', label: 'String / row down', group: 'Movement', run: C.stepDown },
  { key: 'home', label: 'Start of bar', group: 'Movement', run: C.goToMeasureStart },
  { key: 'end', label: 'End of bar', group: 'Movement', run: C.goToMeasureEnd },
  // Deliberately not Tab: this handler is bound to the document, so swallowing
  // Tab would trap keyboard users in the score with no way to reach the
  // toolbar. Ctrl+arrows do not collide with focus navigation.
  { key: 'arrowdown', ctrl: true, label: 'Next track', group: 'Movement', run: () => C.stepTrack(1) },
  { key: 'arrowup', ctrl: true, label: 'Previous track', group: 'Movement', run: () => C.stepTrack(-1) },

  /* Notes */
  { key: 'delete', label: 'Delete note', group: 'Notes', run: () => void C.deleteAtCursor() },
  { key: 'backspace', label: 'Delete note', group: 'Notes', run: () => void C.deleteAtCursor() },
  { key: 'delete', shift: true, label: 'Delete whole beat', group: 'Notes', run: C.deleteBeatAtCursor },
  { key: ' ', label: 'Toggle drum hit / clear beat', group: 'Notes', run: toggleOrClear },

  /* Rhythm */
  { key: '[', label: 'Shorter note value', group: 'Rhythm', run: C.shortenDuration },
  { key: ']', label: 'Longer note value', group: 'Rhythm', run: C.lengthenDuration },
  { key: '.', label: 'Cycle dotted', group: 'Rhythm', run: C.cycleDots },
  { key: 't', label: 'Toggle triplet', group: 'Rhythm', run: C.toggleTriplet },
  {
    key: 'a',
    label: 'Apply note value to the note under the cursor',
    group: 'Rhythm',
    run: () => void C.applyDurationToCursorBeat(),
  },

  /* Techniques */
  { key: 'h', label: 'Hammer-on', group: 'Techniques', stringOnly: true, run: () => C.toggleTechniqueAtCursor('hammer') },
  { key: 'p', label: 'Pull-off', group: 'Techniques', stringOnly: true, run: () => C.toggleTechniqueAtCursor('pull') },
  { key: 's', label: 'Slide', group: 'Techniques', stringOnly: true, run: () => C.toggleTechniqueAtCursor('slide') },
  { key: 'b', label: 'Bend', group: 'Techniques', stringOnly: true, run: () => C.toggleTechniqueAtCursor('bend') },
  { key: 'v', label: 'Vibrato', group: 'Techniques', stringOnly: true, run: () => C.toggleTechniqueAtCursor('vibrato') },
  { key: 'm', label: 'Palm mute', group: 'Techniques', stringOnly: true, run: () => C.toggleTechniqueAtCursor('palmMute') },
  { key: 'g', label: 'Ghost note', group: 'Techniques', stringOnly: true, run: () => C.toggleTechniqueAtCursor('ghost') },
  { key: 'n', label: 'Harmonic', group: 'Techniques', stringOnly: true, run: () => C.toggleTechniqueAtCursor('harmonic') },

  /* Structure */
  { key: 'enter', label: 'Add bar at end', group: 'Structure', run: C.appendMeasure },
  { key: 'enter', ctrl: true, label: 'Insert bar here', group: 'Structure', run: C.insertMeasureAtCursor },
  { key: 'backspace', ctrl: true, label: 'Delete bar (this track)', group: 'Structure', run: C.deleteMeasureAtCursor },
  { key: 'backspace', ctrl: true, shift: true, label: 'Clear bar (keep it aligned)', group: 'Structure', run: C.clearMeasureAtCursor },
  { key: 'd', ctrl: true, label: 'Duplicate bar', group: 'Structure', run: C.duplicateMeasureAtCursor },

  /* Playback. Bare Space already places a drum hit, which is worth more here
     than matching a media player: note entry is what the user is doing most. */
  {
    key: ' ',
    ctrl: true,
    label: 'Play / pause',
    group: 'Playback',
    run: () => void usePlaybackStore.getState().toggle(),
  },
  { key: 'escape', label: 'Stop', group: 'Playback', run: () => usePlaybackStore.getState().stop() },
];

/**
 * Space does the obvious thing for the track under the cursor: on drums it
 * places a hit, and on a fretted track — where there is nothing to toggle —
 * it clears the beat.
 */
function toggleOrClear(): void {
  const track = C.currentTrack();
  if (track && track.kind === 'drums') C.toggleDrumAtCursor();
  else C.clearBeatAtCursor();
}

/** Finds the binding for an event, or undefined if the key is unbound. */
export function findBinding(event: {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}): KeyBinding | undefined {
  const key = event.key.toLowerCase();
  const ctrl = event.ctrlKey || event.metaKey;

  return KEY_BINDINGS.find(
    (b) => b.key === key && Boolean(b.ctrl) === ctrl && Boolean(b.shift) === event.shiftKey,
  );
}

/** Grouped for the shortcut reference sheet. */
export function bindingsByGroup(): Map<KeyBinding['group'], KeyBinding[]> {
  const groups = new Map<KeyBinding['group'], KeyBinding[]>();
  for (const binding of KEY_BINDINGS) {
    const list = groups.get(binding.group) ?? [];
    list.push(binding);
    groups.set(binding.group, list);
  }
  return groups;
}

/** Renders a binding as a readable shortcut, e.g. "Ctrl + Enter". */
export function describeBinding(binding: KeyBinding): string {
  const parts: string[] = [];
  if (binding.ctrl) parts.push('Ctrl');
  if (binding.shift) parts.push('Shift');
  parts.push(KEY_DISPLAY_NAMES[binding.key] ?? binding.key.toUpperCase());
  return parts.join(' + ');
}

const KEY_DISPLAY_NAMES: Readonly<Record<string, string>> = {
  arrowleft: '←',
  arrowright: '→',
  arrowup: '↑',
  arrowdown: '↓',
  ' ': 'Space',
  enter: 'Enter',
  backspace: 'Backspace',
  delete: 'Delete',
  home: 'Home',
  end: 'End',
  escape: 'Esc',
};
