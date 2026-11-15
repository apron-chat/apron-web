/**
 * What a begin result says about a server's sign-in page (PROTOCOL.md
 * §4.12.1), and the parameters that redeem its code: the part of the
 * authorization flow the client reads as it signs in, which loads with the
 * app. Building a request and reading its answer (`authorization.ts`) load
 * only when a page is opened.
 */

/** A begin result's `external` (§4.12.1): the page to send the user to. */
export interface External {
	url: string;
	/** For clients that redeem at the issuer's token endpoint; this client redeems on the connection and ignores it. */
	issuer?: string;
}

/** The parameters that redeem a code on the connection (§4.12.2), for `external` or a `webauthn` finish step. */
export interface CodeRedemption {
	code: string;
	code_verifier: string;
	redirect_uri: string;
	client_id: string;
}

/**
 * A begin result's `external`, if a client may open its `url`: an absolute
 * `https` URL, or `http` on a loopback host, for local development. Anything
 * else, such as `javascript:…`, is refused.
 */
export function parseExternal(value: unknown): External | undefined {
	// Not `isJsonObject`: this module imports nothing, so the code that opens a page (on demand) shares no other with the app.
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
	const entry = value as Record<string, unknown>;
	const url = pageUrl(entry.url);
	if (!url) return undefined;
	return { url, ...(typeof entry.issuer === 'string' ? { issuer: entry.issuer } : {}) };
}

/** `value` as a page a client may open (see `parseExternal`). */
export function pageUrl(value: unknown): string | undefined {
	if (typeof value !== 'string') return undefined;
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		return undefined;
	}
	if (url.protocol === 'https:' && url.hostname) return url.toString();
	if (url.protocol === 'http:' && isLoopback(url.hostname)) return url.toString();
	return undefined;
}

/** Whether `hostname` (as `URL` gives it) is a loopback host: `localhost` and its subdomains, 127.0.0.0/8, `[::1]`. */
export function isLoopback(hostname: string): boolean {
	const host = hostname.toLowerCase();
	return host === 'localhost' || host.endsWith('.localhost') || host === '[::1]' || /^127(\.\d{1,3}){3}$/.test(host);
}
