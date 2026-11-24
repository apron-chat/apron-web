/**
 * Which way a passkey sign-in to a server last worked on this device: on
 * the server's own sign-in page, or here. Where it was the page (a passkey
 * only the page can find, or a password manager that can't use the
 * server's passkeys here), the next sign-in goes straight there instead of
 * asking the device first for a passkey it won't find. Remembered for 30
 * days, so a device whose passkey has since moved (saved again for the
 * server's own address, say) tries here again in time. Per browser, in
 * `localStorage`; nothing here is needed for signing in.
 */
const KEY = 'apron.passkeyOnPage';
const KEPT_MS = 30 * 24 * 60 * 60 * 1000;

function read(): Record<string, number> {
	try {
		const value: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
		return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, number>) : {};
	} catch {
		return {};
	}
}

/** Whether the last passkey sign-in to `server` here worked on its sign-in page, within 30 days. */
export function prefersPasskeyPage(server: string, now = Date.now()): boolean {
	const at = read()[server];
	return typeof at === 'number' && now - at < KEPT_MS;
}

/** Notes how a passkey sign-in to `server` just worked: on its page (`true`), or here. */
export function notePasskeyRoute(server: string, onPage: boolean, now = Date.now()): void {
	const kept = Object.fromEntries(Object.entries(read()).filter(([, at]) => typeof at === 'number' && now - at < KEPT_MS));
	if (onPage) kept[server] = now;
	else delete kept[server];
	try {
		localStorage.setItem(KEY, JSON.stringify(kept));
	} catch {
		// Private browsing, or storage full: the next sign-in asks the device first, as it always did.
	}
}
