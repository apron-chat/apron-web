import { describe, expect, it } from 'vitest';
import { MEMBER_LIST_WIDTHS, ROOMS_LIST_WIDTHS } from '$lib/ui/sidebar.svelte';

// Read from disk: Vitest hands CSS imports, `?raw` ones included, over empty. (The app has no Node types: hence the indirection.)
const fsModule = 'node:fs';
const fs = await import(/* @vite-ignore */ fsModule);
const { readFileSync } = fs as { readFileSync: (path: URL, encoding: 'utf8') => string };
const css = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8');

/** The custom properties a block declares, comments aside: the first `:root {` (dark, the reference), or a light one. */
function tokens(opening: string): Map<string, string> {
	const start = css.indexOf(opening);
	if (start < 0) throw new Error(`tokens.css has no ${opening} block`);
	const body = css.slice(start + opening.length, css.indexOf('\n}', start)).replace(/\/\*[\s\S]*?\*\//g, '');
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

	const themes = [['dark', dark], ['light', light]] as const;

	it('sets plum, ink and muted ink at 4.5:1 or more on a private card, dark and light', () => {
		for (const [theme, values] of themes) {
			const ground = color('--private-soft', values, dark);
			for (const ink of ['--private', '--ink', '--ink-muted']) expect(contrast(color(ink, values, dark), ground), `${ink} ${theme}`).toBeGreaterThanOrEqual(4.5);
		}
	});

	it('sets ink at 4.5:1 or more on a card\'s quiet unread bubble, denim or plum, dark and light', () => {
		for (const [theme, values] of themes) {
			const keep = parseFloat(color('--count-shade', values, dark)) / 100;
			for (const card of ['--denim-soft', '--private-soft']) expect(contrast(color('--ink', values, dark), shade(color(card, values, dark), keep)), `${card} ${theme}`).toBeGreaterThanOrEqual(4.5);
		}
	});
});

describe('role count', () => {
	const dark = tokens(':root {');
	const light = tokens(":root[data-theme='light'] {");

	it('sets its ink at 4.5:1 or more on its fill, for admin, bot and every other role, dark and light (apron.css: .ap-role-stacked)', () => {
		const pairs = [['--accent', '--on-accent'], ['--denim', '--on-accent'], ['--ink-muted', '--bg-100']];
		for (const [theme, values] of [['dark', dark], ['light', light]] as const) {
			for (const [fill, ink] of pairs) expect(contrast(color(ink, values, dark), color(fill, values, dark)), `${ink} on ${fill} ${theme}`).toBeGreaterThanOrEqual(4.5);
		}
	});
});

// Light is written twice, for the system's preference and for Preferences' choice (pure CSS can't share one block).
describe('light theme', () => {
	const dark = tokens(':root {');
	const system = tokens(":root:not([data-theme='dark']) {");
	const chosen = tokens(":root[data-theme='light'] {");

	it('declares the same tokens, to the same values, whether the system prefers it or Preferences picks it, overriding only tokens the dark theme declares', () => {
		expect(Object.fromEntries(system)).toEqual(Object.fromEntries(chosen));
		for (const name of chosen.keys()) expect(dark.has(name), name).toBe(true);
	});
});

describe('presence colors', () => {
	const dark = tokens(':root {');
	const light = tokens(":root[data-theme='light'] {");
	const grounds = ['--bg-rail', '--bg-000', '--bg-100', '--bg-200', '--bg-300'];

	it('draws the offline ring at 3:1 or more on every ground, dark and light', () => {
		for (const [theme, values] of [['dark', dark], ['light', light]] as const) {
			const ring = color('--presence-offline', values, dark);
			for (const ground of grounds) expect(contrast(ring, color(ground, values, dark)), `${ground} ${theme}`).toBeGreaterThanOrEqual(3);
		}
	});
});

// apron.css (and rail.css, the design bundle's rail) against the scales: a value a redesign retunes in tokens.css, never one written out in a rule.
describe('apron.css', () => {
	const stylesheet = ['./apron.css', './rail.css'].map((file) => readFileSync(new URL(file, import.meta.url), 'utf8')).join('\n').replace(/\/\*[\s\S]*?\*\//g, '');
	/** Every declaration, with the selector of the innermost rule holding it (a keyframe's step, inside @keyframes). */
	const declarations = [...stylesheet.matchAll(/([^{}]*)\{([^{}]*)\}/g)].flatMap(([, selector, body]) =>
		body.split(';').filter((text) => text.includes(':')).map((text) => {
			const at = text.indexOf(':');
			return { selector: selector.trim(), property: text.slice(0, at).trim(), value: text.slice(at + 1).trim(), body };
		})
	);
	const where = (d: { selector: string; property: string; value: string }) => `${d.selector} { ${d.property}: ${d.value} }`;
	const keyframe = /^(from|to|[\d.]+%)(\s*,\s*(from|to|[\d.]+%))*$/;

	it('finds the rules it checks', () => {
		expect(declarations.length).toBeGreaterThan(1000);
	});

	// Two kinds of text set their own line box: a glyph sized to its box (its font size is literal too), and a role badge's caps, trimmed to the badge.
	it('sets line heights on the --leading-* scale', () => {
		const off = declarations.filter((d) => d.property === 'line-height' && !/^(var\(--leading-[a-z]+\)|1|inherit)$/.test(d.value))
			.filter((d) => !/font-size:\s*\d+px/.test(d.body) && !d.selector.startsWith('.ap-role'));
		expect(off.map(where)).toEqual([]);
	});

	it('fades only by --opacity-disabled and --opacity-dim, outside an animation’s steps', () => {
		const off = declarations.filter((d) => d.property === 'opacity' && !keyframe.test(d.selector) && !/^(0|1|var\(--opacity-(disabled|dim)\))$/.test(d.value));
		expect(off.map(where)).toEqual([]);
	});

	it('draws focus with the --focus-ring, outside or inset', () => {
		const rings = declarations.filter((d) => d.property === 'outline' && !/^(none|0)$/.test(d.value));
		expect(rings.filter((d) => d.value !== 'var(--focus-ring)').map(where)).toEqual([]);
		const offsets = declarations.filter((d) => d.property === 'outline-offset');
		expect(offsets.filter((d) => !/^(0|var\(--focus-offset(-inset)?\))$/.test(d.value)).map(where)).toEqual([]);
	});

	// The one literal: the room header tag's point, a square turned on its corner with its tip rounded (another corner
	// under dir="rtl", where it points the other way).
	it('rounds corners only by the --radius-* scale', () => {
		const tagPoint = ['.ap-roomhead-tag::before', ":where([dir='rtl']) .ap-roomhead-tag::before"];
		const off = declarations.filter((d) => /^border(-[a-z]+)*-radius$/.test(d.property) && !tagPoint.includes(d.selector))
			.filter((d) => !d.value.split(/\s+/).every((part) => /^(0|inherit|var\(--radius-[a-z]+\))$/.test(part)));
		expect(off.map(where)).toEqual([]);
	});

	it('times transitions by the --duration-* tokens', () => {
		const off = declarations.filter((d) => d.property === 'transition' && /(^|[\s,])\d*\.?\d+m?s\b/.test(d.value.replace(/(^|[\s,])0s\b/g, '$1')));
		expect(off.map(where)).toEqual([]);
	});

	// Bold (700) is for bold in what people write: highlighted code's strong, a terminal's bold.
	it('sets weights from 400, 500 and 600', () => {
		const off = declarations.filter((d) => d.property === 'font-weight' && !['400', '500', '600'].includes(d.value))
			.filter((d) => !(d.value === '700' && ['.ap-msg-text .hljs-strong', '.ap-term-bold'].includes(d.selector)));
		expect(off.map(where)).toEqual([]);
	});

	// So a tone (ap-tone-ok, -warn, -danger) wins over a note's own color, wherever the note's rule sits.
	it('colors every note, hint, help and status line through --ap-tone, and whatever a component tones', () => {
		/** Lines named so that aren't notes a tone applies to: they keep their color inside a toned section. */
		const untoned = ['.ap-profcard-status', '.ap-emojipop-status', '.ap-checklist-note', '.ap-selbar-status', '.ap-menu-hint', '.ap-msgedit-hint'];
		/** Each element a component's markup gives a tone class: its other classes. */
		const toned = components().flatMap((markup) => [...markup.matchAll(/class=(?:"([^"]*\bap-tone-[^"]*)"|\{\[([^\]]*'ap-tone-[^\]]*)\]\})/g)])
			.map(([, plain, list]) => [...(plain ?? list).matchAll(/\b(ap-(?!tone-)[a-z-]+)/g)].map(([, name]) => `.${name}`));
		expect(toned.length).toBeGreaterThan(5);
		const named = (part: string) => !untoned.includes(part) && /^\.ap-[a-z-]+-(note|hint|help|status)$/.test(part);
		/** A rule for a note itself: a selector that ends at a note's class, or at a class a component tones. */
		const noted = (selector: string) => selector.split(/,(?![^(]*\))/).map((part) => part.trim()).filter((part) => named(part) || toned.flat().includes(part));
		const colors = declarations.filter((d) => d.property === 'color' && noted(d.selector).length > 0);
		// Counted by note, not by rule: notes that look alike share one.
		expect(colors.flatMap((d) => noted(d.selector)).length).toBeGreaterThanOrEqual(10);
		expect(colors.filter((d) => !/^var\(--ap-tone, /.test(d.value)).map(where)).toEqual([]);
		// Every element a component tones has a class colored so.
		expect(toned.filter((classes) => !colors.some((d) => d.selector.split(',').some((part) => classes.includes(part.trim()))))).toEqual([]);
	});
});

/** The markup of every component, the design system's and the app's. */
function components(): string[] {
	const { readdirSync } = fs as unknown as { readdirSync: (path: URL) => string[] };
	return ['./components/', '../components/'].flatMap((dir) => readdirSync(new URL(dir, import.meta.url)).filter((name) => name.endsWith('.svelte')).map((name) => readFileSync(new URL(dir + name, import.meta.url), 'utf8')));
}

// The page starts its side panels at the tokens' widths, before any width you dragged them to.
describe('side panel widths', () => {
	const dark = tokens(':root {');

	it('opens the rooms list at --sidebar-w and the member list at --member-list-w', () => {
		expect(`${ROOMS_LIST_WIDTHS.defaultWidth}px`).toBe(dark.get('--sidebar-w'));
		expect(`${MEMBER_LIST_WIDTHS.defaultWidth}px`).toBe(dark.get('--member-list-w'));
	});
});
