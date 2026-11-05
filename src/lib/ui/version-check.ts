import { dev, version } from '$app/environment';
import { asset } from '$app/paths';
import { updated } from '$app/state';
import { pageDrafts } from './pane-drafts.svelte';
import { loadVersionChecked, saveVersionChecked, type VersionChecked } from './storage';

/**
 * Before the app connects, it checks it is the latest deploy if that hasn't been checked for a while (`STALE_AFTER_MS`).
 * If a newer one is out, it reloads into that one before connecting, so an old copy never signs in to a server that
 * has moved on. That copy might be a tab or an installed app resumed after days, or the page the service worker kept
 * for offline. A reconnect while the page is in use (not just back from a long absence) only offers the reload: one
 * would cut short an upload, a recording or a half-typed sign-in code.
 *
 * A page loaded from the network is the latest deploy already (the service worker fetches pages network-first),
 * and the record of the latest deploy is shared by this device's tabs, so most connections check nothing. Open tabs
 * still find out about a deploy from SvelteKit's poll (`UpdateNotice`). The app's gate is at the foot of this file.
 */

/** How long a deploy known to be the latest is taken to still be: past this, connecting checks again first. */
export const STALE_AFTER_MS = 3 * 24 * 60 * 60 * 1000;
/** How long connecting waits on a check: past this it goes ahead, as if the check couldn't be made. */
export const CHECK_TIMEOUT_MS = 5000;
/** After a check that couldn't be made (offline, a failed request), connecting doesn't wait on another for this long. */
export const RETRY_AFTER_MS = 60 * 1000;

export interface VersionGateDeps {
	/** This copy's deploy. */
	version: string;
	now(): number;
	load(): VersionChecked | undefined;
	save(checked: VersionChecked): void;
	/** The latest deploy's version, or undefined if the check couldn't be made. */
	latest(): Promise<string | undefined>;
	/** Whether reloading loses nothing: an unsent draft lives only in memory. */
	mayReload(): boolean;
	/**
	 * Whether this tab already reloaded to get `version`, and still isn't on it; if not, notes that it is about to.
	 * True too if it can't note it, so a reload that brings back the same old page can't loop.
	 */
	reloadedFor(version: string): boolean;
	/** Reloads into the latest deploy. */
	reload(): void;
	/** A newer deploy is out but the page isn't reloading: it says so (`UpdateNotice`). */
	notice(): void;
}

/** Deploy versions are build timestamps (as the service worker sorts them): whether `a` was built after `b`. */
function newer(a: string, b: string): boolean {
	const [x, y] = [Number(a), Number(b)];
	return Number.isFinite(x) && Number.isFinite(y) && x > y;
}

/** What a reload never settles: the page goes before it would. */
const RELOADING = new Promise<never>(() => undefined);

export class VersionGate {
	private pending?: Promise<void>;
	private failedAt?: number;
	/** No call yet: the first, as the page loads, may take it as the latest deploy (`due`). */
	private loading = true;
	/**
	 * The newer deploy this copy found, while it says so (`notice`) rather than reloading: nothing more to check, and a
	 * later connection that may reload does, with no check.
	 */
	private stale?: string;

	constructor(private readonly deps: VersionGateDeps) {}

	/**
	 * Undefined when connecting may go ahead now. Otherwise a check is due, and connecting waits on the promise:
	 * it settles once it may go ahead, or never if the page is reloading into a newer deploy. Callers at the same time
	 * share one check. `reloadable`: a reload now would cut short nothing in use (the page's first connection, or
	 * one just after a long absence); otherwise a newer deploy is only offered.
	 */
	beforeConnect(reloadable = true): Promise<void> | undefined {
		if (this.pending) return this.pending;
		if (this.stale !== undefined) return reloadable && this.reload(this.stale) ? RELOADING : undefined;
		if (!this.due()) return undefined;
		const pending = this.check(reloadable).finally(() => {
			if (this.pending === pending) this.pending = undefined;
		});
		this.pending = pending;
		return pending;
	}

	private due(): boolean {
		const { version, now, load, save } = this.deps;
		const loading = this.loading;
		this.loading = false;
		const at = now();
		if (this.failedAt !== undefined && at - this.failedAt < RETRY_AFTER_MS) return false;
		const checked = load();
		// As the page loads, a deploy newer than the one noted (or none noted) is the latest: pages load from the
		// network. Only then: later, the one noted may be a rollback from this one, found by another tab since.
		if (!checked || (loading && newer(version, checked.version))) {
			save({ version, at });
			return false;
		}
		// A deploy other than this one was the latest (an older copy, or a rollback), it's been a while, or the record
		// is from ahead of this clock (one set back since), which can't say how long it's been.
		return checked.version !== version || at - checked.at >= STALE_AFTER_MS || at < checked.at;
	}

	private async check(reloadable: boolean): Promise<void> {
		const { deps } = this;
		const latest = await deps.latest();
		if (latest === undefined) {
			this.failedAt = deps.now();
			return;
		}
		this.failedAt = undefined;
		deps.save({ version: latest, at: deps.now() });
		if (latest === deps.version) return;
		this.stale = latest;
		if (reloadable && this.reload(latest)) return RELOADING;
		deps.notice();
	}

	/**
	 * Reloads into `latest`, unless that would lose an unsent draft, or this tab reloaded for it already (a cache still
	 * serving the old page): once per deploy per tab, so it can't loop. Returns whether it did.
	 */
	private reload(latest: string): boolean {
		if (!this.deps.mayReload() || this.deps.reloadedFor(latest)) return false;
		this.deps.reload();
		return true;
	}
}

// The app's gate, wired to this page.

/** In session storage, so for this tab only: the deploy it last reloaded to get (`reloadedFor`). */
const RELOADED_KEY = 'apron.versionReload';

/** The latest deploy's version from SvelteKit's `version.json`, which the service worker never caches. */
async function fetchLatest(): Promise<string | undefined> {
	try {
		const response = await fetch(asset('/_app/version.json'), { cache: 'no-store', signal: AbortSignal.timeout(CHECK_TIMEOUT_MS) });
		if (!response.ok) return undefined;
		const data: unknown = await response.json();
		const latest = (data as { version?: unknown } | null)?.version;
		return typeof latest === 'string' ? latest : undefined;
	} catch {
		return undefined;
	}
}

/** The app's gate, which `hooks.client.ts` and the page's client both wait on. None in `vite dev`, which has no deploys. */
const gate = dev ? undefined : new VersionGate({
	version,
	now: () => Date.now(),
	load: loadVersionChecked,
	save: saveVersionChecked,
	latest: fetchLatest,
	mayReload: () => !pageDrafts.current?.unsent,
	// Without session storage to remember the reload by, none is made (the notice offers it): it could loop.
	reloadedFor: (latest) => {
		try {
			const storage = globalThis.sessionStorage;
			if (!storage) return true;
			if (storage.getItem(RELOADED_KEY) === latest) return true;
			storage.setItem(RELOADED_KEY, latest);
			return storage.getItem(RELOADED_KEY) !== latest;
		} catch {
			return true;
		}
	},
	reload: () => location.reload(),
	notice: () => void updated.check()
});

/** `VersionGate.beforeConnect` for the app: undefined when connecting may go ahead now. */
export function beforeConnect(reloadable = true): Promise<void> | undefined {
	return gate?.beforeConnect(reloadable);
}
