/**
 * An emailed sign-in link (PROTOCOL.md §4.11). The server puts the temporary
 * token and, when the link opens a client that isn't tied to one server, the
 * WebSocket URL of the server that sent it in the URL fragment,
 * `application/x-www-form-urlencoded`, so they stay out of server logs:
 *
 *     #token=Hk41x9…&server=wss%3A%2F%2Fchat.example%2F
 *
 * The link carries no address. Its token is unguessable and works on any
 * connection that is not signed in, so a link is a credential someone else
 * may have crafted or forwarded (login CSRF): it is never used silently, and
 * the page asks first, naming the server.
 */
export interface EmailLink {
	token: string;
	/** The server the token belongs to, a `ws:` or `wss:` URL; without it, the server this client is set to. */
	server?: string;
}

/**
 * Reads an emailed sign-in link from `location`'s fragment and scrubs the
 * fragment from the address bar (and so from history and bookmarks) at once,
 * keeping the rest of the URL. Any fragment carrying `token` (or `email`, as
 * earlier drafts' links did) is scrubbed, even one that isn't a usable link.
 * Returns undefined, touching nothing else, when the fragment is not such a
 * link.
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
 * `#token=…[&server=…]` as its parts. `token` is required; a `server` that
 * isn't a `ws:` or `wss:` URL makes the whole link unusable rather than
 * silently falling back to another server. Other keys are ignored.
 */
export function parseEmailLink(hash: string): EmailLink | undefined {
	const params = fragmentParams(hash);
	const token = params?.get('token')?.trim();
	if (!params || !token) return undefined;
	if (!params.has('server')) return { token };
	const server = webSocketUrl(params.get('server') ?? '');
	return server ? { token, server } : undefined;
}

/**
 * What the confirmation says before a link is used: which server, and what
 * it replaces. The link doesn't say which account it signs in to, so the
 * warning about links from others matters all the more. `keptSession`: a
 * registered session is kept for the current server, whether or not it has
 * resumed yet (`signedInAs` names it once it has).
 */
export function emailLinkPrompt(
	link: EmailLink, current: { url: string; label?: string; signedInAs?: string; keptSession?: boolean; targetKeptSession?: boolean }
): { title: string; lines: string[]; switchesServer: boolean } {
	const target = link.server ?? current.url;
	const switchesServer = target !== current.url;
	const host = hostOf(target);
	const lines: string[] = [];
	if (switchesServer) {
		lines.push(`This link is for ${host}, not ${current.label || hostOf(current.url)}, the server this page is using: continuing switches to it.`);
		if (current.targetKeptSession) lines.push(`You have a saved session on ${host}. Continuing signs you out of it.`);
	}
	else if (current.signedInAs) lines.push(`You’re signed in here as ${current.signedInAs}. Continuing signs you out of that account and in to the one the link is for.`);
	else if (current.keptSession) lines.push('You have a saved session here. Continuing signs you out of it.');
	lines.push('Only continue if you just asked for this email. A link someone sent you can sign you in to their account.');
	return { title: `Sign in to ${host} with this email link?`, lines, switchesServer };
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

/** What `runEmailLink` needs of the chat client. */
export interface EmailLinkClient {
	readonly url: string;
	signInWithEmailLink(token: string, url: string, beforeSwitch?: () => void): Promise<unknown>;
}

/**
 * Uses a link the viewer confirmed (§4.11): the client presents its token
 * on a fresh connection to the server it names (this one by default) that is
 * not signed in, and carries on with that connection once signed in.
 * `beforeSwitch` runs just before, so the page can let go of the view it held;
 * `onSignedIn` then remembers the server. A refused link, crafted or expired,
 * changes nothing: the page stays on its server, as it was.
 */
export async function runEmailLink(
	link: EmailLink, chat: EmailLinkClient,
	hooks: { beforeSwitch?: (switched: boolean) => void; onSignedIn: (server: string, switched: boolean) => void; onFailed: (error: string, server: string) => void }
): Promise<void> {
	const server = link.server ?? chat.url;
	const switched = server !== chat.url;
	try {
		await chat.signInWithEmailLink(link.token, server, () => hooks.beforeSwitch?.(switched));
	} catch (cause) {
		hooks.onFailed(cause instanceof Error && cause.message ? cause.message : 'unknown error', server);
		return;
	}
	hooks.onSignedIn(server, switched);
}

/** An email code the connect screen asked for (§4.11): the address, and the server that will send it. */
export interface SentCode {
	email: string;
	url: string;
}

/**
 * The pending code, while it can still be used: only on the server that sent
 * it, with the Server field still naming it. A code never follows the field to
 * another server.
 */
export function codeStillFor(sent: SentCode | undefined, fieldUrl: string): SentCode | undefined {
	return sent && sent.url === fieldUrl ? sent : undefined;
}
