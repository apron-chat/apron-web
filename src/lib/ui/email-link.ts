/**
 * An emailed sign-in link (PROTOCOL.md §4.10): the server puts the address and
 * the temporary token in the URL fragment, `#email=...&token=...`, so they stay
 * out of server logs.
 */
export interface EmailLink {
	email: string;
	token: string;
}

/**
 * Reads an emailed sign-in link from `location`'s fragment and scrubs it from
 * the address bar (and so from history and bookmarks) at once, keeping the
 * rest of the URL. Returns undefined, touching nothing, when the fragment is
 * not such a link.
 */
export function takeEmailLink(location: Pick<Location, 'hash' | 'pathname' | 'search'>, replace: (url: string) => void): EmailLink | undefined {
	const link = parseEmailLink(location.hash);
	if (!link) return undefined;
	replace(`${location.pathname}${location.search}`);
	return link;
}

/** `#email=ada%40example.com&token=418092` as its address and token; both are required. */
export function parseEmailLink(hash: string): EmailLink | undefined {
	if (!hash.startsWith('#') || hash.length < 2) return undefined;
	const params = new URLSearchParams(hash.slice(1));
	const email = params.get('email')?.trim();
	const token = params.get('token')?.trim();
	return email && token ? { email, token } : undefined;
}
