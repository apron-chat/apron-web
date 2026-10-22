import { describe, expect, it } from 'vitest';

// Read from disk: Vitest hands CSS imports, `?raw` ones included, over empty. (The app has no Node types: hence the indirection.)
const fsModule = 'node:fs';
const { readFileSync } = await import(/* @vite-ignore */ fsModule) as { readFileSync: (path: URL, encoding: 'utf8') => string };
const css = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8');

/** The custom properties a block declares: the first `:root {` (dark, the reference) or `:root[data-theme='light'] {`. */
function tokens(opening: string): Map<string, string> {
	const start = css.indexOf(opening);
	const body = css.slice(start + opening.length, css.indexOf('\n}', start));
	return new Map([...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(([, name, value]) => [name, value.trim()]));
}

/** A token's color, following `var()` to the dark tokens a theme doesn't override. */
function color(name: string, theme: Map<string, string>, dark: Map<string, string>): string {
	const value = theme.get(name) ?? dark.get(name);
	const reference = value?.match(/^var\((--[\w-]+)\)$/);
	return reference ? color(reference[1], theme, dark) : value!;
}

/** `color-mix(in srgb, hex keep, black)`: each channel scaled, as a multiply by grey. */
function shade(hex: string, keep: number): string {
	return '#' + [1, 3, 5].map((at) => Math.round(parseInt(hex.slice(at, at + 2), 16) * keep).toString(16).padStart(2, '0')).join('');
}

function luminance(hex: string): number {
	const [r, g, b] = [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
	const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
	return (high + 0.05) / (low + 0.05);
}

describe('private colors', () => {
	const dark = tokens(':root {');
	const light = tokens(":root[data-theme='light'] {");

	for (const [theme, values] of [['dark', dark], ['light', light]] as const) {
		it(`sets plum, ink and muted ink at 4.5:1 or more on a private ${theme} card`, () => {
			const ground = color('--private-soft', values, dark);
			for (const ink of ['--private', '--ink', '--ink-muted']) expect(contrast(color(ink, values, dark), ground), `${ink} ${theme}`).toBeGreaterThanOrEqual(4.5);
		});

		it(`sets ink at 4.5:1 or more on a ${theme} card's quiet unread bubble, denim or plum`, () => {
			const keep = parseFloat(color('--count-shade', values, dark)) / 100;
			for (const card of ['--denim-soft', '--private-soft']) expect(contrast(color('--ink', values, dark), shade(color(card, values, dark), keep)), `${card} ${theme}`).toBeGreaterThanOrEqual(4.5);
		});
	}
});

describe('presence colors', () => {
	const dark = tokens(':root {');
	const light = tokens(":root[data-theme='light'] {");
	const grounds = ['--bg-rail', '--bg-000', '--bg-100', '--bg-200', '--bg-300'];

	for (const [theme, values] of [['dark', dark], ['light', light]] as const) {
		it(`draws the offline ring at 3:1 or more on every ${theme} ground`, () => {
			const ring = color('--presence-offline', values, dark);
			for (const ground of grounds) expect(contrast(ring, color(ground, values, dark)), `${ground} ${theme}`).toBeGreaterThanOrEqual(3);
		});
	}
});
