import { afterEach, describe, expect, it, vi } from 'vitest';
import { credentialSource } from './passkey-diagnostics';
import webAuthn from '../../../protocol/tests/fixtures/webauthn.json';
import { base64url, credentialJSON, labelledCreationOptions, passkeyPublicKeyOptions, passkeyRpIdError, requestPasskey, signalPasskeyLabel } from './webauthn';

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

	it('fills in the extension results an extension’s toJSON leaves out', () => {
		for (const clientExtensionResults of [undefined, null]) {
			const json = {
				id: 'AQI', rawId: 'AQI', type: 'public-key',
				response: { clientDataJSON: 'Aw', authenticatorData: 'BAU', signature: 'Bg', userHandle: 'Bw' },
				...(clientExtensionResults === undefined ? {} : { clientExtensionResults })
			};
			const sent = credentialJSON(proxiedAssertion(() => json));
			expect(sent).toEqual({ ...json, clientExtensionResults: { credProps: { rk: true } } });
			expect(credentialSource(sent)).toEqual({ source: 'toJSON', note: 'toJSON gave no clientExtensionResults; the credential\'s own are sent' });
		}
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

	it('reads the fields itself when toJSON is missing or throws, reaching hidden ones through getters', () => {
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
		// So it does when toJSON throws.
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
});

describe('passkey labels', () => {
	const options = { challenge: 'x', user: { id: 'dXNlci0x', name: 'guest_7', displayName: 'Guest' } };

	it('labels a new passkey with the requested name, keeping the account handle, else the server’s label', () => {
		expect(labelledCreationOptions(options, ' Ada ')).toEqual({ challenge: 'x', user: { id: 'dXNlci0x', name: 'Ada', displayName: 'Ada' } });
		// Without a name, the server's label stands.
		expect(labelledCreationOptions(options, ' ')).toBe(options);
	});

	it('creates the passkey with the label', async () => {
		const parse = vi.fn((json: unknown) => json);
		vi.stubGlobal('isSecureContext', true);
		vi.stubGlobal('PublicKeyCredential', { parseCreationOptionsFromJSON: parse, parseRequestOptionsFromJSON: vi.fn() });
		vi.stubGlobal('navigator', { credentials: { create: vi.fn(async () => proxiedAssertion()) } });
		await requestPasskey('register', { public_key: { ...options, rp: { id: 'demo.example' } } }, new AbortController().signal, 'wss://demo.example/', 'Ada');
		expect(parse).toHaveBeenCalledWith(expect.objectContaining({ user: { id: 'dXNlci0x', name: 'Ada', displayName: 'Ada' } }));
	});

	it('signals the account’s label where the browser can, without waiting on it, and does nothing where it can’t', () => {
		const signalCurrentUserDetails = vi.fn(() => new Promise<void>(() => undefined));
		vi.stubGlobal('PublicKeyCredential', { signalCurrentUserDetails });
		signalPasskeyLabel('demo.example', 'dXNlci0x', 'Ada');
		expect(signalCurrentUserDetails).toHaveBeenCalledWith({ rpId: 'demo.example', userId: 'dXNlci0x', name: 'Ada', displayName: 'Ada' });
		// Without the Signal API, nothing.
		vi.stubGlobal('PublicKeyCredential', {});
		expect(() => signalPasskeyLabel('demo.example', 'dXNlci0x', 'Ada')).not.toThrow();
	});
});

describe('passkey RP IDs', () => {
	it('lets a server ask for its own host or a domain that its host is under', () => {
		expect(passkeyRpIdError('register', { rp: { id: 'apron.chat' } }, 'wss://server.apron.chat/')).toBeUndefined();
		expect(passkeyRpIdError('login', { rpId: 'apron.chat' }, 'wss://server.apron.chat/')).toBeUndefined();
		expect(passkeyRpIdError('login', { rpId: 'Server.Apron.Chat' }, 'wss://server.apron.chat/')).toBeUndefined();
		expect(passkeyRpIdError('login', { rpId: 'localhost' }, 'ws://localhost:8787/')).toBeUndefined();
	});

	it('refuses a server that asks for another domain, such as this client’s, so it cannot relay another server’s challenge', () => {
		expect(passkeyRpIdError('login', { rpId: 'apron.chat' }, 'wss://evil.example/')).toBe('This server (evil.example) asked for a passkey for apron.chat, which is not its own.');
		expect(passkeyRpIdError('register', { rp: { id: 'apron.chat' } }, 'wss://evil.example/')).toBeDefined();
		// A host that only ends with the same letters is not under the domain.
		expect(passkeyRpIdError('login', { rpId: 'apron.chat' }, 'wss://notapron.chat/')).toBeDefined();
		// The RP ID of the other action does not count.
		expect(passkeyRpIdError('login', { rp: { id: 'apron.chat' } }, 'wss://server.apron.chat/')).toBeDefined();
		expect(passkeyRpIdError('login', { rpId: 'apron.chat' }, 'not a url')).toBeDefined();
	});

	it('takes this page’s host for options without an RP ID, as the browser does', () => {
		vi.stubGlobal('location', { hostname: 'web.apron.chat' });
		expect(passkeyRpIdError('login', {}, 'wss://server.apron.chat/')).toBe('This server (server.apron.chat) asked for a passkey for web.apron.chat, which is not its own.');
		expect(passkeyRpIdError('login', {}, 'wss://web.apron.chat/ws')).toBeUndefined();
	});

	it('never opens the browser’s passkey sheet for a server that does not own the RP ID', async () => {
		const create = vi.fn();
		const get = vi.fn();
		vi.stubGlobal('isSecureContext', true);
		vi.stubGlobal('PublicKeyCredential', { parseCreationOptionsFromJSON: vi.fn(), parseRequestOptionsFromJSON: vi.fn() });
		vi.stubGlobal('navigator', { credentials: { create, get } });
		const signal = new AbortController().signal;
		await expect(requestPasskey('login', { public_key: { challenge: 'x', rpId: 'apron.chat' } }, signal, 'wss://evil.example/')).rejects.toThrow('which is not its own');
		await expect(requestPasskey('register', { public_key: { challenge: 'x', rp: { id: 'apron.chat' } } }, signal, 'wss://evil.example/')).rejects.toThrow('which is not its own');
		expect(create).not.toHaveBeenCalled();
		expect(get).not.toHaveBeenCalled();
	});
});

describe('the shared WebAuthn fixture', () => {
	it('uses canonical public_key options and two-step actions', () => {
		expect(webAuthn.format).toBe(1);
		expect(webAuthn.kind).toBe('webauthn');
		const registration = webAuthn.cases[0];
		const options = passkeyPublicKeyOptions(registration.begin_result);
		expect(options).toEqual(registration.begin_result.public_key);
		expect(options?.authenticatorSelection).toEqual({ residentKey: 'required', userVerification: 'required' });
		expect(registration.finish?.params.credential.id).toBe(registration.finish?.params.credential.rawId);
		expect(registration.begin.params).toMatchObject({ scheme: 'webauthn', action: 'register', step: 'begin' });
		expect(registration.finish?.params).toMatchObject({ scheme: 'webauthn', action: 'register', step: 'finish', challenge_id: registration.begin_result.challenge_id });
	});
});
