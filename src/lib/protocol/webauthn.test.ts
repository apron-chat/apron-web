import { afterEach, describe, expect, it, vi } from 'vitest';
import { credentialSource } from './passkey-diagnostics';
import { base64url, credentialJSON, labelledCreationOptions, requestPasskey, signalPasskeyLabel } from './webauthn';

const bytes = (...values: number[]) => new Uint8Array(values).buffer;

/** A credential as an extension's proxy may hand it back: no usable `toJSON`, fields behind getters. */
function proxiedAssertion(toJSON?: () => unknown): PublicKeyCredential {
	return {
		id: 'AQI',
		rawId: bytes(1, 2),
		type: 'public-key',
		authenticatorAttachment: 'platform',
		response: {
			clientDataJSON: bytes(3),
			get authenticatorData(): ArrayBuffer {
				return undefined as unknown as ArrayBuffer;
			},
			getAuthenticatorData: () => bytes(4, 5),
			signature: bytes(6),
			userHandle: bytes(7)
		},
		getClientExtensionResults: () => ({ credProps: { rk: true } }),
		...(toJSON ? { toJSON } : {})
	} as unknown as PublicKeyCredential;
}

afterEach(() => vi.unstubAllGlobals());

describe('credential JSON', () => {
	it('prefers the browser’s own toJSON where it agrees with the credential’s fields', () => {
		const json = {
			id: 'AQI', rawId: 'AQI', type: 'public-key',
			response: { clientDataJSON: 'Aw', authenticatorData: 'BAU', signature: 'Bg', userHandle: 'Bw' },
			clientExtensionResults: {}
		};
		expect(credentialJSON(proxiedAssertion(() => json))).toBe(json);
		expect(credentialSource(json)).toEqual({ source: 'toJSON' });
	});

	it('sends the credential’s own fields where an extension’s toJSON encodes them otherwise', () => {
		// Padded, plain base64 for the signature, and another credential's client data.
		const json = {
			id: 'AQI', rawId: 'AQI=', type: 'public-key',
			response: { clientDataJSON: 'CQ', authenticatorData: 'BAU', signature: 'Bg==', userHandle: 'Bw' },
			clientExtensionResults: {}
		};
		const sent = credentialJSON(proxiedAssertion(() => json));
		expect(sent.response).toEqual({ clientDataJSON: 'Aw', authenticatorData: 'BAU', signature: 'Bg', userHandle: 'Bw' });
		expect(sent.rawId).toBe('AQI');
		expect(credentialSource(sent)).toEqual({
			source: 'fields',
			note: 'toJSON disagrees with the credential\'s own fields: rawId, response.clientDataJSON, response.signature'
		});
	});

	it('reads the fields itself when toJSON is missing, reaching hidden ones through getters', () => {
		const sent = credentialJSON(proxiedAssertion());
		expect(credentialSource(sent)).toEqual({ source: 'fields', note: 'the credential has no toJSON' });
		expect(sent).toEqual({
			id: 'AQI',
			rawId: 'AQI',
			type: 'public-key',
			authenticatorAttachment: 'platform',
			response: { clientDataJSON: 'Aw', authenticatorData: 'BAU', signature: 'Bg', userHandle: 'Bw' },
			clientExtensionResults: { credProps: { rk: true } }
		});
	});

	it('reads the fields itself when toJSON throws', () => {
		const json = credentialJSON(proxiedAssertion(() => {
			throw new Error('Permission denied to access object');
		}));
		expect(json.response).toEqual(expect.objectContaining({ clientDataJSON: 'Aw', signature: 'Bg' }));
	});

	it('reads a registration response, with the fields only its getters give', () => {
		const credential = {
			id: 'AQI',
			rawId: bytes(1, 2),
			type: 'public-key',
			response: {
				clientDataJSON: bytes(3),
				attestationObject: bytes(8, 9),
				getAuthenticatorData: () => bytes(4, 5),
				getPublicKey: () => bytes(10),
				getPublicKeyAlgorithm: () => -7,
				getTransports: () => ['internal', 'hybrid']
			},
			getClientExtensionResults: () => ({})
		} as unknown as PublicKeyCredential;
		expect(credentialJSON(credential)).toEqual({
			id: 'AQI',
			rawId: 'AQI',
			type: 'public-key',
			response: {
				clientDataJSON: 'Aw', attestationObject: 'CAk', authenticatorData: 'BAU',
				publicKey: 'Cg', publicKeyAlgorithm: -7, transports: ['internal', 'hybrid']
			},
			clientExtensionResults: {}
		});
	});

	it('reads binary data another realm made, as an extension’s proxy may hand back', () => {
		// Another realm's buffer: a real ArrayBuffer whose prototype isn't this realm's.
		const otherRealm = Object.create(Object.prototype, { [Symbol.toStringTag]: { value: 'ArrayBuffer' } });
		const foreign = (...values: number[]) => Object.setPrototypeOf(bytes(...values), otherRealm) as ArrayBuffer;
		expect(foreign(1) instanceof ArrayBuffer).toBe(false);
		const credential = {
			id: 'AQI',
			rawId: foreign(1, 2),
			type: 'public-key',
			response: { clientDataJSON: foreign(3), authenticatorData: foreign(4, 5), signature: foreign(6), userHandle: foreign(7) },
			getClientExtensionResults: () => ({ largeBlob: { blob: foreign(11) } })
		} as unknown as PublicKeyCredential;
		expect(credentialJSON(credential)).toEqual({
			id: 'AQI',
			rawId: 'AQI',
			type: 'public-key',
			response: { clientDataJSON: 'Aw', authenticatorData: 'BAU', signature: 'Bg', userHandle: 'Bw' },
			clientExtensionResults: { largeBlob: { blob: 'Cw' } }
		});
		expect(base64url(foreign(251, 255))).toBe('-_8');
	});

	it('encodes base64url without padding', () => {
		expect(base64url(new Uint8Array([251, 255]))).toBe('-_8');
	});
});

describe('passkey labels', () => {
	const options = { challenge: 'x', user: { id: 'dXNlci0x', name: 'guest_7', displayName: 'Guest' } };

	it('labels a new passkey with the requested name, keeping the account handle', () => {
		expect(labelledCreationOptions(options, ' Ada ')).toEqual({ challenge: 'x', user: { id: 'dXNlci0x', name: 'Ada', displayName: 'Ada' } });
	});

	it('leaves the server’s label without a name', () => {
		expect(labelledCreationOptions(options, ' ')).toBe(options);
	});

	it('creates the passkey with the label', async () => {
		const parse = vi.fn((json: unknown) => json);
		vi.stubGlobal('isSecureContext', true);
		vi.stubGlobal('PublicKeyCredential', { parseCreationOptionsFromJSON: parse, parseRequestOptionsFromJSON: vi.fn() });
		vi.stubGlobal('navigator', { credentials: { create: vi.fn(async () => proxiedAssertion()) } });
		await requestPasskey('register', { public_key: options }, new AbortController().signal, 'Ada');
		expect(parse).toHaveBeenCalledWith(expect.objectContaining({ user: { id: 'dXNlci0x', name: 'Ada', displayName: 'Ada' } }));
	});

	it('signals the account’s label where the browser can, without waiting on it', () => {
		const signalCurrentUserDetails = vi.fn(() => new Promise<void>(() => undefined));
		vi.stubGlobal('PublicKeyCredential', { signalCurrentUserDetails });
		signalPasskeyLabel('demo.example', 'dXNlci0x', 'Ada');
		expect(signalCurrentUserDetails).toHaveBeenCalledWith({ rpId: 'demo.example', userId: 'dXNlci0x', name: 'Ada', displayName: 'Ada' });
	});

	it('does nothing without the Signal API', () => {
		vi.stubGlobal('PublicKeyCredential', {});
		expect(() => signalPasskeyLabel('demo.example', 'dXNlci0x', 'Ada')).not.toThrow();
	});
});
