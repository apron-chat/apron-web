import { loadAppearance, saveAppearance } from './storage';

export type ThemeMode = 'system' | 'light' | 'dark';
/** A premade theme's id, or `custom` for the CSS written in Preferences. */
export type ThemeId = (typeof THEMES)[number]['id'] | 'custom';
/** A theme as the custom properties it sets on the root, in order, each name once. */
export type ThemeVars = Array<[name: string, value: string]>;

export interface AppearancePreferences {
	mode: ThemeMode;
	theme: ThemeId;
	/** The custom theme's CSS, kept while a premade theme is chosen too. */
	customCss: string;
}

/** The longest custom theme kept, in characters. */
export const THEME_CSS_MAX = 4000;
const THEME_VARS_MAX = 100;
/**
 * Values that would load something: a theme only sets tokens, so Apron still
 * fetches no fonts or images for one. app.html repeats this; keep the two in step.
 */
const UNSAFE_VALUE = /[\\{};!@]|\b(?:url|src|image|image-set|cross-fade|element)\s*\(/i;

/** A theme's CSS: the font tokens first, so a custom theme starts from them. */
function themeCss(fonts: { sans: string; chat: string; mono: string }): string {
	return `:root {
	/* Interface */
	--font-sans: ${fonts.sans};
	/* Messages */
	--font-chat: ${fonts.chat};
	/* Code, embeds and commands */
	--font-mono: ${fonts.mono};
	/* Any other token works too, such as --accent: #f28a3c; */
}
`;
}

/** Apron ships no font files: a theme names installed faces, in front of the system stacks. */
export const THEMES = [
	{ id: 'apron', name: 'Apron', css: themeCss({ sans: 'var(--font-sans-system)', chat: 'var(--font-sans)', mono: 'var(--font-mono-system)' }) },
	{
		id: 'ferrous',
		name: 'Ferrous',
		css: themeCss({
			sans: '"Recursive Sans Casual Static", "Recursive", var(--font-sans-system)',
			chat: 'var(--font-sans)',
			mono: '"RecMonoCasual Nerd Font", "Rec Mono Casual", var(--font-mono-system)'
		})
	},
	{
		id: 'newsprint',
		name: 'Newsprint',
		css: themeCss({ sans: 'var(--font-sans-system)', chat: 'ui-serif, "New York", "Iowan Old Style", Charter, Georgia, "Times New Roman", serif', mono: 'var(--font-mono-system)' })
	},
	{ id: 'terminal', name: 'Terminal', css: themeCss({ sans: 'var(--font-mono-system)', chat: 'var(--font-sans)', mono: 'var(--font-mono-system)' }) }
] as const;

export const DEFAULT_APPEARANCE: AppearancePreferences = { mode: 'system', theme: 'apron', customCss: '' };

/** One browser-local appearance preference set, shared by the shell and Preferences dialog. */
export class AppearanceSettings {
	current = $state<AppearancePreferences>({ ...DEFAULT_APPEARANCE });

	load(): void {
		const stored = loadAppearance();
		this.current = decodeAppearance(stored);
		const vars = applyAppearance(this.current);
		// Saved before themes, as fonts: saved again as a custom theme, for app.html's first paint.
		if (stored && typeof stored === 'object' && !('theme' in stored)) saveAppearance({ ...this.current, vars });
	}

	update(next: AppearancePreferences): void {
		this.current = decodeAppearance(next);
		saveAppearance({ ...this.current, vars: applyAppearance(this.current) });
	}
}

export const appearanceSettings = new AppearanceSettings();

/** Reject CSS syntax; accept a single installed family name, not a raw font-family declaration. */
export function sanitizeFontFamily(value: unknown): string {
	if (typeof value !== 'string') return '';
	const family = value.trim();
	return family.length <= 64 && /^[\p{L}\p{N} _.-]*$/u.test(family) ? family : '';
}

/** The CSS a choice of theme stands for: a premade theme's, or the custom one. */
export function cssForTheme(preferences: AppearancePreferences): string {
	return preferences.theme === 'custom' ? preferences.customCss : (THEMES.find((theme) => theme.id === preferences.theme) ?? THEMES[0]).css;
}

/**
 * Reads a theme: custom property declarations (`--name: value;`), on their own
 * or in one `:root { … }` block, with comments. Anything else is an error, and
 * so is a value that would load something (`url()`, `@import`).
 */
export function parseThemeCss(css: string): { vars: ThemeVars; error?: string } {
	const fail = (error: string) => ({ vars: [], error });
	if (css.length > THEME_CSS_MAX) return fail(`A theme can be at most ${THEME_CSS_MAX} characters.`);
	let body = css.replace(/\/\*[\s\S]*?\*\//g, ' ').trim();
	if (body.includes('/*')) return fail('A comment is missing its closing */.');
	const block = /^:root\s*\{([\s\S]*)\}$/.exec(body);
	if (block) body = block[1];
	const vars = new Map<string, string>();
	for (const part of body.split(';')) {
		const declaration = part.trim();
		if (!declaration) continue;
		const quoted = `“${declaration.length > 40 ? `${declaration.slice(0, 40)}…` : declaration}”`;
		const match = /^(--[A-Za-z0-9_-]+)\s*:\s*([\s\S]*)$/.exec(declaration);
		if (!match) return fail(`Expected a token such as --font-sans: value; at ${quoted}.`);
		const value = match[2].replace(/\s+/g, ' ').trim();
		if (!value) return fail(`${match[1]} needs a value.`);
		if (UNSAFE_VALUE.test(value)) return fail(`${match[1]} can’t use url(), @, braces, backslashes or !important.`);
		if (/["']/.test(value.replace(/"[^"]*"|'[^']*'/g, ''))) return fail(`${match[1]} has an unclosed quote.`);
		vars.delete(match[1]);
		vars.set(match[1], value);
	}
	if (vars.size > THEME_VARS_MAX) return fail(`A theme can set at most ${THEME_VARS_MAX} tokens.`);
	return { vars: [...vars] };
}

export function decodeAppearance(value: unknown): AppearancePreferences {
	if (!value || typeof value !== 'object') return { ...DEFAULT_APPEARANCE };
	const record = value as Record<string, unknown>;
	const mode = record.mode === 'light' || record.mode === 'dark' ? record.mode : 'system';
	const customCss = typeof record.customCss === 'string' && record.customCss.length <= THEME_CSS_MAX ? record.customCss : '';
	if (record.theme === 'custom' || THEMES.some((theme) => theme.id === record.theme)) return { mode, theme: record.theme as ThemeId, customCss };
	// Saved before themes: the fonts chosen then, as a custom theme.
	const [sans, chat, mono] = [record.interfaceFont, record.chatFont, record.monoFont].map(sanitizeFontFamily);
	if (sans || chat || mono) {
		const font = (family: string, fallback: string) => (family ? `"${family}", ${fallback}` : fallback);
		return {
			mode,
			theme: 'custom',
			customCss: themeCss({ sans: font(sans, 'var(--font-sans-system)'), chat: font(chat, 'var(--font-sans)'), mono: font(mono, 'var(--font-mono-system)') })
		};
	}
	return { mode, theme: DEFAULT_APPEARANCE.theme, customCss };
}

/** Sets the mode and the theme's tokens on the root, and returns the tokens. */
function applyAppearance(preferences: AppearancePreferences): ThemeVars {
	const { vars } = parseThemeCss(cssForTheme(preferences));
	if (typeof document === 'undefined') return vars;
	const root = document.documentElement;
	if (preferences.mode === 'system') delete root.dataset.theme;
	else root.dataset.theme = preferences.mode;
	// The root's inline custom properties are all the theme's (app.html sets them before the first paint).
	for (const name of [...root.style].filter((name) => name.startsWith('--'))) root.style.removeProperty(name);
	for (const [name, value] of vars) root.style.setProperty(name, value);
	// The browser's own chrome takes the chosen mode's ground too, or the theme's; System restores app.html's.
	const ground = getComputedStyle(root).getPropertyValue('--bg-100').trim();
	const themed = preferences.mode !== 'system' || vars.some(([name]) => name === '--bg-100');
	for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
		meta.dataset.system ??= meta.content;
		meta.content = !themed || !ground ? meta.dataset.system : ground;
	}
	return vars;
}
