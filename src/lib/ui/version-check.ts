import { dev, version } from '$app/environment';
import { asset } from '$app/paths';
import { updated } from '$app/state';
import { loadVersionChecked, saveVersionChecked, type VersionChecked } from './storage';

/**
 * Before connecting, a copy not confirmed the latest deploy for `STALE_AFTER_MS` checks `version.json`, and reloads into
 * a newer one if that cuts nothing short (else the update notice offers it), so an old copy resumed after days doesn't
 * connect with old code. Pages load network-first, and the last check is shared by the device's tabs, so most
 * connections check nothing.
 */

/** How long a deploy found the latest is taken to still be. */
export const STALE_AFTER_MS = 3 * 24 * 60 * 60 * 1000;
/** How long connecting waits on a check before going ahead as if it couldn't be made. */
export const CHECK_TIMEOUT_MS = 5000;
/** After a check that couldn't be made (offline), connecting waits on none for this long. */
export const RETRY_AFTER_MS = 60 * 1000;

/** Whether a reload now would cut nothing short, asked when the check ends. */
export type Reloadable = () => boolean;

export interface VersionGateDeps {
	/** This copy's deploy. */
	version: string;
	now(): number;
	load(): VersionChecked | undefined;
	save(checked: VersionChecked): void;
	/** The latest deploy's version, or undefined if the check couldn't be made. */
	latest(): Promise<string | undefined>;
	/** Whether this tab reloaded for `version` already (else notes it's about to): true if it can't tell, so it can't loop. */
	reloadedFor(version: string): boolean;
	reload(): void;
	/** A newer deploy is out and the page isn't reloading: the update notice says so. */
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
	/** Each connection waiting on `pending`: it reloads only if none would be cut short. */
	private waiting: Reloadable[] = [];
	private failedAt?: number;
	/** No call yet: the first, as the page loads, may take it as the latest deploy (`due`). */
	private loading = true;
	/** The newer deploy found, while the notice offers it: nothing more to check. */
	private stale?: string;

	constructor(private readonly deps: VersionGateDeps) {}

	/**
	 * Undefined when connecting may go ahead now. Otherwise connecting waits on the promise: it settles once it may go
	 * ahead, or never if the page is reloading into a newer deploy. Callers at the same time share one check.
	 */
	beforeConnect(reloadable: Reloadable): Promise<void> | undefined {
		if (this.pending) {
			this.waiting.push(reloadable);
			return this.pending;
		}
		if (this.stale !== undefined) return reloadable() && this.reload(this.stale) ? RELOADING : undefined;
		if (!this.due()) return undefined;
		this.waiting = [reloadable];
		const pending = this.check().finally(() => {
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
		// A clock set back since doesn't stretch the wait.
		if (this.failedAt !== undefined && at >= this.failedAt && at - this.failedAt < RETRY_AFTER_MS) return false;
		const checked = load();
		// As the page loads, a deploy newer than the one noted is the latest: pages load from the network. Only then:
		// later, the one noted may be a rollback another tab found.
		if (!checked || (loading && newer(version, checked.version))) {
			save({ version, at });
			return false;
		}
		// Another deploy was the latest, it's been a while, or the record is from ahead of this clock (set back since).
		return checked.version !== version || at - checked.at >= STALE_AFTER_MS || at < checked.at;
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
		this.stale = latest;
		if (this.waiting.every((reloadable) => reloadable()) && this.reload(latest)) return RELOADING;
		deps.notice();
	}

	/** Reloads into `latest` once per deploy per tab, so a cache still serving the old page can't loop. */
	private reload(latest: string): boolean {
		if (this.deps.reloadedFor(latest)) return false;
		this.deps.reload();
		return true;
	}
}

// The app's gate.

/** In session storage, for this tab only: the deploy it last reloaded to get. */
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

/** Waited on by `hooks.client.ts` and the page's client. None in `vite dev`, which has no deploys. */
const gate = dev ? undefined : new VersionGate({
	version,
	now: () => Date.now(),
	load: loadVersionChecked,
	save: saveVersionChecked,
	latest: fetchLatest,
	reloadedFor: (latest) => {
		try {
			if (sessionStorage.getItem(RELOADED_KEY) === latest) return true;
			sessionStorage.setItem(RELOADED_KEY, latest);
			return false;
		} catch {
			return true;
		}
	},
	reload: () => location.reload(),
	notice: () => void updated.check()
});

/** `VersionGate.beforeConnect` for the app: undefined when connecting may go ahead now. */
export function beforeConnect(reloadable: Reloadable): Promise<void> | undefined {
	return gate?.beforeConnect(reloadable);
}
