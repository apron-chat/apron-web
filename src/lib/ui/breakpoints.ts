/**
 * The canonical breakpoints, for scripts: the same numbers as the media queries, which tokens.css lists (CSS can't
 * read custom properties in a media query, so the stylesheets write them out).
 */

/** Under this width the app is one pane at a time, and popovers are bottom sheets: `(max-width: 719px)`. */
export const NARROW_MAX = 720;

/** From this width the member list has a column of its own; under it, it overlays the conversation: `(min-width: 960px)`. */
export const WIDE_MIN = 960;
