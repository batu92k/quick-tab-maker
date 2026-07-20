/**
 * Transient explanation of a refused edit.
 *
 * The model refuses invalid edits rather than half-applying them, which is the
 * right behaviour but silent: pressing a key and seeing nothing happen looks
 * identical to a broken editor. This says why.
 */

import { useEffect, useState } from 'react';
import { useSongStore } from '../store/songStore';
import './notice.css';

const DISMISS_AFTER_MS = 4000;

export function Notice() {
  const notice = useSongStore((s) => s.notice);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!notice) {
      setVisible(false);
      return;
    }
    setVisible(true);
    // Keyed on the notice id, so repeating the same message restarts the timer
    // rather than letting the original expiry dismiss it early.
    const timer = setTimeout(() => setVisible(false), DISMISS_AFTER_MS);
    return () => clearTimeout(timer);
  }, [notice]);

  if (!notice || !visible) return null;

  return (
    <div className="qtm-notice" role="status" aria-live="polite">
      {notice.message}
    </div>
  );
}
