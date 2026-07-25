/**
 * Keyboard shortcut reference.
 *
 * Generated from the same `KEY_BINDINGS` table the handler uses, so it cannot
 * fall out of date with the real bindings.
 */

import { useDialogA11y } from '../components/useDialogA11y';
import { bindingsByGroup, describeBinding } from './keymap';
import './shortcuts.css';

export interface ShortcutSheetProps {
  onClose: () => void;
}

export function ShortcutSheet({ onClose }: ShortcutSheetProps) {
  const dialogRef = useDialogA11y<HTMLDivElement>(onClose);
  const groups = [...bindingsByGroup()];

  return (
    <div className="qtm-modal-backdrop" onClick={onClose} role="presentation">
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="qtm-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="qtm-modal-header">
          <h2>Keyboard shortcuts</h2>
          <button type="button" className="qtm-button" onClick={onClose}>
            Close
          </button>
        </header>

        <div className="qtm-shortcut-groups">
          {/* Digit entry is handled directly by the key handler rather than by
              a binding, so it is listed by hand. */}
          <section className="qtm-shortcut-group">
            <h3>Fret entry</h3>
            <dl>
              <div className="qtm-shortcut-row">
                <dt>
                  <kbd>0</kbd>&ndash;<kbd>9</kbd>
                </dt>
                <dd>Enter a fret (type two digits quickly for 10&ndash;24)</dd>
              </div>
            </dl>
          </section>

          {groups.map(([group, bindings]) => (
            <section key={group} className="qtm-shortcut-group">
              <h3>{group}</h3>
              <dl>
                {bindings.map((binding) => (
                  <div key={`${binding.key}-${binding.label}`} className="qtm-shortcut-row">
                    <dt>
                      <kbd>{describeBinding(binding)}</kbd>
                    </dt>
                    <dd>{binding.label}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}

          <section className="qtm-shortcut-group">
            <h3>History</h3>
            <dl>
              <div className="qtm-shortcut-row">
                <dt>
                  <kbd>Ctrl + Z</kbd>
                </dt>
                <dd>Undo</dd>
              </div>
              <div className="qtm-shortcut-row">
                <dt>
                  <kbd>Ctrl + Shift + Z</kbd>
                </dt>
                <dd>Redo</dd>
              </div>
            </dl>
          </section>
        </div>
      </div>
    </div>
  );
}
