import { ANY_ORIGIN } from '$lib/protocol/embeds';
import { isJsonObject } from '$lib/protocol/types';
import { loadMediaSettings, MEDIA_KEY, saveMediaSettings } from './storage';

/**
 * Where images, avatars and other media load from. Loading one tells the site
 * that hosts it that someone is reading, and from where (PROTOCOL.md §5.5).
 * - `trusted`: the chat server's own origin, those it names for its media
 *   (`ext:media`, EXT.md §6), and the origins the viewer trusts (`origins`).
 *   Media in the timeline from anywhere else waits for a click; avatars and
 *   custom emoji from anywhere else don't show.
 * - `any`: any site.
 * Either way, nothing loads from the origins the viewer blocked (`blocked`), whatever trusts them.
 * Inline images (`data:`) always show.
 */
export const MEDIA_POLICIES = [
	{ value: 'trusted', label: 'Server and trusted sites' },
	{ value: 'any', label: 'Any site' }
] as const;

export type MediaPolicy = (typeof MEDIA_POLICIES)[number]['value'];

export const DEFAULT_MEDIA_POLICY: MediaPolicy = 'trusted';

/** What was saved, as a policy: those of earlier versions too (`all` is `any`; the rest, with their sites, `trusted`). */
function policyOf(value: unknown): MediaPolicy {
	return value === 'any' || value === 'all' ? 'any' : DEFAULT_MEDIA_POLICY;
}

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
	/** The origins the viewer trusts besides the server's, Preferences' Trusted origins. */
	origins = $state.raw<string[]>([]);
	/** The origins whose media never loads, whatever trusts them, Preferences' Blocked origins. */
	blocked = $state.raw<string[]>([]);
	/** Held to the server's origins on this page (`limit`), until something is chosen. */
	private limited = $state(false);

	load(): void {
		const saved = loadMediaSettings();
		const list = (key: string) => {
			const value = isJsonObject(saved) ? saved[key] : undefined;
			return parseMediaOrigins((Array.isArray(value) ? value : []).filter((origin) => typeof origin === 'string').join(' '));
		};
		this.policy = this.limited ? DEFAULT_MEDIA_POLICY : policyOf(isJsonObject(saved) ? saved.policy : undefined);
		this.origins = list('origins');
		this.blocked = list('blocked');
	}

	/** Another tab changed `key` in storage: what it chose holds here too. */
	storageChanged(key: string | null): void {
		if (key === MEDIA_KEY || key === null) this.load();
	}

	update(policy: string, origins: readonly string[] = this.origins, blocked: readonly string[] = this.blocked): void {
		if (!known(policy)) return;
		this.limited = false;
		this.policy = policy;
		this.origins = [...origins];
		this.blocked = [...blocked];
		saveMediaSettings({ policy, origins, blocked });
	}

	/** Trusts `origin` from now on, as Always load does: it joins the Trusted origins, whatever the policy. */
	trust(origin: string): void {
		const [parsed] = parseMediaOrigins(origin);
		if (parsed && !this.origins.includes(parsed)) this.update(this.policy, [...this.origins, parsed]);
	}

	/** Blocks `origin` from now on, as Block does: it joins the Blocked origins, which win over the trusted ones. */
	block(origin: string): void {
		const [parsed] = parseMediaOrigins(origin);
		if (parsed && !this.blocked.includes(parsed)) this.update(this.policy, this.origins, [...this.blocked, parsed]);
	}

	/**
	 * Only this page, and not saved: media loads from the server's origins alone, whatever was chosen, and the rest
	 * waits for a click. An export read here keeps to the sites it was agreed to load from until the viewer chooses
	 * otherwise.
	 */
	limit(): void {
		this.limited = true;
		this.policy = DEFAULT_MEDIA_POLICY;
	}

	/** The origins media loads from besides the server's own (`embedMedia`'s `trusted`), given those it names. */
	trusted(server: readonly string[]): readonly string[] {
		if (this.policy === 'any') return [...server, ANY_ORIGIN];
		if (this.limited) return server;
		return [...new Set([...server, ...this.origins])];
	}

	/** Whether media from anywhere else waits for a click, rather than loading. */
	get asks(): boolean {
		return this.policy !== 'any';
	}
}

export const mediaSettings = new MediaSettings();
