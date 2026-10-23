import { describe, expect, it } from 'vitest';
import { cssPx } from './components/util';

// Read from disk: Vitest hands CSS imports, `?raw` ones included, over empty. (The app has no Node types: hence the indirection.)
const fsModule = 'node:fs';
const { readFileSync, readdirSync } = await import(/* @vite-ignore */ fsModule) as { readFileSync: (path: URL, encoding: 'utf8') => string; readdirSync: (path: URL) => string[] };
const css = readFileSync(new URL('./apron.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const tokens = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** Every top-level rule as its selector list and declarations (at-rule blocks' inner rules included). */
const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, body]) => ({
	selectors: selector.trim().split(/,(?![^(]*\))/).map((part) => part.trim()),
	declarations: new Map([...body.matchAll(/([\w-]+)\s*:\s*([^;]+)/g)].map(([, property, value]) => [property, value.trim()]))
}));

/** The declarations of the rules naming exactly this selector, later ones winning. */
function style(selector: string): Map<string, string> {
	const merged = new Map<string, string>();
	for (const rule of rules) if (rule.selectors.includes(selector)) for (const [property, value] of rule.declarations) merged.set(property, value);
	return merged;
}

/** The dark (reference) theme's custom properties. */
const theme = new Map([...tokens.slice(tokens.indexOf(':root {')).matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(([, name, value]) => [name, value.trim()]));

/**
 * A declared length in px, its `var()`s replaced by the tokens' values (or those the rules in `scope` set, or the
 * fallback), as a browser resolves it in a box whose own width is `size`, in a row `percent` wide, at a 16px font.
 */
function px(value: string | undefined, context: { size?: number; percent?: number }, scope: string[] = []): number | undefined {
	const vars = new Map(theme);
	for (const selector of scope) for (const [property, declared] of style(selector)) if (property.startsWith('--')) vars.set(property, declared);
	let resolved = value ?? '';
	for (let pass = 0; pass < 5 && resolved.includes('var('); pass++) {
		resolved = resolved.replace(/var\((--[\w-]+)(?:,\s*([^()]*))?\)/g, (_, name: string, fallback?: string) => vars.get(name) ?? fallback ?? 'unset');
	}
	return cssPx(resolved, { ...context, em: 16 });
}

/** The flex shrink factor of a `flex: grow shrink basis` shorthand. */
const shrink = (flex: string | undefined) => Number(flex?.split(/\s+/)[1]);

/** `--ap-name-min` in px, at a 16px font. */
const nameMin = px('var(--ap-name-min)', {})!;

describe('apron.css: role badges', () => {
	it('show whole or ellipsized inside their own border, never sliced by their row, and never narrower than --ap-role-min', () => {
		const badge = style('.ap-role');
		expect(badge.get('overflow')).toBe('hidden');
		expect(badge.get('text-overflow')).toBe('ellipsis');
		expect(badge.get('white-space')).toBe('nowrap');
		expect(badge.get('flex')).toBe('none');
		const least = px('var(--ap-role-min)', {}, ['.ap-roles'])!;
		expect(least).toBeGreaterThan(0);
		for (const row of [0, least / 2, 1000]) expect(px(badge.get('max-width'), { percent: row }, ['.ap-roles']), `in a ${row}px row`).toBeGreaterThanOrEqual(least);
	});

	it('drop whole where they don’t fit: a row one badge high that wraps the rest out of view', () => {
		const row = style('.ap-roles');
		expect(row.get('flex-wrap')).toBe('wrap');
		expect(row.get('overflow')).toBe('hidden');
		// The row is --ap-role-h high, and every rule sizing a badge sizes it from --ap-role-h.
		expect(px(row.get('height'), {}, ['.ap-roles'])).toBe(px('var(--ap-role-h)', {}, ['.ap-roles']));
		const badges = rules.filter((rule) => rule.selectors.includes('.ap-role') && (rule.declarations.has('height') || rule.declarations.has('padding-block')));
		expect(badges.length).toBeGreaterThan(0);
		for (const rule of badges) expect([rule.declarations.get('height'), rule.declarations.get('padding-block')].join(' ')).toContain('var(--ap-role-h)');
		// No lead before the first badge unless the row asks for one (a message header's gap after the name).
		expect(px(style('.ap-roles::before').get('width'), {})).toBe(0);
		expect(px(style('.ap-roles::before').get('width'), {}, ['.ap-msg-head > .ap-roles'])).toBeGreaterThan(0);
		// No row of badges anywhere goes back to one unbroken line, which its edge would slice.
		for (const rule of rules) if (rule.selectors.some((selector) => /\.ap-roles$/.test(selector))) expect(rule.declarations.get('flex-wrap') ?? 'wrap').toBe('wrap');
	});

	it('stacked, keep one line, with those behind out of the flow but still in the DOM', () => {
		expect(style('.ap-roles-stack').get('flex-wrap')).toBe('nowrap');
		const behind = style('.ap-roles-stack > .ap-role-behind');
		expect(behind.get('position')).toBe('absolute');
		expect(behind.get('opacity')).toBe('0');
		expect(behind.get('display')).toBeUndefined();
		for (const kind of ['admin', 'bot', 'other']) for (const part of ['fill', 'line']) expect(style('.ap-roles').get(`--ap-role-${kind}-${part}`)).toBeTruthy();
	});

	it('stack by default, everywhere but the profile card, which has the room to show them all', () => {
		expect(tokens).toMatch(/--ap-role-overflow:\s*stack;/);
	});

	it('come first in a member row: the name gives way before them, down to its least (its avatar kept); a handle after them', () => {
		const roles = shrink(style('.ap-member .ap-roles').get('flex'));
		for (const part of ['.ap-member-who', '.ap-member-name', '.ap-member-text']) expect(shrink(style(part).get('flex'))).toBeGreaterThanOrEqual(1e6 * roles);
		expect(roles).toBeGreaterThanOrEqual(1e6 * shrink(style('.ap-member-name .ap-member-handle').get('flex')));
		const least = (selector: string, size: number, row: number) => px(style(selector).get('min-width'), { size, percent: row });
		// The name: all of a short one, --ap-name-min of a long one, the row where that's narrower.
		expect([least('.ap-member-text', 40, 1000), least('.ap-member-text', 500, 1000), least('.ap-member-text', 500, 50)]).toEqual([40, nameMin, 50]);
		// Its button: the avatar and the gap before the name, then the name's least.
		const face = px('calc(var(--avatar-sm) + var(--space-2))', {})!;
		expect([least('.ap-member-who', 500, 1000), least('.ap-member-who', 500, 50)]).toEqual([face + nameMin, 50]);
	});
});

describe('apron.css: a message header is one line', () => {
	it('never wraps; the name gives way first, down to its least, then the badges, then a handle, and the time never', () => {
		expect(style('.ap-msg-head').get('flex-wrap')).toBe('nowrap');
		const sender = shrink(style('.ap-msg-head > .ap-msg-sender').get('flex'));
		const roles = shrink(style('.ap-msg-head > .ap-roles').get('flex'));
		const handle = shrink(style('.ap-msg-head > .ap-msg-handle').get('flex'));
		expect(sender).toBeGreaterThanOrEqual(1e6 * roles);
		expect(roles).toBeGreaterThanOrEqual(1e6 * handle);
		expect(style('.ap-msg-head > .ap-msg-meta').get('flex')).toBe('none');
		const truncates = style('.ap-msg-head > :is(.ap-msg-sender, .ap-msg-handle)');
		expect(truncates.get('text-overflow')).toBe('ellipsis');
		expect(truncates.get('min-width')).toBe('0');
		// The name's least: all of a short name, --ap-name-min of a long one, or the row; where calc-size() is supported.
		const least = (size: number, row: number) => px(style('.ap-msg-head > .ap-msg-sender').get('min-width'), { size, percent: row });
		expect([least(40, 1000), least(500, 1000), least(500, 50)]).toEqual([40, nameMin, 50]);
	});
});

describe('apron.css: text direction', () => {
	it('gives each paragraph of a message, summary or welcome its own direction', () => {
		const block = rules.find((rule) => rule.selectors.some((selector) => selector.startsWith(':where(.ap-msg-text')))!;
		expect(block.declarations.get('unicode-bidi')).toBe('plaintext');
		expect(block.declarations.get('text-align')).toBe('start');
	});

	it('isolates every name, handle and sender a component shows, unless the component wraps it in <bdi> itself', () => {
		const inline = rules.find((rule) => rule.selectors.some((selector) => selector.startsWith(':where(.ap-msg-sender')))!;
		expect(inline.declarations.get('unicode-bidi')).toBe('plaintext');
		const isolated = new Set(inline.selectors[0].slice(':where('.length, -1).split(',').map((selector) => selector.trim().replace(/^\./, '')));
		const components = readdirSync(new URL('./components/', import.meta.url)).filter((name) => name.endsWith('.svelte'));
		/** Each element of a component's markup classed as a name, handle or sender, that shows text written in it. */
		const shown = components.flatMap((name) => {
			const markup = readFileSync(new URL(`./components/${name}`, import.meta.url), 'utf8');
			return [...markup.matchAll(/<(\w+)\s[^>]*class="[^"]*\b(ap-[a-z]+-(?:name|handle|sender))\b[^"]*"[^>]*>([^<]*)/g)]
				.filter(([, , , text]) => text.includes('{'))
				.map(([, tag, part]) => ({ where: `${name} .${part}`, part, bdi: tag === 'bdi' }));
		});
		expect(shown.length).toBeGreaterThan(10);
		expect(shown.filter(({ part, bdi }) => !bdi && !isolated.has(part)).map(({ where }) => where)).toEqual([]);
		// Under dir="rtl" the same strings keep the UI's alignment, on the right.
		const rtl = rules.find((rule) => rule.selectors.some((selector) => selector.startsWith(":where([dir='rtl']) :where(.ap-msg-sender")))!;
		expect(rtl.selectors[0]).toBe(`:where([dir='rtl']) ${inline.selectors[0]}`);
		expect(rtl.declarations.get('text-align')).toBe('right');
		// And the list holds no class that no component uses any more.
		const used = new Set(components.flatMap((name) => [...readFileSync(new URL(`./components/${name}`, import.meta.url), 'utf8').matchAll(/ap-[a-z-]+/g)].map(([part]) => part)));
		expect([...isolated].filter((part) => !used.has(part))).toEqual([]);
	});
});

describe('apron.css: inline chips', () => {
	it('draw each wrapped piece as a chip of its own', () => {
		const chips = rules.find((rule) => rule.selectors.includes('.ap-mention') && rule.declarations.has('box-decoration-break'))!;
		expect(chips.declarations.get('box-decoration-break')).toBe('clone');
		expect(chips.declarations.get('-webkit-box-decoration-break')).toBe('clone');
		expect(chips.selectors.some((selector) => selector.includes('.ap-msg-text') && selector.endsWith('code'))).toBe(true);
	});
});
