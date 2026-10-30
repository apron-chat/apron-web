import { ANY_ORIGIN } from '$lib/protocol/embeds';
import { isJsonObject } from '$lib/protocol/types';
import { loadMediaSettings, MEDIA_KEY, saveMediaSettings } from './storage';

/**
 * Where images, avatars and other media load from. Loading one tells the site
 * that hosts it that someone is reading, and from where (PROTOCOL.md §5.5).
 * - `server`: the chat server's own origin, and those it names for its media
 *   (`ext:media`, EXT.md §6).
 * - `custom`: those, and the sites the viewer adds (`origins`).
 * - `all`: any `https:` site.
 * Small inline images (`data:`) always show.
 */
export const MEDIA_POLICIES = [
	{ value: 'server', label: 'This server' },
	{ value: 'custom', label: 'This server and sites I add' },
	{ value: 'all', label: 'Any site' }
] as const;

export type MediaPolicy = (typeof MEDIA_POLICIES)[number]['value'];

export const DEFAULT_MEDIA_POLICY: MediaPolicy = 'server';

function known(value: unknown): value is MediaPolicy {
	return MEDIA_POLICIES.some((policy) => policy.value === value);
}

/**
 * The `https:` origins named in `text`, each once, in order: full URLs (`https://cdn.example/a.png`) or bare hosts
 * (`cdn.example`), separated by spaces, commas or lines. Anything else is dropped.
 */
export function parseMediaOrigins(text: string): string[] {
	const origins = text.split(/[\s,]+/).flatMap((entry) => {
		if (!entry) return [];
		try {
			const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(entry) ? entry : `https://${entry}`);
			return url.protocol === 'https:' && url.hostname.includes('.') ? [url.origin] : [];
		} catch {
			return [];
		}
	});
	return [...new Set(origins)];
}

/** Where media loads from, shared by the page and Preferences. */
export class MediaSettings {
	policy = $state<MediaPolicy>(DEFAULT_MEDIA_POLICY);
	/** The sites added, as origins: what `custom` trusts besides the server's. */
	origins = $state.raw<string[]>([]);
	/** Held to the server's origins on this page (`limit`), until something is chosen. */
	private limited = false;

	load(): void {
		const saved = loadMediaSettings();
		const policy = isJsonObject(saved) ? saved.policy : undefined;
		const origins = isJsonObject(saved) && Array.isArray(saved.origins) ? saved.origins : [];
		this.policy = this.limited ? 'server' : known(policy) ? policy : DEFAULT_MEDIA_POLICY;
		this.origins = parseMediaOrigins(origins.filter((origin) => typeof origin === 'string').join(' '));
	}

	/** Another tab changed `key` in storage: what it chose holds here too. */
	storageChanged(key: string | null): void {
		if (key === MEDIA_KEY || key === null) this.load();
	}

	update(policy: string, origins: readonly string[] = this.origins): void {
		if (!known(policy)) return;
		this.limited = false;
		this.policy = policy;
		this.origins = [...origins];
		saveMediaSettings({ policy, origins });
	}

	/**
	 * Only this page, and not saved: media loads from the server's origins alone, whatever was chosen. An export
	 * opened without its images keeps to that until the viewer chooses otherwise.
	 */
	limit(): void {
		this.limited = true;
		this.policy = 'server';
	}

	/** The origins media loads from besides the server's own (`embedMedia`'s `trusted`), given those it names. */
	trusted(server: readonly string[]): readonly string[] {
		if (this.policy === 'all') return [...server, ANY_ORIGIN];
		if (this.policy === 'custom') return [...new Set([...server, ...this.origins])];
		return server;
	}
}

export const mediaSettings = new MediaSettings();
