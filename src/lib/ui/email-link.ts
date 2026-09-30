/**
 * An emailed sign-in link (PROTOCOL.md §4.10). The server puts the address,
 * the temporary token and, optionally, the WebSocket URL of the server that
 * sent it in the URL fragment, `application/x-www-form-urlencoded`, so they
 * stay out of server logs:
 *
 *     #email=ada%40example.com&token=418092&server=wss%3A%2F%2Fchat.example%2F
 *
 * A link is a credential someone else may have crafted or forwarded (login
 * CSRF), so it is never used silently: the page asks first, naming the server
 * and the address.
 */
export interface EmailLink {
	email: string;
	token: string;
	/** The server the code belongs to, a `ws:` or `wss:` URL; without it, the server this client is set to. */
	server?: string;
}

/**
 * Reads an emailed sign-in link from `location`'s fragment and scrubs the
 * fragment from the address bar (and so from history and bookmarks) at once,
 * keeping the rest of the URL. Any fragment carrying `email` or `token` is
 * scrubbed, even one that isn't a usable link. Returns undefined, touching
 * nothing else, when the fragment is not such a link.
 */
export function takeEmailLink(location: Pick<Location, 'hash' | 'pathname' | 'search'>, replace: (url: string) => void): EmailLink | undefined {
	const hash = location.hash;
	const params = fragmentParams(hash);
	if (!params || (!params.has('email') && !params.has('token'))) return undefined;
	// Read before scrubbing: a real `Location` changes under us.
	const link = parseEmailLink(hash);
	replace(`${location.pathname}${location.search}`);
	return link;
}

/**
 * `#email=…&token=…[&server=…]` as its parts. `email` and `token` are
 * required; a `server` that isn't a `ws:` or `wss:` URL makes the whole link
 * unusable rather than silently falling back to another server.
 */
export function parseEmailLink(hash: string): EmailLink | undefined {
	const params = fragmentParams(hash);
	const email = params?.get('email')?.trim();
	const token = params?.get('token')?.trim();
	if (!params || !email || !token) return undefined;
	if (!params.has('server')) return { email, token };
	const server = webSocketUrl(params.get('server') ?? '');
	return server ? { email, token, server } : undefined;
}

/** What the confirmation says before a link is used: which server, which address, and what it replaces. */
export function emailLinkPrompt(
	link: EmailLink, current: { url: string; label?: string; signedInAs?: string }
): { title: string; lines: string[]; switchesServer: boolean } {
	const target = link.server ?? current.url;
	const switchesServer = target !== current.url;
	const host = hostOf(target);
	const lines: string[] = [];
	if (switchesServer) lines.push(`This link is for ${host}, not ${current.label || hostOf(current.url)}, the server this page is using: continuing switches to it.`);
	else if (current.signedInAs) lines.push(`You’re signed in here as ${current.signedInAs}. Continuing signs you out of that account.`);
	lines.push('Only continue if you asked for this email. A link someone sent you can sign you in to their account.');
	return { title: `Sign in to ${host} as ${link.email}?`, lines, switchesServer };
}

function fragmentParams(hash: string): URLSearchParams | undefined {
	return hash.startsWith('#') && hash.length > 1 ? new URLSearchParams(hash.slice(1)) : undefined;
}

function webSocketUrl(value: string): string | undefined {
	try {
		const url = new URL(value.trim());
		return url.protocol === 'ws:' || url.protocol === 'wss:' ? url.toString() : undefined;
	} catch {
		return undefined;
	}
}

function hostOf(url: string): string {
	try {
		return new URL(url).host || url;
	} catch {
		return url;
	}
}
