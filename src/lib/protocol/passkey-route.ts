import { parseExternal, type External } from './external';
import { isJsonObject, type JsonObject } from './types';
import { isWebAuthnError } from './webauthn-error';

export { isWebAuthnError };

/**
 * Where a passkey ceremony runs (§4.10, and the passkey page,
 * §4.10.1), from its begin result:
 *
 * - `local`: in this page, with `public_key`. The RP ID check (§4.10) runs
 *   with the ceremony (`requestPasskey`); if it fails, or the browser
 *   refuses the RP ID, the ceremony goes to the page after all, when there
 *   is one (`usesPage`).
 * - `page`: on the server's passkey page (`external`), when the result has
 *   no `public_key` to run here: the server requires its page this time.
 * - `none`: neither, and the server's passkeys work only in its own apps and
 *   website.
 */
export type PasskeyRoute =
	| { kind: 'local'; challengeId: string; publicKey: JsonObject; external?: External }
	| { kind: 'page'; external: External }
	| { kind: 'none' };

export function passkeyRoute(begun: JsonObject): PasskeyRoute {
	const external = parseExternal(begun.external);
	const challengeId = typeof begun.challenge_id === 'string' && begun.challenge_id ? begun.challenge_id : undefined;
	if (challengeId && isJsonObject(begun.public_key)) return { kind: 'local', challengeId, publicKey: begun.public_key, ...(external ? { external } : {}) };
	return external ? { kind: 'page', external } : { kind: 'none' };
}

/** `public_key`'s RP ID isn't the server's (§4.10): the ceremony must not run in this page. */
export class ForeignRpIdError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ForeignRpIdError';
	}
}

/**
 * Whether a local ceremony that failed with `cause` goes to the passkey page
 * instead: its RP ID failed the check, or the browser refused it for this
 * page's origin (`SecurityError`, as on a domain that isn't the RP ID's and
 * isn't one of its related origins). A cancelled sheet, or any other
 * failure, doesn't: the user, not the domain, said no.
 */
export function usesPage(cause: unknown): boolean {
	return cause instanceof ForeignRpIdError || isWebAuthnError(cause, 'SecurityError');
}


/**
 * A passkey ceremony that has to finish on the server's passkey page: the
 * caller sends the user there (`external`) and finishes `action` with the
 * code that comes back (`finishPasskeyWithCode`). `account` is the signed-in
 * account a registration adds the passkey to, whose connection alone takes
 * that code.
 */
export class PasskeyPageNeeded extends Error {
	constructor(readonly action: 'register' | 'login', readonly external: External, readonly account?: string) {
		super('Continue with your passkey on the server’s page.');
		this.name = 'PasskeyPageNeeded';
	}
}

/**
 * A sign-in in this page that used no passkey (`NotAllowedError`: the sheet
 * was dismissed, or the device had none for the RP ID; the browser doesn't
 * say which), on a server that also offered its passkey page (§4.10.1). The
 * page may find a passkey this page's ceremony can't, such as one made for
 * the server's previous RP ID, so the caller offers it (`needed`) without
 * opening it: the user may only have said no. `cause` is the browser's error.
 */
export class PasskeyPageOffered extends Error {
	constructor(readonly needed: PasskeyPageNeeded, cause: unknown) {
		super('No passkey was used.', { cause });
		this.name = 'PasskeyPageOffered';
	}
}

/** What to say when a server's passkeys can't be used here and it offers no passkey page. */
export function passkeysOnlyFirstParty(name: string): string {
	return `${name}’s passkeys work only in its own apps and website.`;
}
