/**
 * The page a server's sign-in page sends the viewer back to (`/signed-in/`,
 * `CALLBACK_PATH` in `sign-in-page.ts`), on its own: it imports nothing the
 * app's page does, so the app's page loads no code for it (a module both used
 * would be split into a chunk of its own, one more request as the app starts).
 * Its storage keys and channel are `sign-in-page.ts`'s (`PENDING_KEY`,
 * `RETURNED_KEY`, `CHANNEL`), copied; a test keeps them the same.
 */

export const PENDING_KEY = 'apron.authorizations';
export const RETURNED_KEY = 'apron.authorization-returned';
export const CHANNEL = 'apron.authorization';

/** An answer as the query has it (RFC 6749 §4.1.2, RFC 9207), for the tab that waits for it. */
type Answer = Partial<Record<'state' | 'code' | 'iss' | 'error' | 'errorDescription', string>>;

/**
 * Takes the answer in the query. A request that left this tab (kept with
 * `mode: "page"`) gets it back here: it is kept for the app, which this tab
 * goes back to (`takeReturned`), without the code in its address or
 * history. Otherwise this page is a popup: the answer goes to the tab that
 * opened it over a `BroadcastChannel` (which takes it only with its own
 * `state`), and the popup closes. Says which, or `none` for a query with no
 * answer in it.
 */
export function receiveCallback(location: Pick<Location, 'search' | 'replace'>, close: () => void = () => window.close()): 'page' | 'popup' | 'none' {
	const query = new URLSearchParams(location.search);
	const answer: Answer = {};
	for (const [key, name] of [['state', 'state'], ['iss', 'iss'], ['errorDescription', 'error_description']] as const) {
		const value = query.get(name);
		if (value) answer[key] = value;
	}
	const error = query.get('error');
	const code = query.get('code');
	if (error) answer.error = error;
	else if (code) answer.code = code;
	else return 'none';
	if (answer.state && leftThisTab(answer.state)) {
		try {
			sessionStorage.setItem(RETURNED_KEY, JSON.stringify(answer));
		} catch {
			// Without storage there is nothing to finish it with: the app opens as it would.
		}
		location.replace('/');
		return 'page';
	}
	if (typeof BroadcastChannel !== 'undefined') {
		const channel = new BroadcastChannel(CHANNEL);
		channel.postMessage(answer);
		channel.close();
	}
	close();
	return 'popup';
}

/** Whether this tab keeps a request with `state` that went to its page in this tab, rather than in a popup. */
function leftThisTab(state: string): boolean {
	try {
		const kept: unknown = JSON.parse(sessionStorage.getItem(PENDING_KEY) ?? '[]');
		return Array.isArray(kept) && kept.some((entry) => typeof entry === 'object' && entry !== null && entry.state === state && entry.mode === 'page');
	} catch {
		return false;
	}
}
