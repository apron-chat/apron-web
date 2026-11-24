import { describe, expect, it } from 'vitest';
import { ForeignRpIdError, passkeyRoute, usesPage } from './passkey-route';

/** Choosing where a passkey ceremony runs: in this page, or on the server's passkey page (§4.10.1). */
describe('passkey route', () => {
	const external = { url: 'https://chat.example/passkey?action=login' };
	const publicKey = { challenge: 'x', rpId: 'chat.example' };

	it('runs here with public_key, keeping the page to fall back on', () => {
		expect(passkeyRoute({ challenge_id: 'c1', public_key: publicKey })).toEqual({ kind: 'local', challengeId: 'c1', publicKey });
		expect(passkeyRoute({ challenge_id: 'c1', public_key: publicKey, external })).toEqual({ kind: 'local', challengeId: 'c1', publicKey, external });
	});

	it('goes to the page without public_key (or a challenge to finish it), and nowhere without a page', () => {
		expect(passkeyRoute({ external })).toEqual({ kind: 'page', external });
		expect(passkeyRoute({ challenge_id: 'c1', external })).toEqual({ kind: 'page', external });
		expect(passkeyRoute({ public_key: publicKey, external })).toEqual({ kind: 'page', external });
		expect(passkeyRoute({ challenge_id: 'c1' })).toEqual({ kind: 'none' });
		// A page this app may not open is no page.
		expect(passkeyRoute({ external: { url: 'javascript:alert(1)' } })).toEqual({ kind: 'none' });
		expect(passkeyRoute({ external: { url: 'http://chat.example/passkey' } })).toEqual({ kind: 'none' });
	});

	it('falls back to the page for a refused RP ID, never for the user’s no', () => {
		expect(usesPage(new DOMException('The RP ID is not valid', 'SecurityError'))).toBe(true);
		expect(usesPage(new ForeignRpIdError('not its own'))).toBe(true);
		// A password manager's refusal, by name: Bitwarden's is a plain Error.
		expect(usesPage(Object.assign(new Error("'rp.id' cannot be used with the current origin"), { name: 'SecurityError' }))).toBe(true);
		for (const cause of [new DOMException('Dismissed', 'NotAllowedError'), new DOMException('Aborted', 'AbortError'), new Error('SecurityError'), undefined]) {
			expect(usesPage(cause)).toBe(false);
		}
	});
});
