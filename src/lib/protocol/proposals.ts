/**
 * The email and external sign-in proposals this browser made (PROTOCOL.md
 * §4.11), remembered by their `state` so that a link coming back, in this
 * tab or another one (an email opens a new tab, an external page returns to
 * a fresh page load), is known for one of ours: which server it went to, and
 * whether it signs in or adds to an account.
 */

/** A proposed way in that finishes outside the connection. */
export type ProposalScheme = 'email' | 'external';

export interface Proposal {
	scheme: ProposalScheme;
	/** `sign-in` approves on a connection not signed in; `addition` only on one signed in to `account`. */
	kind: 'sign-in' | 'addition';
	/** The server it was proposed to, a `ws:`/`wss:` URL: the link's token is for it alone. */
	url: string;
	state: string;
	/** The address an email proposal sent to. */
	email?: string;
	/** For an addition: the `user_id` of the account that proposed it. */
	account?: string;
	/** Epoch milliseconds after which the record is forgotten. */
	expires: number;
}

/**
 * How long a proposal is remembered. A proposal expires within minutes
 * (§4.11.1), and its link's token within minutes of delivery; this leaves
 * room for slow mail and a long sign-in page, and a link that outlives its
 * proposal is only `denied`.
 */
export const PROPOSAL_KEPT_MS = 60 * 60_000;

/** The most proposals remembered at once; the oldest go first. */
const KEPT = 8;

const STORAGE_KEY = 'apron.proposals';

/**
 * A new `state` (§4.11.1): 32 random bytes, unpadded base64url, well under
 * the 256-byte limit and unguessable.
 */
export function newProposalState(): string {
	const bytes = new Uint8Array(32);
	globalThis.crypto.getRandomValues(bytes);
	return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Remembers `proposal` beside the others still current. */
export function rememberProposal(proposal: Proposal, now = Date.now()): void {
	const kept = readProposals(now).filter((entry) => entry.state !== proposal.state);
	writeProposals([...kept, proposal].slice(-KEPT));
}

/** The current proposal with this `state`, if this browser made it. */
export function findProposal(state: string | undefined, now = Date.now()): Proposal | undefined {
	if (!state) return undefined;
	return readProposals(now).find((entry) => entry.state === state);
}

/** Forgets the proposal with this `state`: approval used it up (§4.11.1). */
export function forgetProposal(state: string, now = Date.now()): void {
	const kept = readProposals(now);
	const left = kept.filter((entry) => entry.state !== state);
	if (left.length !== kept.length) writeProposals(left);
}

function readProposals(now: number): Proposal[] {
	let raw: string | null = null;
	try {
		raw = globalThis.localStorage?.getItem(STORAGE_KEY) ?? null;
	} catch {
		// Storage can be unavailable (private mode, blocked site data): nothing is known.
	}
	if (!raw) return [];
	try {
		const parsed: unknown = JSON.parse(raw);
		return Array.isArray(parsed) ? parsed.filter((entry): entry is Proposal => isProposal(entry) && entry.expires > now) : [];
	} catch {
		return [];
	}
}

function writeProposals(proposals: Proposal[]): void {
	try {
		const storage = globalThis.localStorage;
		if (!storage) return;
		if (proposals.length) storage.setItem(STORAGE_KEY, JSON.stringify(proposals));
		else storage.removeItem(STORAGE_KEY);
	} catch {
		// Best effort: a link for a proposal not remembered is asked about first.
	}
}

function isProposal(value: unknown): value is Proposal {
	if (typeof value !== 'object' || value === null) return false;
	const entry = value as Record<string, unknown>;
	return (entry.scheme === 'email' || entry.scheme === 'external')
		&& (entry.kind === 'sign-in' || entry.kind === 'addition')
		&& typeof entry.url === 'string' && typeof entry.state === 'string' && typeof entry.expires === 'number'
		&& (entry.kind !== 'addition' || typeof entry.account === 'string');
}

/**
 * The `url` of an external proposal's result (§4.11.5) if a client may open
 * it: an absolute `https` URL, or `http` on a loopback host. Anything else,
 * such as `javascript:…`, is rejected.
 */
export function signInPageUrl(value: unknown): string | undefined {
	if (typeof value !== 'string') return undefined;
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		return undefined;
	}
	if (url.protocol === 'https:' && url.hostname) return url.toString();
	if (url.protocol === 'http:' && loopback(url.hostname)) return url.toString();
	return undefined;
}

function loopback(hostname: string): boolean {
	const host = hostname.toLowerCase();
	return host === 'localhost' || host.endsWith('.localhost') || host === '[::1]' || /^127(\.\d{1,3}){3}$/.test(host);
}
