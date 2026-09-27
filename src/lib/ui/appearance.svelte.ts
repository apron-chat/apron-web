export type ThemeMode = 'system' | 'light' | 'dark';
/** Where the installed-font suggestions stand (the Local Font Access API asks permission). */
export type FontBrowserState = 'idle' | 'loading' | 'ready' | 'unsupported' | 'denied' | 'error' | 'empty';

export interface AppearancePreferences {
	mode: ThemeMode;
	interfaceFont: string;
	chatFont: string;
	monoFont: string;
}

export const DEFAULT_APPEARANCE: AppearancePreferences = { mode: 'system', interfaceFont: '', chatFont: '', monoFont: '' };
const STORAGE_KEY = 'apron.appearance';

/** One browser-local appearance preference set, shared by the shell and Preferences dialog. */
export class AppearanceSettings {
	current = $state<AppearancePreferences>({ ...DEFAULT_APPEARANCE });

	load(): void {
		try {
			const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
			if (raw) this.current = decodeAppearance(JSON.parse(raw));
		} catch {
			this.current = { ...DEFAULT_APPEARANCE };
		}
		applyAppearance(this.current);
	}

	update(next: AppearancePreferences): void {
		this.current = decodeAppearance(next);
		applyAppearance(this.current);
		try {
			globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(this.current));
		} catch {
			// Keep the preference for this visit if storage is unavailable.
		}
	}
}

export const appearanceSettings = new AppearanceSettings();

/** Reject CSS syntax; accept a single installed family name, not a raw font-family declaration. */
export function sanitizeFontFamily(value: unknown): string {
	if (typeof value !== 'string') return '';
	const family = value.trim();
	return family.length <= 64 && /^[\p{L}\p{N} _.-]*$/u.test(family) ? family : '';
}

export function decodeAppearance(value: unknown): AppearancePreferences {
	if (!value || typeof value !== 'object') return { ...DEFAULT_APPEARANCE };
	const record = value as Record<string, unknown>;
	return {
		mode: record.mode === 'light' || record.mode === 'dark' ? record.mode : 'system',
		interfaceFont: sanitizeFontFamily(record.interfaceFont),
		chatFont: sanitizeFontFamily(record.chatFont),
		monoFont: sanitizeFontFamily(record.monoFont)
	};
}

function applyAppearance(preferences: AppearancePreferences): void {
	if (typeof document === 'undefined') return;
	const root = document.documentElement;
	if (preferences.mode === 'system') delete root.dataset.theme;
	else root.dataset.theme = preferences.mode;
	setFont(root, '--font-sans', preferences.interfaceFont, 'var(--font-sans-system)');
	setFont(root, '--font-chat', preferences.chatFont, 'var(--font-sans)');
	setFont(root, '--font-mono', preferences.monoFont, 'var(--font-mono-system)');
	// The browser's own chrome takes the chosen theme's ground too; System restores app.html's.
	const ground = getComputedStyle(root).getPropertyValue('--bg-100').trim();
	for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
		meta.dataset.system ??= meta.content;
		meta.content = preferences.mode === 'system' || !ground ? meta.dataset.system : ground;
	}
}

function setFont(root: HTMLElement, property: string, family: string, fallback: string): void {
	if (!family) {
		root.style.removeProperty(property);
		return;
	}
	root.style.setProperty(property, `"${family}", ${fallback}`);
}
