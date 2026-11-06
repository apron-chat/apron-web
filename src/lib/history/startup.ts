/**
 * The page's history keeper (`HistoryKeeper`), made as the app starts (`hooks.client.ts`) rather than once the
 * page has loaded and mounted: it begins reading what was kept for the server this browser last used at once
 * (`HistoryKeeper.prepare`), so the read goes on while the app loads, renders and begins its session, and is
 * done or under way when signing in waits for it (`FRESH_HOOK_MS`).
 */
import { hasKeptSession } from '$lib/protocol/client-internals';
import { defaultWebSocketUrl, normalizeWebSocketUrl } from '$lib/protocol/client-views';
import { loadServerUrl } from '$lib/ui/storage';
import { HistoryKeeper } from './history-keeper';
import { historySettings } from './settings.svelte';

let started: HistoryKeeper | undefined;

/**
 * Makes the keeper, at the retention chosen here, and has it begin reading what it will restore. The page may
 * yet sign in elsewhere (a link to another server): that server's restore then reads its own.
 */
export function startKeeping(): void {
	if (started) return;
	try {
		const keeper = newKeeper();
		const server = normalizeWebSocketUrl(loadServerUrl() ?? defaultWebSocketUrl(window.location), window.location);
		// Only for a session saved there, which is all a restore is for: a guest's or a first visit opens nothing.
		if (hasKeptSession(server)) void keeper.prepare(server);
		started = keeper;
	} catch {
		// Never in the way of the app starting: the page makes its keeper as it mounts (`takeKeeper`).
	}
}

/** The keeper `startKeeping` made, for the page to take once; one made now when it made none. */
export function takeKeeper(): HistoryKeeper {
	const keeper = started ?? newKeeper();
	started = undefined;
	return keeper;
}

function newKeeper(): HistoryKeeper {
	historySettings.load();
	return new HistoryKeeper({ retentionMs: historySettings.ms, onfailure: (message) => (historySettings.failure = message) });
}
