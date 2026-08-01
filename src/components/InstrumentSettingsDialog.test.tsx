// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../editor/commands', () => ({ setTuning: vi.fn(), setTone: vi.fn() }));
import * as C from '../editor/commands';
import { TUNING_PRESETS, TUNINGS } from '../theory/midi';
import type { StringTrack } from '../model/types';
import { InstrumentSettingsDialog } from './InstrumentSettingsDialog';

// React needs this flag to accept `act` when no test framework has set it.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const track: StringTrack = {
  id: 'trk-1',
  name: 'Guitar',
  instrumentId: 'guitar-clean',
  mixer: { volume: 0.8, pan: 0, muted: false, solo: false },
  kind: 'guitar',
  tuning: TUNINGS.guitar.standard,
  fretCount: 22,
  capo: 0,
  measures: [],
};

// 6-string bass with a note on string 5 — dropped by any 4-string preset —
// so the confirm step actually has something to warn about.
const bassTrack: StringTrack = {
  id: 'trk-2',
  name: 'Bass',
  instrumentId: 'bass-clean',
  mixer: { volume: 0.8, pan: 0, muted: false, solo: false },
  kind: 'bass',
  tuning: TUNINGS.bass.sixString,
  fretCount: 22,
  capo: 0,
  measures: [
    {
      id: 'm1',
      beats: [
        {
          id: 'b1',
          start: { n: 0, d: 1 },
          duration: { n: 1, d: 4 },
          notes: [{ id: 'n1', string: 5, fret: 3, techniques: [] }],
        },
      ],
    },
  ],
};

describe('InstrumentSettingsDialog', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
  });

  it('lists every guitar tuning preset and selects the current one', () => {
    const root = createRoot(container);
    act(() => root.render(<InstrumentSettingsDialog track={track} onClose={() => {}} />));

    // Tuning is the first select; scope to it so the Tone select's options
    // (a second select) do not inflate the count.
    const select = container.querySelector('select') as HTMLSelectElement;
    expect(select.querySelectorAll('option').length).toBe(TUNING_PRESETS.guitar.length);
    expect(select.value).toBe('standard');

    act(() => root.unmount());
  });

  it('lists the tones for the instrument and switches on change', () => {
    const root = createRoot(container);
    act(() => root.render(<InstrumentSettingsDialog track={track} onClose={() => {}} />));

    // Tone is the last select; Tuning is the first.
    const selects = container.querySelectorAll('select');
    const toneSelect = selects[selects.length - 1] as HTMLSelectElement;
    expect(Array.from(toneSelect.options).map((o) => o.value)).toEqual([
      'guitar-clean',
      'guitar-distortion',
    ]);
    expect(toneSelect.value).toBe('guitar-clean');

    act(() => {
      toneSelect.value = 'guitar-distortion';
      toneSelect.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(vi.mocked(C.setTone)).toHaveBeenCalledWith('trk-1', 'guitar-distortion');

    act(() => root.unmount());
  });

  it('shows the current tuning readout', () => {
    const root = createRoot(container);
    act(() => root.render(<InstrumentSettingsDialog track={track} onClose={() => {}} />));

    expect(container.textContent).toContain('E2');
    expect(container.textContent).toContain('G3');

    act(() => root.unmount());
  });

  it('applies Drop D when chosen from the select', () => {
    const root = createRoot(container);
    act(() => root.render(<InstrumentSettingsDialog track={track} onClose={() => {}} />));

    const select = container.querySelector('select') as HTMLSelectElement;
    act(() => {
      select.value = 'dropD';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(vi.mocked(C.setTuning)).toHaveBeenCalledWith('trk-1', TUNINGS.guitar.dropD);

    act(() => root.unmount());
  });

  it('warns instead of retuning immediately when a preset would drop notes', () => {
    const root = createRoot(container);
    act(() => root.render(<InstrumentSettingsDialog track={bassTrack} onClose={() => {}} />));

    const select = container.querySelector('select') as HTMLSelectElement;
    act(() => {
      select.value = 'standard';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });

    const warning = container.querySelector('.qtm-tuning-warning');
    expect(warning).not.toBeNull();
    expect(warning?.textContent).toContain('delete');
    expect(vi.mocked(C.setTuning)).not.toHaveBeenCalled();

    act(() => root.unmount());
  });

  it('applies the retune once "Apply anyway" is clicked', () => {
    const root = createRoot(container);
    act(() => root.render(<InstrumentSettingsDialog track={bassTrack} onClose={() => {}} />));

    const select = container.querySelector('select') as HTMLSelectElement;
    act(() => {
      select.value = 'standard';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });

    const applyButton = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === 'Apply anyway',
    ) as HTMLButtonElement;
    act(() => {
      applyButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(vi.mocked(C.setTuning)).toHaveBeenCalledWith('trk-2', TUNINGS.bass.standard);
    expect(container.querySelector('.qtm-tuning-warning')).toBeNull();

    act(() => root.unmount());
  });

  it('discards the pending choice when "Cancel" is clicked', () => {
    const root = createRoot(container);
    act(() => root.render(<InstrumentSettingsDialog track={bassTrack} onClose={() => {}} />));

    const select = container.querySelector('select') as HTMLSelectElement;
    act(() => {
      select.value = 'standard';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });

    const cancelButton = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === 'Cancel',
    ) as HTMLButtonElement;
    act(() => {
      cancelButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(vi.mocked(C.setTuning)).not.toHaveBeenCalled();
    expect(container.querySelector('.qtm-tuning-warning')).toBeNull();

    act(() => root.unmount());
  });
});
