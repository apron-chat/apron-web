import type { ClientSnapshot } from '$lib/protocol/client';
import type { Proposal, ProposalScheme } from '$lib/protocol/proposals';

/**
 * A sign-in link (PROTOCOL.md §4.11.2), emailed or the return from an
 * external sign-in page. The server puts the temporary token, the `state` of
 * the proposal it answers when that carried one, and, when the link opens a
 * client that isn't tied to one server, the WebSocket URL of the server that
 * sent it in the URL fragment, `application/x-www-form-urlencoded`, so they
 * stay out of server logs:
 *
 *     #token=Hk41x9…&state=q8Rz…&server=wss%3A%2F%2Fchat.example%2F
 *
 * With the `state` of a proposal this browser made, the link is that
 * proposal's, for the server it went to, and `server` is ignored. Any other
 * link is a credential someone else may have crafted or forwarded (login
 * CSRF): it is never used silently, and the page asks first, naming the
 * server.
 *
 * Opened through link.apron.chat, the link's keys come in the fragment as
 * they do for any link to this app (Appendix A.4), among the place's keys:
 *
 *     #server=wss://chat.example/ws&token=apron_invite_…
 */
export interface SignInLink {
	token: string;
	state?: string;
	/** The server the link names, a `ws:` or `wss:` URL; without it, the server this client is set to. */
	server?: string;
	/** The link named a `server` that isn't a WebSocket URL: unusable unless its `state` is this browser's own. */
	badServer?: true;
}

/**
 * Reads a sign-in link from `location`'s fragment and scrubs its `token` and
 * `state` from the address bar (and so from history and bookmarks) at once,
 * keeping the rest of the URL, the fragment's other keys included. Any
 * fragment carrying `token` is scrubbed, even one that isn't a usable link.
 * Returns undefined, touching nothing else, when the fragment is not such a link.
 */
export function takeSignInLink(location: Pick<Location, 'hash' | 'pathname' | 'search'>, replace: (url: string) => void): SignInLink | undefined {
	const hash = location.hash;
	const params = fragmentParams(hash);
	if (!params?.has('token')) return undefined;
	// Read before scrubbing: a real `Location` changes under us.
	const link = parseSignInLink(hash);
	params.delete('token');
	params.delete('state');
	const rest = params.toString();
	replace(`${location.pathname}${location.search}${rest ? `#${rest}` : ''}`);
	return link;
}

/** `#token=…[&state=…][&server=…]` as its parts. `token` is required; other keys are ignored. */
export function parseSignInLink(hash: string): SignInLink | undefined {
	const params = fragmentParams(hash);
	const token = params?.get('token')?.trim();
	if (!params || !token) return undefined;
	const state = params.get('state') || undefined;
	const link: SignInLink = { token, ...(state ? { state } : {}) };
	const named = params.get('server');
	if (named === null) return link;
	const server = webSocketUrl(named);
	return server ? { ...link, server } : { ...link, badServer: true };
}

/**
 * What a link is for (§4.11.2): `own`, a sign-in this browser proposed,
 * used at once on the server it went to; `addition`, an addition this
 * browser proposed, for the account that proposed it; `ask`, any other link,
 * used only once the viewer has confirmed. Undefined for a link that can't
 * be used: one of no proposal here that names a server that isn't one,
 * which is never silently swapped for another.
 */
export type LinkUse =
	| { kind: 'own'; token: string; server: string; scheme: ProposalScheme; state: string }
	| { kind: 'addition'; token: string; server: string; account: string; state: string }
	| { kind: 'ask'; link: SignInLink };

export function linkUse(link: SignInLink, find: (state: string | undefined) => Proposal | undefined): LinkUse | undefined {
	const proposal = find(link.state);
	if (proposal?.kind === 'addition' && proposal.account) {
		return { kind: 'addition', token: link.token, server: proposal.url, account: proposal.account, state: proposal.state };
	}
	if (proposal) return { kind: 'own', token: link.token, server: proposal.url, scheme: proposal.scheme, state: proposal.state };
	return link.badServer ? undefined : { kind: 'ask', link };
}

/**
 * What the confirmation says before a link of no proposal here is used:
 * which server, and what it replaces. The link doesn't say which account it
 * signs in to, so the warning about links from others matters all the more.
 * `keptSession`: a registered session is kept for the current server,
 * whether or not it has resumed yet (`signedInAs` names it once it has).
 *
 * Nor does the link say whether it signs in or adds a sign-in to an account
 * (§4.11.1): one proposed on another device, or forgotten here, could be
 * either. `addAs` names the account this page is signed in to on the
 * current server, guests included; on that server the prompt then offers to
 * add the link to it as well (`adds`). That is safe to offer: an addition
 * approves only on a connection signed in to the account that proposed it,
 * and a sign-in's token is refused on one (§4.11.3).
 */
export function signInLinkPrompt(
	link: SignInLink, current: { url: string; label?: string; signedInAs?: string; addAs?: string; keptSession?: boolean; targetKeptSession?: boolean }
): { title: string; lines: string[]; switchesServer: boolean; adds: boolean } {
	const target = link.server ?? current.url;
	const switchesServer = target !== current.url;
	const host = hostOf(target);
	const lines: string[] = [];
	const addAs = switchesServer ? undefined : current.addAs;
	if (addAs) {
		lines.push(`If you asked to add this way of signing in to ${addAs}, on this device or another, add it.`);
		lines.push(`If you asked to sign in with it, signing in signs you out of ${addAs} and in to the account the link is for.`);
		lines.push('Only sign in if you just asked to, on this device or another. A link someone sent you can sign you in to their account.');
		return { title: `Use this link on ${host}?`, lines, switchesServer, adds: true };
	}
	if (switchesServer) {
		lines.push(`This link is for ${host}, not ${current.label || hostOf(current.url)}, the server this page is using: continuing switches to it.`);
		if (current.targetKeptSession) lines.push(`You have a saved session on ${host}. Continuing signs you out of it.`);
	}
	else if (current.signedInAs) lines.push(`You’re signed in here as ${current.signedInAs}. Continuing signs you out of that account and in to the one the link is for.`);
	else if (current.keptSession) lines.push('You have a saved session here. Continuing signs you out of it.');
	lines.push('Only continue if you just asked to sign in, on this device or another. A link someone sent you can sign you in to their account.');
	return { title: `Sign in to ${host} with this link?`, lines, switchesServer, adds: false };
}

/**
 * Why a link of no proposal here didn't sign in, and what to do: it may
 * have been sent to add a sign-in to an account instead, which works only
 * where that account is signed in (§4.11.3), so a new sign-in code wouldn't
 * help.
 */
export function askedLinkFailure(error: string): string {
	return `The link didn’t sign you in (${error}). If it was sent to add a way of signing in to an account, open it where you’re signed in to that account. Otherwise sign in again, or pick another server.`;
}

/**
 * Whether the page's session has settled enough to tell if a link for an
 * addition proposed here can be used: it is signed in, or it won't be
 * without the user (held, such as a resume that was refused), or it has
 * failed with nothing left to resume. A kept session that the server
 * resumes by token is still on its way while its resume is retried (a
 * limit, a timeout), even with an error showing meanwhile.
 */
export function sessionSettled(snapshot: Pick<ClientSnapshot, 'status' | 'authBusy' | 'authenticated' | 'held' | 'error' | 'keptSession' | 'server'>): boolean {
	if (snapshot.status !== 'connected' || snapshot.authBusy) return false;
	if (snapshot.authenticated || snapshot.held) return true;
	const resuming = Boolean(snapshot.keptSession && snapshot.server?.auth.includes('token'));
	return Boolean(snapshot.error) && !resuming;
}

/**
 * Where an external sign-in page sends the user back (`return_url`,
 * §4.11.5): this app, at its own path, without the query or fragment. A
 * server accepts it only on an origin it trusts, and the link's fragment
 * replaces any fragment it had.
 */
export function returnUrl(location: Pick<Location, 'origin' | 'pathname'>): string {
	return `${location.origin}${location.pathname}`;
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

/** What `runSignInLink` needs of the chat client. */
export interface SignInLinkClient {
	readonly url: string;
	signInWithLink(token: string, url: string, options: { scheme?: ProposalScheme; state?: string; beforeSwitch?: () => void }): Promise<unknown>;
}

/**
 * Uses a sign-in link (§4.11.3): this browser's own (`own`), or one the
 * viewer confirmed (`ask`). The client presents its token on a fresh
 * connection that is not signed in to the proposal's server, or else to the
 * server the link names (this one by default), and carries on with that
 * connection once signed in. `beforeSwitch` runs just before, so the page can
 * let go of the view it held; `onSignedIn` then remembers the server. A
 * refused link, crafted or expired, changes nothing: the page stays on its
 * server, as it was.
 */
export async function runSignInLink(
	use: Exclude<LinkUse, { kind: 'addition' }>, chat: SignInLinkClient,
	hooks: { beforeSwitch?: (switched: boolean) => void; onSignedIn: (server: string, switched: boolean) => void; onFailed: (error: string, server: string) => void }
): Promise<void> {
	const server = use.kind === 'own' ? use.server : use.link.server ?? chat.url;
	const token = use.kind === 'own' ? use.token : use.link.token;
	const switched = server !== chat.url;
	try {
		await chat.signInWithLink(token, server, {
			...(use.kind === 'own' ? { scheme: use.scheme, state: use.state } : {}),
			beforeSwitch: () => hooks.beforeSwitch?.(switched)
		});
	} catch (cause) {
		hooks.onFailed(cause instanceof Error && cause.message ? cause.message : 'unknown error', server);
		return;
	}
	hooks.onSignedIn(server, switched);
}

/** A code the connect screen asked for (§4.11): the scheme, the address or page, and the server that will take it. */
export interface SentCode {
	scheme: ProposalScheme;
	url: string;
	email?: string;
	page?: string;
}

/**
 * The pending code, while it can still be used: only on the server that sent
 * it, with the Server field still naming it. A code never follows the field to
 * another server.
 */
export function codeStillFor(sent: SentCode | undefined, fieldUrl: string): SentCode | undefined {
	return sent && sent.url === fieldUrl ? sent : undefined;
}
