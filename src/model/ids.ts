/**
 * Id generation for document entities.
 *
 * Ids only need to be unique within one song, but they are generated with
 * enough entropy to stay unique when songs are merged or tracks are copied
 * between projects — which is what a paste-across-songs feature will need.
 */

/**
 * `crypto.randomUUID` is unavailable on insecure origins (a plain-HTTP LAN
 * address, which is exactly how someone will test this on a phone), so fall
 * back to `getRandomValues` rather than letting id generation throw.
 */
function randomId(): string {
  const c = globalThis.crypto;
  if (typeof c?.randomUUID === 'function') return c.randomUUID();
  if (typeof c?.getRandomValues === 'function') {
    const bytes = c.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Prefixed so an id is self-describing in devtools, logs and saved JSON —
 * worth the handful of bytes when debugging a malformed document by eye.
 */
export const newSongId = (): string => `song_${randomId()}`;
export const newTrackId = (): string => `trk_${randomId()}`;
export const newMeasureId = (): string => `msr_${randomId()}`;
export const newBeatId = (): string => `bt_${randomId()}`;
export const newNoteId = (): string => `nt_${randomId()}`;
