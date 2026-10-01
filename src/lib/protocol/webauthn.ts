import { noteCredentialSource, type CredentialSource } from './passkey-diagnostics';
import { isJsonObject, type JsonObject } from './types';

export function passkeySupportError(): string | undefined {
	if (!globalThis.isSecureContext) return 'Passkeys require HTTPS or a localhost connection.';
	if (typeof PublicKeyCredential === 'undefined' ||
		!PublicKeyCredential.parseCreationOptionsFromJSON ||
		!PublicKeyCredential.parseRequestOptionsFromJSON) {
		return 'This browser does not support passkeys. Try an up-to-date browser.';
	}
	return undefined;
}

/** Return the browser option object from the canonical server envelope. */
export function passkeyPublicKeyOptions(options: JsonObject): JsonObject | undefined {
	if (isJsonObject(options.public_key)) return options.public_key;
	return undefined;
}

/**
 * Creation options with the passkey labelled `name`: password managers show
 * `user.name` and `user.displayName`, which a server fills from the session
 * the ceremony starts on (a guest's). Neither is signed or sent back, so
 * relabelling never affects verification; `user.id` is the account's handle
 * and stays as the server sent it.
 */
export function labelledCreationOptions(publicKey: JsonObject, name: string | undefined): JsonObject {
	const label = name?.trim();
	if (!label || !isJsonObject(publicKey.user)) return publicKey;
	return { ...publicKey, user: { ...publicKey.user, name: label, displayName: label } };
}

/**
 * Runs one explicit ceremony: the browser's modal sheet, started from the
 * user's tap. The wire uses WebAuthn JSON encodings (base64url for binary
 * fields). `name` labels a new passkey (see `labelledCreationOptions`).
 */
export async function requestPasskey(
	action: 'register' | 'login', options: JsonObject, signal: AbortSignal, name?: string
): Promise<JsonObject> {
	const unsupported = passkeySupportError();
	if (unsupported) throw new Error(unsupported);
	const publicKey = passkeyPublicKeyOptions(options);
	if (!publicKey) throw new Error('Invalid passkey options from server');
	const credential = action === 'register'
		? await navigator.credentials.create({
			publicKey: PublicKeyCredential.parseCreationOptionsFromJSON(labelledCreationOptions(publicKey, name) as unknown as PublicKeyCredentialCreationOptionsJSON), signal
		})
		: await navigator.credentials.get({
			publicKey: PublicKeyCredential.parseRequestOptionsFromJSON(publicKey as unknown as PublicKeyCredentialRequestOptionsJSON), signal
		});
	// Only a public key was asked for; an extension's proxy may not pass `instanceof`, or let `type` be read.
	if (!credential) throw new Error('No passkey was selected');
	return credentialJSON(credential as PublicKeyCredential);
}

type ResponseGetters = {
	getAuthenticatorData?: () => ArrayBuffer;
	getPublicKey?: () => ArrayBuffer | null;
	getPublicKeyAlgorithm?: () => number;
	getTransports?: () => string[];
};

/**
 * The credential in WebAuthn JSON. Password-manager extensions (1Password in
 * Firefox, notably) hand back a proxy of the credential that may lack
 * `toJSON`, throw from it, or hide fields that are still reachable through
 * the response's getters, and some deny access to the proxy after a while:
 * every field is read at once, `toJSON` is preferred, and the fields read
 * are the fallback. An extension's own `toJSON` may also encode them
 * differently (padded or plain base64, another field's bytes): where it
 * disagrees with the fields themselves, they are what is sent. Which way it
 * went is noted for the console (`credentialSource`).
 */
export function credentialJSON(credential: PublicKeyCredential): JsonObject {
	const fields = readCredential(credential);
	const use = (json: JsonObject, source: CredentialSource): JsonObject => {
		noteCredentialSource(json, source);
		return json;
	};
	let json: unknown;
	try {
		if (typeof credential.toJSON !== 'function') return use(fields, { source: 'fields', note: 'the credential has no toJSON' });
		json = credential.toJSON() as unknown;
	} catch (failure) {
		return use(fields, { source: 'fields', note: `toJSON threw: ${failure instanceof Error ? `${failure.name}: ${failure.message}` : String(failure)}` });
	}
	if (!isJsonObject(json) || !isJsonObject(json.response)) return use(fields, { source: 'fields', note: 'toJSON gave no response object' });
	const differing = disagreements(json, fields);
	if (differing.length) return use(fields, { source: 'fields', note: `toJSON disagrees with the credential's own fields: ${differing.join(', ')}` });
	return use(json, { source: 'toJSON' });
}

/** Binary fields the credential's own reading has (canonical base64url) that `toJSON` leaves out or encodes otherwise. */
function disagreements(json: JsonObject, fields: JsonObject): string[] {
	const ours = fields.response as JsonObject;
	const theirs = json.response as JsonObject;
	const differing = ['clientDataJSON', 'attestationObject', 'authenticatorData', 'signature', 'userHandle']
		.filter((key) => typeof ours[key] === 'string' && theirs[key] !== ours[key])
		.map((key) => `response.${key}`);
	if (typeof fields.rawId === 'string' && fields.rawId !== '' && json.rawId !== fields.rawId) differing.unshift('rawId');
	return differing;
}

function readCredential(credential: PublicKeyCredential): JsonObject {
	const response = credential.response as AuthenticatorResponse & Partial<AuthenticatorAttestationResponse & AuthenticatorAssertionResponse> & ResponseGetters;
	const read = <T>(property: () => T | undefined, getter?: () => T | undefined | null): T | undefined => {
		try {
			const value = property();
			if (value !== undefined && value !== null) return value;
		} catch {
			// Fall through to the getter.
		}
		try {
			return getter?.() ?? undefined;
		} catch {
			return undefined;
		}
	};
	const encoded: JsonObject = {};
	const put = (key: string, value: unknown): void => {
		if (isBinary(value)) encoded[key] = base64url(value);
	};
	put('clientDataJSON', read(() => response.clientDataJSON));
	put('attestationObject', read(() => response.attestationObject));
	put('authenticatorData', read(() => response.authenticatorData, () => response.getAuthenticatorData?.()));
	put('signature', read(() => response.signature));
	put('userHandle', read(() => response.userHandle ?? undefined));
	put('publicKey', read(() => undefined, () => response.getPublicKey?.()));
	const algorithm = read(() => undefined, () => response.getPublicKeyAlgorithm?.());
	if (typeof algorithm === 'number') encoded.publicKeyAlgorithm = algorithm;
	const transports = read(() => undefined, () => response.getTransports?.());
	if (Array.isArray(transports)) encoded.transports = [...transports];
	const rawId = read(() => credential.rawId);
	const id = read(() => credential.id) ?? (isBinary(rawId) ? base64url(rawId) : '');
	const attachment = read(() => credential.authenticatorAttachment ?? undefined);
	const extensions = read(() => credential.getClientExtensionResults());
	return {
		id,
		rawId: isBinary(rawId) ? base64url(rawId) : id,
		type: 'public-key',
		response: encoded,
		clientExtensionResults: isJsonObject(extensions) ? jsonExtensions(extensions) : {},
		...(attachment ? { authenticatorAttachment: attachment } : {})
	};
}

/** Extension results may hold binary values (`prf`, `largeBlob`); JSON carries them as base64url. */
function jsonExtensions(value: unknown): JsonObject {
	const convert = (entry: unknown): unknown => {
		if (isBinary(entry)) return base64url(entry);
		if (Array.isArray(entry)) return entry.map(convert);
		if (entry && typeof entry === 'object') return Object.fromEntries(Object.entries(entry).map(([key, inner]) => [key, convert(inner)]));
		return entry;
	};
	return convert(value) as JsonObject;
}

/**
 * Binary data, whichever realm made it: an extension's or another
 * compartment's `ArrayBuffer` fails `instanceof ArrayBuffer` here.
 */
function isBinary(value: unknown): value is ArrayBuffer | ArrayBufferView {
	return ArrayBuffer.isView(value) || Object.prototype.toString.call(value) === '[object ArrayBuffer]';
}

export function base64url(value: ArrayBuffer | ArrayBufferView): string {
	const bytes = ArrayBuffer.isView(value) ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength) : new Uint8Array(value);
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Tells this device's passkey providers the current label for the passkeys of
 * the account `userId` (the WebAuthn user handle, base64url) under `rpId`,
 * where the browser has the Signal API: a passkey saved under a guest's name
 * picks up the account's. Never awaited, since an extension may never settle
 * it, and best effort.
 */
export function signalPasskeyLabel(rpId: string, userId: string, name: string): void {
	const signal = (globalThis.PublicKeyCredential as unknown as {
		signalCurrentUserDetails?: (details: { rpId: string; userId: string; name: string; displayName: string }) => Promise<void>;
	} | undefined)?.signalCurrentUserDetails;
	if (typeof signal !== 'function' || !rpId || !userId || !name) return;
	try {
		void signal.call(PublicKeyCredential, { rpId, userId, name, displayName: name }).catch(() => undefined);
	} catch {
		// Unsupported here; the label stays as the passkey was saved.
	}
}
