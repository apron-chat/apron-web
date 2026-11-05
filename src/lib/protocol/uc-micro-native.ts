/**
 * Stands in for `uc.micro` (aliased in `vite.config.ts`), of which markdown-it asks only whether a character is
 * punctuation or a symbol (Unicode's P and S), to tell where `*` and `_` may open or close emphasis. JavaScript answers
 * that itself, from the Unicode tables the browser already has; the package spells the categories out as ranges.
 * That leaves ~5 KB out of startup JS.
 */
export const P = /\p{P}/u;
export const S = /\p{S}/u;
