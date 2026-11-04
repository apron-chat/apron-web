import { dev, version } from '$app/environment';
import { asset } from '$app/paths';
import { updated } from '$app/state';
import { pageDrafts } from './pane-drafts.svelte';
import { loadVersionChecked, saveVersionChecked, type VersionChecked } from './storage';

/**
 * Before the app connects, it checks it is the latest deploy if that hasn't been checked for a while (`STALE_AFTER_MS`).
 * If a newer one is out, it reloads into that one before connecting, so an old copy never signs in to a server that
 * has moved on. That copy might be a tab or an installed app resumed after days, or the page the service worker kept
 * for offline.
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

export class VersionGate {
	private pending?: Promise<void>;
	private failedAt?: number;
	/** This copy was found out of date and says so (`notice`) rather than reloading: there's nothing more to check. */
	private noticed = false;

	constructor(private readonly deps: VersionGateDeps) {}

	/**
	 * Undefined when connecting may go ahead now. Otherwise a check is due, and connecting waits on the promise:
	 * it settles once it may go ahead, or never if the page is reloading into a newer deploy. Callers at the same time
	 * share one check.
	 */
	beforeConnect(): Promise<void> | undefined {
		if (this.pending) return this.pending;
		if (!this.due()) return undefined;
		const pending = this.check().finally(() => {
			if (this.pending === pending) this.pending = undefined;
		});
		this.pending = pending;
		return pending;
	}

	private due(): boolean {
		const { version, now, load, save } = this.deps;
		if (this.noticed) return false;
		const at = now();
		if (this.failedAt !== undefined && at - this.failedAt < RETRY_AFTER_MS) return false;
		const checked = load();
		// The first copy here of this deploy or a newer one: pages load from the network, so it is the latest.
		if (!checked || newer(version, checked.version)) {
			save({ version, at });
			return false;
		}
		// A deploy other than this one was the latest (an older copy, or a rollback), or it's been a while.
		return checked.version !== version || at - checked.at >= STALE_AFTER_MS;
	}

	private async check(): Promise<void> {
		const { deps } = this;
		const latest = await deps.latest();
		if (latest === undefined) {
			this.failedAt = deps.now();
			return;
		}
		this.failedAt = undefined;
		deps.save({ version: latest, at: deps.now() });
		if (latest === deps.version) return;
		// Once per deploy per tab: if the reload didn't bring it (a cache still serving the old page), don't loop.
		if (deps.mayReload() && !deps.reloadedFor(latest)) {
			deps.reload();
			return new Promise<never>(() => undefined);
		}
		this.noticed = true;
		deps.notice();
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
export function beforeConnect(): Promise<void> | undefined {
	return gate?.beforeConnect();
}
