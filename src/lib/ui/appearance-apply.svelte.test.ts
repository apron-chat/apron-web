// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { AppearanceSettings, DEFAULT_APPEARANCE, parseThemeCss, THEMES } from './appearance.svelte';

const root = document.documentElement;
const saved = () => JSON.parse(localStorage.getItem('apron.appearance') ?? 'null');
const ferrous = parseThemeCss(THEMES.find((theme) => theme.id === 'ferrous')!.css).vars;

beforeEach(() => {
	localStorage.clear();
	document.head.innerHTML = '<meta name="theme-color" content="#15151f" media="(prefers-color-scheme: dark)"><meta name="theme-color" content="#f8f6f3" media="(prefers-color-scheme: light)">';
});

describe('applying the appearance', () => {
	it('saves fonts kept before themes again as a custom theme, and a theme kept as an earlier version had it', () => {
		localStorage.setItem('apron.appearance', JSON.stringify({ mode: 'dark', interfaceFont: 'Inter', chatFont: '', monoFont: '' }));
		new AppearanceSettings().load();
		expect(saved()).toMatchObject({ mode: 'dark', theme: 'custom' });
		expect(saved().vars).toContainEqual(['--font-sans', '"Inter", var(--font-sans-system)']);

		// Ferrous as an earlier version painted it: what app.html paints first is brought up to date.
		localStorage.setItem('apron.appearance', JSON.stringify({ mode: 'system', theme: 'ferrous', customCss: '', vars: [['--bg-100', '#000000'], ['--gone', 'x']] }));
		new AppearanceSettings().load();
		expect(saved().vars).toEqual(ferrous);
		expect(root.style.getPropertyValue('--gone')).toBe('');
	});

	it('replaces only the theme\'s own tokens on the root, not what else sets there', () => {
		const settings = new AppearanceSettings();
		settings.update({ ...DEFAULT_APPEARANCE, theme: 'ferrous' });
		root.style.setProperty('--app-height', '400px');
		settings.update({ ...DEFAULT_APPEARANCE, theme: 'linocut' });
		expect(root.style.getPropertyValue('--app-height')).toBe('400px');
		expect(root.style.getPropertyValue('--font-mono')).toBe('var(--font-mono-system)');
		settings.update({ ...DEFAULT_APPEARANCE });
		expect(root.style.getPropertyValue('--bg-100')).toBe('');
		expect(root.style.getPropertyValue('--app-height')).toBe('400px');
		root.style.removeProperty('--app-height');
	});

	it('gives the browser\'s chrome the theme\'s ground as a color: each tag its mode\'s half, or the chosen mode\'s', () => {
		const settings = new AppearanceSettings();
		const metas = () => [...document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')].map((meta) => meta.content);
		settings.update({ ...DEFAULT_APPEARANCE, theme: 'ferrous' });
		expect(metas()).toEqual(['#292929', '#f2efe8']);
		settings.update({ ...DEFAULT_APPEARANCE, theme: 'ferrous', mode: 'dark' });
		expect(metas()).toEqual(['#292929', '#292929']);
		settings.update({ ...DEFAULT_APPEARANCE });
		expect(metas()).toEqual(['#15151f', '#f8f6f3']);
	});
});
