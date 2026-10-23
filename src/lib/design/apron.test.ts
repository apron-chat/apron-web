import { describe, expect, it } from 'vitest';

// Read from disk: Vitest hands CSS imports, `?raw` ones included, over empty. (The app has no Node types: hence the indirection.)
const fsModule = 'node:fs';
const { readFileSync } = await import(/* @vite-ignore */ fsModule) as { readFileSync: (path: URL, encoding: 'utf8') => string };
const css = readFileSync(new URL('./apron.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

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

/** The flex shrink factor of a `flex: grow shrink basis` shorthand. */
const shrink = (flex: string | undefined) => Number(flex?.split(/\s+/)[1]);

describe('apron.css: role badges', () => {
	it('show whole or ellipsized inside their own border, never sliced by their row', () => {
		const badge = style('.ap-role');
		expect(badge.get('overflow')).toBe('hidden');
		expect(badge.get('text-overflow')).toBe('ellipsis');
		expect(badge.get('white-space')).toBe('nowrap');
		expect(badge.get('flex')).toBe('none');
		expect(badge.get('max-width')).toContain('var(--ap-role-min)');
	});

	it('drop whole where they don’t fit: a row one badge high that wraps the rest out of view', () => {
		const row = style('.ap-roles');
		expect(row.get('flex-wrap')).toBe('wrap');
		expect(row.get('overflow')).toBe('hidden');
		expect(row.get('height')).toBe('var(--ap-role-h)');
		// No lead before the first badge unless the row asks for one (a message header's gap after the name).
		expect(style('.ap-roles::before').get('width')).toBe('var(--ap-role-lead, 0px)');
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

	it('give way before the name beside them', () => {
		expect(shrink(style('.ap-member .ap-roles').get('flex'))).toBeGreaterThan(1000 * shrink(style('.ap-member-who').get('flex')));
	});
});

describe('apron.css: a message header is one line', () => {
	it('never wraps; the handle gives way first, then the badges, then the name, and the time never', () => {
		expect(style('.ap-msg-head').get('flex-wrap')).toBe('nowrap');
		const sender = shrink(style('.ap-msg-head > .ap-msg-sender').get('flex'));
		const roles = shrink(style('.ap-msg-head > .ap-roles').get('flex'));
		const handle = shrink(style('.ap-msg-head > .ap-msg-handle').get('flex'));
		expect(roles).toBeGreaterThanOrEqual(1e6 * sender);
		expect(handle).toBeGreaterThanOrEqual(1e6 * roles);
		expect(style('.ap-msg-head > .ap-msg-meta').get('flex')).toBe('none');
		const truncates = style('.ap-msg-head > :is(.ap-msg-sender, .ap-msg-handle)');
		expect(truncates.get('text-overflow')).toBe('ellipsis');
		expect(truncates.get('min-width')).toBe('0');
	});
});

describe('apron.css: text direction', () => {
	it('gives each paragraph of a message, summary or welcome its own direction', () => {
		const block = rules.find((rule) => rule.selectors.some((selector) => selector.startsWith(':where(.ap-msg-text')))!;
		expect(block.declarations.get('unicode-bidi')).toBe('plaintext');
		expect(block.declarations.get('text-align')).toBe('start');
	});

	it('isolates names, titles, previews and chips in the UI’s lines', () => {
		const inline = rules.find((rule) => rule.selectors.some((selector) => selector.startsWith(':where(.ap-msg-sender')))!;
		expect(inline.declarations.get('unicode-bidi')).toBe('plaintext');
		for (const name of ['ap-msg-sender', 'ap-msg-handle', 'ap-room-name', 'ap-thread-name', 'ap-tline-text', 'ap-reply-text', 'ap-mention', 'ap-profile-name', 'ap-profcard-name']) {
			expect(inline.selectors[0]).toContain(`.${name},`);
		}
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
