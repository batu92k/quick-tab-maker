/**
 * Self-hosted fonts.
 *
 * These `@fontsource` packages ship the actual `.woff2` files inside our own
 * bundle — importing them here emits the `@font-face` rules and lets Vite
 * fingerprint and serve the files from our origin. Nothing is fetched from a
 * CDN, so the editor keeps working offline. Only the weights the UI actually
 * uses are imported, to keep the payload small.
 */

// Inter — the UI face. Regular for body, medium/semibold for headings and
// buttons, bold for emphasis.
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';

// JetBrains Mono — the tab face. Regular fret numbers, bold for accents.
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/700.css';
