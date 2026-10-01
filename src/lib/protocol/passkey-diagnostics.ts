/**
 * What the browser console says when a passkey ceremony fails, so a failure
 * someone reports (a password-manager extension, an RP ID mismatch, a missing
 * user-verification flag) can be told apart afterwards. Servers deliberately
 * answer every verification failure with one message (§4.9: `denied`); the
 * credential the browser handed back usually says why. Nothing logged is
 * secret: the options and the credential are public by design, and the
 * credential's signature is not logged.
 */
import { isJsonObject, type JsonObject } from './types';

export type PasskeyStage = 'waiting' | 'begin' | 'browser' | 'finish';

/** How a credential was turned into JSON (see `credentialJSON`): the browser's `toJSON`, or its fields read one by one, and why. */
export interface CredentialSource {
	source: 'toJSON' | 'fields';
	note?: string;
}

const sources = new WeakMap<JsonObject, CredentialSource>();

export function noteCredentialSource(json: JsonObject, source: CredentialSource): void {
	sources.set(json, source);
}

export function credentialSource(json: JsonObject): CredentialSource | undefined {
	return sources.get(json);
}

/** The parts of the server's options (§4.9 `public_key`) that decide what a browser or extension will do. */
export function describeOptions(action: 'register' | 'login', publicKey: JsonObject | undefined): Record<string, unknown> | undefined {
	if (!publicKey) return undefined;
	const count = (value: unknown) => (Array.isArray(value) ? value.length : 0);
	if (action === 'login') {
		return {
			rpId: publicKey.rpId,
			userVerification: publicKey.userVerification,
			timeout: publicKey.timeout,
			allowCredentials: count(publicKey.allowCredentials),
			...(publicKey.hints !== undefined ? { hints: publicKey.hints } : {})
		};
	}
	const rp = isJsonObject(publicKey.rp) ? publicKey.rp : {};
	const user = isJsonObject(publicKey.user) ? publicKey.user : {};
	const algorithms = Array.isArray(publicKey.pubKeyCredParams)
		? publicKey.pubKeyCredParams.map((param) => (isJsonObject(param) ? param.alg : undefined))
		: undefined;
	return {
		rp: { id: rp.id, name: rp.name },
		user: { name: user.name, displayName: user.displayName, idBytes: typeof user.id === 'string' ? decodedLength(user.id) : undefined },
		authenticatorSelection: publicKey.authenticatorSelection,
		attestation: publicKey.attestation,
		algorithms,
		timeout: publicKey.timeout,
		excludeCredentials: count(publicKey.excludeCredentials),
		...(publicKey.hints !== undefined ? { hints: publicKey.hints } : {})
	};
}

/** Authenticators an AAGUID names, for the ones people report problems with. */
const AUTHENTICATORS: Record<string, string> = {
	'd548826e-79b4-db40-a3d8-11116f7e8349': 'Bitwarden',
	'bada5566-a7aa-401f-bd96-45619a55120d': '1Password',
	'531126d6-e717-415c-9320-3d9aa6981239': 'Dashlane',
	'50726f74-6f6e-5061-7373-50726f746f6e': 'Proton Pass',
	'fbfc3007-154e-4ecc-8c0b-6e020557d7bd': 'iCloud Keychain',
	'ea9b8d66-4d01-1d21-3ce4-b6b48cb575d4': 'Google Password Manager',
	'adce0002-35bc-c60a-648b-0b25f1f05503': 'Chrome on Mac',
	'00000000-0000-0000-0000-000000000000': 'not given (all zeros)'
};

/**
 * What the browser handed back, decoded: which way it was serialized, the
 * client data (type, origin, whether the challenge is the one asked), and the
 * authenticator data's flags (user present, user verified, backup), its RP ID
 * hash against `expected.rpId`, and the authenticator's AAGUID.
 */
export async function describeCredential(
	json: JsonObject,
	expected: { challenge?: string; origin?: string; rpId?: string } = {}
): Promise<Record<string, unknown>> {
	const response = isJsonObject(json.response) ? json.response : {};
	const fields: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(response)) {
		if (key === 'signature') fields[key] = typeof value === 'string' ? `${decodedLength(value) ?? 'not base64url'} bytes` : typeof value;
		else if (typeof value === 'string') fields[key] = decodedLength(value) === undefined ? `not base64url (${value.length} chars)` : `${decodedLength(value)} bytes`;
		else fields[key] = value;
	}
	const summary: Record<string, unknown> = {
		...(credentialSource(json) ?? {}),
		id: typeof json.id === 'string' ? truncate(json.id) : json.id,
		rawIdMatchesId: json.rawId === json.id,
		type: json.type,
		authenticatorAttachment: json.authenticatorAttachment,
		response: fields,
		clientExtensionResults: json.clientExtensionResults
	};

	const clientData = typeof response.clientDataJSON === 'string' ? decodeClientData(response.clientDataJSON) : undefined;
	if (clientData) {
		summary.clientData = 'error' in clientData ? clientData : {
			type: clientData.type,
			origin: clientData.origin,
			...(expected.origin !== undefined ? { originMatches: clientData.origin === expected.origin } : {}),
			...(clientData.crossOrigin !== undefined ? { crossOrigin: clientData.crossOrigin } : {}),
			...(clientData.topOrigin !== undefined ? { topOrigin: clientData.topOrigin } : {}),
			...(expected.challenge !== undefined ? { challengeMatches: clientData.challenge === expected.challenge } : {})
		};
	}

	let authData = typeof response.authenticatorData === 'string' ? fromBase64Url(response.authenticatorData) : undefined;
	if (typeof response.attestationObject === 'string') {
		const attestation = decodeAttestation(response.attestationObject);
		if ('error' in attestation) summary.attestationObject = attestation;
		else {
			summary.attestationFormat = attestation.fmt;
			authData ??= attestation.authData;
		}
	}
	if (authData) summary.authenticatorData = await describeAuthenticatorData(authData, expected.rpId);
	return summary;
}

async function describeAuthenticatorData(data: Uint8Array, rpId: string | undefined): Promise<Record<string, unknown>> {
	if (data.length < 37) return { error: `too short (${data.length} bytes)` };
	const flags = data[32];
	const described: Record<string, unknown> = {
		flags: {
			userPresent: Boolean(flags & 0x01),
			userVerified: Boolean(flags & 0x04),
			backupEligible: Boolean(flags & 0x08),
			backedUp: Boolean(flags & 0x10),
			attestedCredentialData: Boolean(flags & 0x40),
			extensionData: Boolean(flags & 0x80)
		},
		signCount: new DataView(data.buffer, data.byteOffset + 33, 4).getUint32(0)
	};
	if (rpId) {
		const hash = await sha256(rpId);
		if (hash) described.rpIdHashMatches = hash.every((byte, index) => byte === data[index]);
	}
	if (flags & 0x40 && data.length >= 53) {
		const hex = [...data.subarray(37, 53)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
		const aaguid = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
		described.aaguid = aaguid;
		if (AUTHENTICATORS[aaguid]) described.authenticator = AUTHENTICATORS[aaguid];
	}
	return described;
}

/** Writes one console entry for a failed ceremony: a cancellation is info, anything else a warning. */
export async function logPasskeyFailure(report: {
	action: 'register' | 'login';
	stage: PasskeyStage;
	cause: unknown;
	server: string;
	requestedName?: string;
	publicKey?: JsonObject;
	credential?: JsonObject;
}): Promise<void> {
	const { action, stage, cause, publicKey, credential } = report;
	const error = describeError(cause);
	const challenge = typeof publicKey?.challenge === 'string' ? publicKey.challenge : undefined;
	const rpId = action === 'register'
		? (isJsonObject(publicKey?.rp) && typeof publicKey.rp.id === 'string' ? publicKey.rp.id : undefined)
		: (typeof publicKey?.rpId === 'string' ? publicKey.rpId : undefined);
	const origin = globalThis.location?.origin;
	const details: Record<string, unknown> = {
		stage,
		error,
		server: report.server,
		page: { origin, secureContext: globalThis.isSecureContext, userAgent: globalThis.navigator?.userAgent },
		...(report.requestedName ? { requestedName: report.requestedName } : {}),
		...(publicKey ? { options: describeOptions(action, publicKey) } : {}),
		...(credential ? { credential: await describeCredential(credential, { challenge, origin, rpId: rpId ?? globalThis.location?.hostname }).catch((failure) => ({ error: String(failure) })) } : {})
	};
	const cancelled = error.name === 'AbortError' || (error.name === 'NotAllowedError' && stage === 'browser');
	const line = `[apron] passkey ${action} failed during ${stage}: ${error.message}`;
	if (cancelled) console.info(line, details);
	else console.warn(line, details);
}

export function describeError(cause: unknown): { name: string; message: string; code?: number } {
	if (cause instanceof Error || (typeof DOMException !== 'undefined' && cause instanceof DOMException)) {
		const code = (cause as Error & { code?: unknown }).code;
		return { name: cause.name, message: cause.message, ...(typeof code === 'number' ? { code } : {}) };
	}
	return { name: typeof cause, message: String(cause) };
}

function truncate(value: string): string {
	return value.length > 16 ? `${value.slice(0, 16)}…` : value;
}

function decodedLength(value: string): number | undefined {
	return fromBase64Url(value)?.length;
}

export function fromBase64Url(value: string): Uint8Array | undefined {
	if (!/^[A-Za-z0-9_-]*$/.test(value) || value.length % 4 === 1) return undefined;
	try {
		const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4));
		return Uint8Array.from(binary, (char) => char.charCodeAt(0));
	} catch {
		return undefined;
	}
}

function decodeClientData(value: string): JsonObject | { error: string } {
	const bytes = fromBase64Url(value);
	if (!bytes) return { error: 'clientDataJSON is not base64url' };
	try {
		const parsed = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
		return isJsonObject(parsed) ? parsed : { error: 'clientDataJSON is not an object' };
	} catch {
		return { error: 'clientDataJSON is not JSON' };
	}
}

function decodeAttestation(value: string): { fmt?: unknown; authData?: Uint8Array } | { error: string } {
	const bytes = fromBase64Url(value);
	if (!bytes) return { error: 'attestationObject is not base64url' };
	try {
		const [decoded] = decodeCbor(bytes, 0);
		if (!(decoded instanceof Map)) return { error: 'attestationObject is not a CBOR map' };
		const authData = decoded.get('authData');
		return { fmt: decoded.get('fmt'), ...(authData instanceof Uint8Array ? { authData } : {}) };
	} catch (failure) {
		return { error: `attestationObject is not valid CBOR (${failure instanceof Error ? failure.message : String(failure)})` };
	}
}

/** Just enough CBOR (RFC 8949) for an attestation object: integers, byte and text strings, arrays, maps, simple values. */
function decodeCbor(bytes: Uint8Array, offset: number, depth = 0): [unknown, number] {
	if (depth > 16) throw new Error('nested too deeply');
	if (offset >= bytes.length) throw new Error('truncated');
	const initial = bytes[offset];
	const major = initial >> 5;
	const info = initial & 0x1f;
	let at = offset + 1;
	const argument = (): number => {
		if (info < 24) return info;
		const size = info === 24 ? 1 : info === 25 ? 2 : info === 26 ? 4 : info === 27 ? 8 : 0;
		if (!size) throw new Error(`unsupported length ${info}`);
		if (at + size > bytes.length) throw new Error('truncated');
		let value = 0;
		for (let index = 0; index < size; index += 1) value = value * 256 + bytes[at + index];
		at += size;
		return value;
	};
	switch (major) {
		case 0:
			return [argument(), at];
		case 1:
			return [-1 - argument(), at];
		case 2:
		case 3: {
			const length = argument();
			if (at + length > bytes.length) throw new Error('truncated');
			const slice = bytes.subarray(at, at + length);
			return [major === 2 ? slice : new TextDecoder().decode(slice), at + length];
		}
		case 4: {
			const length = argument();
			const items: unknown[] = [];
			for (let index = 0; index < length; index += 1) {
				const [item, next] = decodeCbor(bytes, at, depth + 1);
				items.push(item);
				at = next;
			}
			return [items, at];
		}
		case 5: {
			const length = argument();
			const map = new Map<unknown, unknown>();
			for (let index = 0; index < length; index += 1) {
				const [key, afterKey] = decodeCbor(bytes, at, depth + 1);
				const [value, afterValue] = decodeCbor(bytes, afterKey, depth + 1);
				map.set(key, value);
				at = afterValue;
			}
			return [map, at];
		}
		case 7:
			if (info === 20) return [false, at];
			if (info === 21) return [true, at];
			if (info === 22) return [null, at];
			throw new Error(`unsupported simple value ${info}`);
		default:
			throw new Error(`unsupported major type ${major}`);
	}
}

async function sha256(text: string): Promise<Uint8Array | undefined> {
	const subtle = globalThis.crypto?.subtle;
	if (!subtle) return undefined;
	return new Uint8Array(await subtle.digest('SHA-256', new TextEncoder().encode(text)));
}
