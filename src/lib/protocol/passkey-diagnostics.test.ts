import { afterEach, describe, expect, it, vi } from 'vitest';
import { describeCredential, describeOptions, fromBase64Url, logPasskeyFailure } from './passkey-diagnostics';
import type { JsonObject } from './types';
import { base64url } from './webauthn';

const text = (value: string) => new TextEncoder().encode(value);
const concat = (...parts: Uint8Array[]) => Uint8Array.from(parts.flatMap((part) => [...part]));

/** CBOR for a text string or byte string under 256 bytes, and a map of them (RFC 8949). */
function cborText(value: string): Uint8Array {
	const bytes = text(value);
	return concat(Uint8Array.of(0x60 | bytes.length), bytes);
}
function cborBytes(bytes: Uint8Array): Uint8Array {
	return concat(bytes.length < 24 ? Uint8Array.of(0x40 | bytes.length) : Uint8Array.of(0x58, bytes.length), bytes);
}

async function authData(rpId: string, flags: number, aaguid: number[]): Promise<Uint8Array> {
	const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', text(rpId)));
	return concat(hash, Uint8Array.of(flags), Uint8Array.of(0, 0, 0, 0), Uint8Array.from(aaguid), Uint8Array.of(0, 2, 1, 2));
}

const BITWARDEN = [0xd5, 0x48, 0x82, 0x6e, 0x79, 0xb4, 0xdb, 0x40, 0xa3, 0xd8, 0x11, 0x11, 0x6f, 0x7e, 0x83, 0x49];

async function registration(flags: number, origin = 'https://web.apron.chat'): Promise<JsonObject> {
	const clientData = base64url(text(JSON.stringify({ type: 'webauthn.create', challenge: 'Y2hhbGxlbmdl', origin, crossOrigin: false })));
	const attestation = concat(
		Uint8Array.of(0xa3),
		cborText('fmt'), cborText('none'),
		cborText('attStmt'), Uint8Array.of(0xa0),
		cborText('authData'), cborBytes(await authData('apron.chat', flags, BITWARDEN))
	);
	return {
		id: 'AQIDBAUGBwgJCgsMDQ4PEA', rawId: 'AQIDBAUGBwgJCgsMDQ4PEA', type: 'public-key', authenticatorAttachment: 'platform',
		response: { clientDataJSON: clientData, attestationObject: base64url(attestation), transports: ['internal'] },
		clientExtensionResults: { credProps: { rk: true } }
	};
}

afterEach(() => vi.restoreAllMocks());

describe('describing a credential', () => {
	it('decodes the client data and the attestation’s authenticator data', async () => {
		const described = await describeCredential(await registration(0x45), { challenge: 'Y2hhbGxlbmdl', origin: 'https://web.apron.chat', rpId: 'apron.chat' });
		expect(described).toMatchObject({
			id: 'AQIDBAUGBwgJCgsM…',
			rawIdMatchesId: true,
			authenticatorAttachment: 'platform',
			response: { clientDataJSON: expect.stringMatching(/ bytes$/), attestationObject: expect.stringMatching(/ bytes$/), transports: ['internal'] },
			clientData: { type: 'webauthn.create', origin: 'https://web.apron.chat', originMatches: true, crossOrigin: false, challengeMatches: true },
			attestationFormat: 'none',
			authenticatorData: {
				flags: { userPresent: true, userVerified: true, backupEligible: false, backedUp: false, attestedCredentialData: true, extensionData: false },
				signCount: 0,
				rpIdHashMatches: true,
				aaguid: 'd548826e-79b4-db40-a3d8-11116f7e8349',
				authenticator: 'Bitwarden'
			}
		});
	});

	it('shows what a server would refuse: no user verification, another RP ID, another challenge and origin', async () => {
		const described = await describeCredential(await registration(0x41, 'https://elsewhere.example'), {
			challenge: 'b3RoZXI', origin: 'https://web.apron.chat', rpId: 'server.apron.chat'
		});
		expect(described.clientData).toMatchObject({ originMatches: false, challengeMatches: false });
		expect(described.authenticatorData).toMatchObject({ flags: { userPresent: true, userVerified: false }, rpIdHashMatches: false });
	});

	it('says which field it couldn’t read rather than failing', async () => {
		const described = await describeCredential({ id: 'x', rawId: 'y', type: 'public-key', response: { clientDataJSON: 'eyJub3Q', attestationObject: 'AAAA', signature: 'not base64!' } });
		expect(described).toMatchObject({
			rawIdMatchesId: false,
			clientData: { error: 'clientDataJSON is not JSON' },
			attestationObject: { error: 'attestationObject is not a CBOR map' },
			response: { signature: 'not base64url bytes' }
		});
	});

	it('decodes base64url, and refuses anything else', () => {
		expect(fromBase64Url('-_8')).toEqual(Uint8Array.of(251, 255));
		expect(fromBase64Url('+/8=')).toBeUndefined();
	});
});

describe('describing the server’s options', () => {
	it('keeps what decides what an authenticator does, never the challenge', () => {
		const described = describeOptions('register', {
			challenge: 'secret-ish', rp: { id: 'apron.chat', name: 'Apron' }, user: { id: 'dXNlci0x', name: 'ericd', displayName: 'ericd' },
			pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
			authenticatorSelection: { residentKey: 'required', userVerification: 'required' }, attestation: 'none', timeout: 120000,
			excludeCredentials: [{ id: 'a', type: 'public-key' }]
		});
		expect(described).toEqual({
			rp: { id: 'apron.chat', name: 'Apron' },
			user: { name: 'ericd', displayName: 'ericd', idBytes: 6 },
			authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
			attestation: 'none', algorithms: [-7, -257], timeout: 120000, excludeCredentials: 1
		});
		expect(describeOptions('login', { challenge: 'x', rpId: 'apron.chat', userVerification: 'required' })).toEqual({
			rpId: 'apron.chat', userVerification: 'required', timeout: undefined, allowCredentials: 0
		});
	});
});

describe('the console entry', () => {
	it('warns with the stage, the server’s error, the options and the decoded credential', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		const cause = Object.assign(new Error('Passkey verification failed'), { code: -32001 });
		await logPasskeyFailure({
			action: 'register', stage: 'finish', cause, server: 'wss://server.apron.chat/', requestedName: 'ericd',
			publicKey: { challenge: 'Y2hhbGxlbmdl', rp: { id: 'apron.chat' }, user: { name: 'ericd' } },
			credential: await registration(0x41)
		});
		expect(warn).toHaveBeenCalledTimes(1);
		const [line, details] = warn.mock.calls[0] as [string, Record<string, unknown>];
		expect(line).toBe('[apron] passkey register failed during finish: Passkey verification failed');
		expect(details).toMatchObject({
			stage: 'finish',
			error: { name: 'Error', message: 'Passkey verification failed', code: -32001 },
			server: 'wss://server.apron.chat/',
			requestedName: 'ericd',
			options: { rp: { id: 'apron.chat' } },
			credential: { clientData: { challengeMatches: true }, authenticatorData: { flags: { userVerified: false }, rpIdHashMatches: true, authenticator: 'Bitwarden' } }
		});
	});

	it('only notes a sheet the user dismissed', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
		await logPasskeyFailure({ action: 'login', stage: 'browser', cause: new DOMException('The operation either timed out or was not allowed.', 'NotAllowedError'), server: 'wss://x/' });
		expect(warn).not.toHaveBeenCalled();
		expect(info).toHaveBeenCalledWith('[apron] passkey login failed during browser: The operation either timed out or was not allowed.', expect.objectContaining({ stage: 'browser' }));
	});
});
