// Small shared helpers.

/** Escape a value for safe interpolation into HTML text/attribute context. */
export function esc(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/**
 * Lithuanian-aware case folding. JS `toLowerCase` already handles the full
 * Unicode case mappings we need (Ė→ė, Į→į, Ų→ų, Š→š, Ž→ž), which SQLite's
 * ASCII-only NOCASE collation does not.
 */
export function fold(text) {
  return String(text).toLowerCase();
}
