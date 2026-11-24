/**
 * Whether a passkey sign-in to a server worked on its own sign-in page on
 * this device: a passkey only the page can find, or a password manager that
 * can't use the server's passkeys here. Then the next sign-in goes straight
 * there instead of first asking the device for a passkey it won't find.
 *
 * Kept from the first time it worked there, for 30 days, not renewed by later
 * page sign-ins, so a device whose passkey has since moved (saved again for
 * the server's own address, say) tries here again in time. Taking it uses it
 * up (`forgetPasskeyPage` before the page opens), and only a page sign-in
 * that comes back here keeps it again: one that leaves this tab, or fails,
 * doesn't, so nobody is kept on a page that no longer works for them. Per
 * browser, in `localStorage`; nothing here is needed for signing in.
 */
const KEY = 'apron.passkeyOnPage';
const KEPT_MS = 30 * 24 * 60 * 60 * 1000;

function read(now: number): Record<string, number> {
	try {
		const value: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
		if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
		return Object.fromEntries(Object.entries(value).filter(([, at]) => typeof at === 'number' && now - at < KEPT_MS));
	} catch {
		return {};
	}
}

function write(kept: Record<string, number>): void {
	try {
		localStorage.setItem(KEY, JSON.stringify(kept));
	} catch {
		// Private browsing, or storage full: the next sign-in asks the device first, as it always did.
	}
}

/** Since when a passkey sign-in to `server` has worked on its page here, within 30 days of that; else undefined. */
export function passkeyPageSince(server: string, now = Date.now()): number | undefined {
	return read(now)[server];
}

/** Keeps that a passkey sign-in to `server` worked on its page, since `since` (the first time). */
export function rememberPasskeyPage(server: string, since: number, now = Date.now()): void {
	const kept = read(now);
	kept[server] = Math.min(kept[server] ?? since, since);
	write(kept);
}

/** Forgets it for `server`: the next sign-in asks the device first. */
export function forgetPasskeyPage(server: string, now = Date.now()): void {
	const kept = read(now);
	if (!(server in kept)) return;
	delete kept[server];
	write(kept);
}
