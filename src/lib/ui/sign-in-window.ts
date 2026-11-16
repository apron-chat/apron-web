/**
 * The part of signing in on a server's page (`sign-in-page.ts`) that loads
 * with the app: opening the window during the tap that asks for it (a
 * browser allows one only then, before the rest has loaded), telling whether
 * a page sent this tab back as the app starts, and the words for a failure.
 * The rest loads on demand.
 */

/**
 * Where requests are kept, the answer a page brought back to this tab, and the
 * channel a popup's answer comes back on: the callback page
 * (`sign-in-callback.ts`, which keeps its own copies so it loads none of this)
 * uses the same.
 */
export const PENDING_KEY = 'apron.authorizations';
export const RETURNED_KEY = 'apron.authorization-returned';
export const CHANNEL = 'apron.authorization';

/**
 * Opens the window a sign-in page loads in, now, while the tap that asked
 * for it still lets a page open one; blank until the page's address is
 * known. Null where the browser blocks it (or has no `BroadcastChannel` to
 * bring its answer back): the page then opens in this tab instead. The
 * window can't reach this one (`opener` is cleared), so a page loaded in it
 * can't navigate this app.
 */
export function openSignInWindow(): Window | null {
	if (typeof BroadcastChannel === 'undefined') return null;
	let popup: Window | null = null;
	try {
		popup = window.open('', 'apron-sign-in', 'popup,width=480,height=720');
	} catch {
		return null;
	}
	if (!popup || popup.closed) return null;
	try {
		popup.opener = null;
		popup.document.title = 'Signing in…';
		popup.document.body.textContent = 'Opening the sign-in page…';
	} catch {
		// A window this page can't write to (a named one already elsewhere): it is navigated all the same.
	}
	return popup;
}

/** Whether a sign-in page sent this tab back with an answer for the app (`takeReturned` takes it). */
export function returnedWaiting(): boolean {
	try {
		return globalThis.sessionStorage?.getItem(RETURNED_KEY) != null;
	} catch {
		return false;
	}
}

/** What a failed sign-in on a page says: an `AuthorizationError`'s words, a cancel as Cancelled, else `fallback`. */
export function signInPageError(cause: unknown, fallback = 'Unable to sign in'): string {
	if (cause instanceof DOMException && cause.name === 'AbortError') return 'Cancelled.';
	return cause instanceof Error && cause.message ? cause.message : fallback;
}
