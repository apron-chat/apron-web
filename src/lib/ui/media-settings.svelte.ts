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
 * Either way, nothing loads from the origins the viewer blocked (`blocked`), or from under them, whatever trusts them.
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
 * The `http(s):` URL an entry names: a full URL (`https://cdn.example/a.png`), else a bare host (`cdn.example`, or
 * `cdn.example:443`, which `URL` alone reads as a scheme), as `https:`. One naming another scheme (`ftp://`) is
 * none. Else undefined.
 */
function entryUrl(entry: string): URL | undefined {
	for (const candidate of entry.includes('://') ? [entry] : [entry, `https://${entry}`]) {
		try {
			const url = new URL(candidate);
			if (url.protocol === 'https:' || url.protocol === 'http:') return url;
		} catch {
			// Not a URL as it stands: try it as a bare host.
		}
	}
	return undefined;
}

/** What `keep` makes of each URL named in `text`, separated by spaces, commas or lines: each once, in order. */
function parseEntries(text: string, keep: (url: URL) => string | undefined): string[] {
	const kept = text.split(/[\s,]+/).flatMap((entry) => {
		const url = entry ? entryUrl(entry) : undefined;
		const value = url && keep(url);
		return value ? [value] : [];
	});
	return [...new Set(kept)];
}

/**
 * The `https:` origins named in `text`, each once, in order: full URLs (`https://cdn.example/a.png`) or bare hosts
 * (`cdn.example`), separated by spaces, commas or lines. Anything else is dropped.
 */
export function parseMediaOrigins(text: string): string[] {
	return parseEntries(text, (url) => (url.protocol === 'https:' && url.hostname.includes('.') ? url.origin : undefined));
}

/**
 * A host to compare a blocked one with: lower case (as `URL` makes it), without a trailing dot, whatever the port or
 * scheme.
 */
export function blockableHost(url: URL): string {
	return url.hostname.replace(/\.$/, '');
}

/**
 * The sites named in `text` to block, each once, in order, as `https:` origins of their hosts: full URLs of any
 * `http(s):` scheme, or bare hosts, separated by spaces, commas or lines; the port and scheme dropped, since a block
 * holds for the host whatever they are. Wildcards and anything else are dropped.
 */
export function parseBlockedOrigins(text: string): string[] {
	return parseEntries(text, (url) => {
		const host = blockableHost(url);
		return host && !host.includes('*') ? `https://${host}` : undefined;
	});
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
	/** The policy chosen and saved, which `limit` doesn't change. */
	private chosen: MediaPolicy = DEFAULT_MEDIA_POLICY;

	load(): void {
		const saved = loadMediaSettings();
		const list = (key: string) => {
			const value = isJsonObject(saved) ? saved[key] : undefined;
			return (Array.isArray(value) ? value : []).filter((origin) => typeof origin === 'string').join(' ');
		};
		this.chosen = policyOf(isJsonObject(saved) ? saved.policy : undefined);
		this.policy = this.limited ? DEFAULT_MEDIA_POLICY : this.chosen;
		this.origins = parseMediaOrigins(list('origins'));
		this.blocked = parseBlockedOrigins(list('blocked'));
	}

	/** Another tab changed `key` in storage: what it chose holds here too. */
	storageChanged(key: string | null): void {
		if (key === MEDIA_KEY || key === null) this.load();
	}

	update(policy: string, origins: readonly string[] = this.origins, blocked: readonly string[] = this.blocked): void {
		if (!known(policy)) return;
		this.limited = false;
		this.policy = policy;
		this.chosen = policy;
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
		const [parsed] = parseBlockedOrigins(origin);
		if (parsed && !this.blocked.includes(parsed)) this.setBlocked([...this.blocked, parsed]);
	}

	/**
	 * Replaces the Blocked origins. Blocking only ever loads less, so unlike `update` it keeps a page held to the
	 * server's origins (`limit`) held, and saves the policy chosen, not the one held to.
	 */
	setBlocked(blocked: readonly string[]): void {
		this.blocked = [...blocked];
		saveMediaSettings({ policy: this.chosen, origins: this.origins, blocked: this.blocked });
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
