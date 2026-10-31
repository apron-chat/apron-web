import { describe, expect, it } from 'vitest';
import html from '../../app.html?raw';
import { cssForTheme, decodeAppearance, DEFAULT_APPEARANCE, parseThemeCss, sanitizeFontFamily, THEME_CSS_MAX, THEMES, UNSAFE_VALUE } from './appearance.svelte';

describe('appearance preferences', () => {
	it('defaults to the system mode and the Apron theme', () => {
		expect(decodeAppearance(undefined)).toEqual(DEFAULT_APPEARANCE);
		expect(cssForTheme(DEFAULT_APPEARANCE)).toBe(THEMES[0].css);
	});

	it('keeps only supported modes and themes', () => {
		expect(decodeAppearance({ mode: 'dark', theme: 'ferrous', customCss: '--accent: red;' })).toEqual({ mode: 'dark', theme: 'ferrous', customCss: '--accent: red;' });
		expect(decodeAppearance({ mode: 'sepia', theme: 'neon', customCss: 7 })).toEqual(DEFAULT_APPEARANCE);
		expect(decodeAppearance({ theme: 'custom', customCss: 'x'.repeat(THEME_CSS_MAX + 1) })).toEqual({ mode: 'system', theme: 'custom', customCss: '' });
	});

	it('turns fonts saved before themes into a custom theme', () => {
		const migrated = decodeAppearance({ mode: 'light', interfaceFont: 'Inter', chatFont: '', monoFont: 'Foo; color:red' });
		expect(migrated).toMatchObject({ mode: 'light', theme: 'custom' });
		expect(parseThemeCss(migrated.customCss).vars).toEqual([
			['--font-sans', '"Inter", var(--font-sans-system)'],
			['--font-chat', 'var(--font-sans)'],
			['--font-mono', 'var(--font-mono-system)']
		]);
		expect(decodeAppearance({ mode: 'dark', interfaceFont: '', chatFont: '', monoFont: '' })).toEqual({ ...DEFAULT_APPEARANCE, mode: 'dark' });
	});

	it('sets Ferrous in Recursive, graphite and cream from its base colors, and every premade theme reads cleanly', () => {
		const ferrous = new Map(parseThemeCss(THEMES.find((theme) => theme.id === 'ferrous')!.css).vars);
		expect(ferrous.get('--font-sans')).toBe('"Recursive Sans Casual Static", "Apron Recursive Casual", var(--font-sans-system)');
		expect(ferrous.get('--font-mono')).toBe('"RecMonoCasual Nerd Font", "Rec Mono Casual", "Apron Rec Mono Casual", var(--font-mono-system)');
		expect(ferrous.get('--bg-100')).toBe('light-dark(#f2efe8, #292929)');
		expect(ferrous.get('--accent')).toBe('light-dark(#2a2926, #f0e9d8)');
		for (const theme of THEMES) expect(parseThemeCss(theme.css).error, theme.id).toBeUndefined();
		// The default keeps tokens.css's tuned palette: its colors are only an example, commented out.
		expect(parseThemeCss(THEMES[0].css).vars.map(([name]) => name)).toEqual(['--font-sans', '--font-chat', '--font-mono']);
		expect(cssForTheme({ mode: 'system', theme: 'custom', customCss: '--accent: red;' })).toBe('--accent: red;');
	});

	it('rejects font-family syntax rather than accepting raw CSS', () => {
		expect(sanitizeFontFamily('Comic Sans MS')).toBe('Comic Sans MS');
		expect(sanitizeFontFamily('Arial, sans-serif')).toBe('');
		expect(sanitizeFontFamily('"Injected; color:red')).toBe('');
		expect(sanitizeFontFamily('x'.repeat(65))).toBe('');
	});
});

describe('theme CSS', () => {
	it('reads custom properties, bare or in one :root block, with comments; the last of a name wins', () => {
		expect(parseThemeCss(':root {\n\t/* fonts */\n\t--font-sans: "A B",\n\t\tserif;\n\t--accent: #f00;\n\t--font-sans: Inter\n}')).toEqual({
			vars: [['--accent', '#f00'], ['--font-sans', 'Inter']]
		});
		expect(parseThemeCss('--bg-100: #000;')).toEqual({ vars: [['--bg-100', '#000']] });
		// A color for each mode: light-dark() reads like any other value.
		expect(parseThemeCss('--ink: light-dark(#000000, #ffffff);')).toEqual({ vars: [['--ink', 'light-dark(#000000, #ffffff)']] });
		expect(parseThemeCss('  /* nothing */  ')).toEqual({ vars: [] });
	});

	it('rejects anything but tokens, and values that would load something', () => {
		for (const css of [
			'body { color: red; }',
			'color: red;',
			':root { --a: x; } body { --b: y; }',
			'--font-sans: ;',
			'--bg: url(https://example.com/x.png);',
			'--bg: image-set("x.png" 1x);',
			'--font-sans: "unclosed;',
			'--a: x !important;',
			'--a: u\\72l(x);',
			'@import "x.css"; --a: b;',
			'--a: b; /* open',
			'--base-ground: red; --base-ink: #fff;',
			'--accent: red);',
			'--accent: rgb(1, 2, 3;',
			'--base-ground: light-dark(#fff, #000);',
			'x'.repeat(THEME_CSS_MAX + 1)
		]) {
			expect(parseThemeCss(css), css).toMatchObject({ vars: [], error: expect.any(String) });
		}
	});

	it('checks values in app.html, before the first paint, as the parser does', () => {
		expect(html).toContain(`!/${UNSAFE_VALUE.source}/${UNSAFE_VALUE.flags}.test(value)`);
	});
});
