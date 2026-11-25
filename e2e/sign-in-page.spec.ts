import type { BrowserContext, Page } from '@playwright/test';
import { DEVICES, expect, test } from './fixtures';
import type { MockOptions } from './mock-server';

/**
 * Signing in on a server's page (§4.12, and the passkey page, §4.10.1): the page opens in a
 * popup, or in this tab where the browser blocks one, and sends the viewer back to `/signed-in/` with a code, which
 * the app redeems on its connection. The server's page is scripted here: it reads the request and answers at once.
 */

const SSO = 'https://sso.test/oauth/authorize';
const PASSKEY_PAGE = 'https://sso.test/passkey?action=login';

/**
 * The scripted sign-in page, on `sso.test`, for every page of the context (a popup is one): it records each request's
 * query, and sends the viewer back to its `redirect_uri` with a code and the request's `state`, or with
 * `error=access_denied` (`decline`).
 */
async function signInPage(target: BrowserContext | Page, requests: URLSearchParams[], decline = false): Promise<void> {
	await target.route('https://sso.test/**', (route) => {
		const query = new URL(route.request().url()).searchParams;
		requests.push(query);
		const back = new URL(query.get('redirect_uri')!);
		if (decline) back.searchParams.set('error', 'access_denied');
		else back.searchParams.set('code', 'code_1');
		back.searchParams.set('state', query.get('state')!);
		back.searchParams.set('iss', 'https://sso.test');
		return route.fulfill({ status: 302, headers: { location: back.toString() } });
	});
}

/**
 * The connect screen, on the server the page is on, at external sign-in: by `name`, the server's label for it (§3.2),
 * else by the server's host, as it goes without one.
 */
async function connectAt(page: Page, preview: { openConnect(options: { signIn?: boolean }): Promise<void> }, name?: string): Promise<void> {
	await preview.openConnect({ signIn: true });
	const form = page.getByRole('form', { name: 'Sign in' });
	const host = new URL((await page.getByTestId('connect-server').locator('.ap-connect-address').textContent())!).host;
	await form.getByRole('radiogroup', { name: 'Sign in with' }).getByRole('radio', { name: name ?? host, exact: true }).click();
}

const auths = (options: MockOptions) => options.sent!.filter((frame) => frame.method === 'auth').map((frame) => frame.params);

test.describe('external sign-in', () => {
	test.use(DEVICES.desktop);

	test('opens the server’s page in a popup and signs in with the code it sends back', async ({ preview, page }) => {
		const requests: URLSearchParams[] = [];
		await signInPage(page.context(), requests);
		const options: MockOptions = {
			server: { auth: ['guest', 'external', 'token'], labels: { external: 'Acme SSO' } }, external: { url: `${SSO}?scope=chat`, you: { user_id: 'ada', name: 'Ada' }, token: 'st_ada' }, sent: []
		};
		await preview.openRoot(options);
		// The server's label for external sign-in (§3.2) names the choice.
		await connectAt(page, preview, 'Acme SSO');
		const popup = page.waitForEvent('popup');
		await page.getByTestId('external-start').click();
		// The popup sends its answer back, and closes itself.
		await (await popup).waitForEvent('close');
		await expect(page.getByRole('form', { name: 'Sign in' })).toHaveCount(0);
		await expect(page.getByTestId('connection-status')).toHaveText('Connected');

		// The request: the page's own query kept, then this client's parameters (§4.12.2).
		expect(requests).toHaveLength(1);
		const origin = new URL(page.url()).origin;
		const query = Object.fromEntries(requests[0]);
		expect(query).toMatchObject({
			scope: 'chat', response_type: 'code', client_id: 'apron-web', redirect_uri: `${origin}/signed-in/`,
			code_challenge_method: 'S256', resource: 'https://server.apron.chat'
		});
		expect(query.state).toMatch(/^[A-Za-z0-9_-]{43}$/);
		// Redeemed on a connection: the code, the verifier, and what the request sent.
		const redeemed = auths(options).find((params) => params.scheme === 'external' && params.code);
		expect(redeemed).toMatchObject({ code: 'code_1', redirect_uri: `${origin}/signed-in/`, client_id: 'apron-web' });
		expect(redeemed!.code_verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
	});

	test('says so when the viewer cancels on the server’s page', async ({ preview, page }) => {
		const requests: URLSearchParams[] = [];
		await signInPage(page.context(), requests, true);
		const options: MockOptions = { server: { auth: ['guest', 'external', 'token'] }, external: { url: SSO, you: { user_id: 'ada', name: 'Ada' } }, sent: [] };
		await preview.openRoot(options);
		await connectAt(page, preview);
		await page.getByTestId('external-start').click();
		const form = page.getByRole('form', { name: 'Sign in' });
		await expect(form.getByRole('alert')).toHaveText('Sign-in was cancelled.');
		await expect(form.getByTestId('external-start')).toBeEnabled();
		expect(auths(options).some((params) => params.code)).toBe(false);
	});

	test('goes to the page in this tab where the browser blocks the popup, and signs in on the way back', async ({ preview, page }) => {
		await page.addInitScript(() => {
			window.open = () => null;
		});
		const requests: URLSearchParams[] = [];
		const options: MockOptions = { server: { auth: ['guest', 'external', 'token'] }, external: { url: SSO, you: { user_id: 'ada', name: 'Ada' }, token: 'st_ada' }, sent: [] };
		await preview.openRoot(options);
		// After the scripted server's routes, which refuse every other site.
		await signInPage(page, requests);
		await connectAt(page, preview);
		await page.getByTestId('external-start').click();
		await expect.poll(() => requests.length).toBe(1);
		// Back on the app, without the code in its address.
		await page.waitForURL((url) => url.pathname === '/' && !url.search.includes('code'));
		await expect(page.getByTestId('connection-status')).toHaveText('Connected');
		await expect.poll(() => auths(options).some((params) => params.scheme === 'external' && params.code === 'code_1')).toBe(true);
		await expect(page.getByRole('form', { name: 'Sign in' })).toHaveCount(0);
		await preview.openConnect({ signIn: true });
		const host = new URL((await page.getByTestId('connect-server').locator('.ap-connect-address').textContent())!).host;
		// The way last used here is the one chosen.
		await expect(page.getByRole('form', { name: 'Sign in' }).getByRole('radiogroup', { name: 'Sign in with' }).getByRole('radio', { name: host, exact: true })).toBeChecked();
	});
});

test.describe('a passkey on the server’s passkey page', () => {
	test.use(DEVICES.desktop);

	test('signs in with the page’s code where this page can’t use the server’s passkeys', async ({ preview, page }) => {
		const requests: URLSearchParams[] = [];
		await signInPage(page.context(), requests);
		const options: MockOptions = { passkey: { user_id: 'grace', name: 'Grace' }, passkeyPage: PASSKEY_PAGE, sent: [] };
		await preview.openRoot(options);
		await connectAt(page, preview, 'Passkey');
		const popup = page.waitForEvent('popup');
		await page.getByTestId('passkey-login').click();
		await (await popup).waitForEvent('close');
		await expect(page.getByRole('form', { name: 'Sign in' })).toHaveCount(0);
		expect(Object.fromEntries(requests[0])).toMatchObject({ action: 'login', response_type: 'code', resource: 'https://server.apron.chat' });
		// The `webauthn` finish step takes the code, with the action of its begin.
		const finish = auths(options).find((params) => params.scheme === 'webauthn' && params.step === 'finish');
		expect(finish).toMatchObject({ action: 'login', code: 'code_1', client_id: 'apron-web' });
		expect(finish!.challenge_id).toBeUndefined();
		expect(finish!.credential).toBeUndefined();
	});

	test('continues on the server’s page from the same button, without opening it, when a passkey here finds none', async ({ preview, page }) => {
		const requests: URLSearchParams[] = [];
		await signInPage(page.context(), requests);
		// A device with no passkey for the server's RP ID: the browser's sheet closes empty (NotAllowedError),
		// as it does when the viewer dismisses it.
		await page.addInitScript(() => {
			navigator.credentials.get = async () => { throw new DOMException('The operation either timed out or was not allowed.', 'NotAllowedError'); };
		});
		const options: MockOptions = { passkey: { user_id: 'grace', name: 'Grace' }, passkeyPageBeside: PASSKEY_PAGE, sent: [] };
		await preview.openRoot(options);
		await connectAt(page, preview, 'Passkey');
		let opened = 0;
		page.context().on('page', () => opened++);
		const submit = page.getByTestId('passkey-login');
		await submit.click();
		const form = page.getByRole('form', { name: 'Sign in' });
		// The same button now continues on the server's page; nothing opened yet.
		await expect(submit).toHaveText('Continue on sso.test ↗');
		await expect(submit).toHaveClass(/ap-btn-elsewhere/);
		await expect(form.getByRole('status')).toHaveText('Didn’t find your passkey? Try on sso.test');
		await expect(form.getByRole('alert')).toHaveCount(0);
		expect(opened).toBe(0);
		expect(requests).toEqual([]);
		const popup = page.waitForEvent('popup');
		await submit.click();
		await (await popup).waitForEvent('close');
		await expect(form).toHaveCount(0);
		expect(Object.fromEntries(requests[0])).toMatchObject({ action: 'login', response_type: 'code' });
		const finish = auths(options).find((params) => params.scheme === 'webauthn' && params.step === 'finish');
		expect(finish).toMatchObject({ action: 'login', code: 'code_1', client_id: 'apron-web' });
	});

	/** A device whose sheet closes empty, as when it has no passkey for the RP ID or the viewer dismisses it; `window.sheets` counts the sheets. */
	async function emptySheet(page: Page): Promise<void> {
		await page.addInitScript(() => {
			(window as unknown as { sheets: number }).sheets = 0;
			navigator.credentials.get = async () => {
				(window as unknown as { sheets: number }).sheets++;
				throw new DOMException('The operation either timed out or was not allowed.', 'NotAllowedError');
			};
		});
	}
	const sheets = (page: Page) => page.evaluate(() => (window as unknown as { sheets: number }).sheets);

	test('tells the server’s page to try last the RP ID a sign-in here tried, and the account last signed in here, as hints', async ({ preview, page }) => {
		const requests: URLSearchParams[] = [];
		await signInPage(page.context(), requests);
		await emptySheet(page);
		await preview.openRoot({ passkey: { user_id: 'grace', name: 'Grace' }, passkeyPageBeside: PASSKEY_PAGE, sent: [] });
		await connectAt(page, preview, 'Passkey');
		const server = (await page.getByTestId('connect-server').locator('.ap-connect-address').textContent())!;
		// Ada signed in to this server here before.
		await page.evaluate((url) => localStorage.setItem('apron.lastAccount', JSON.stringify({ [new URL(url).href]: 'ada' })), server);
		const submit = page.getByTestId('passkey-login');
		await submit.click();
		await expect(submit).toHaveText('Continue on sso.test ↗');
		const popup = page.waitForEvent('popup');
		await submit.click();
		await (await popup).waitForEvent('close');
		await expect(page.getByRole('form', { name: 'Sign in' })).toHaveCount(0);
		// The sheet asked for the server's host, which its options named as the RP ID.
		expect(Object.fromEntries(requests[0])).toMatchObject({ action: 'login', login_hint: 'ada', rp_id_last: new URL(server).hostname });
		// Grace signed in this time: she is the one the page hears of next.
		await expect.poll(() => page.evaluate(() => localStorage.getItem('apron.lastAccount'))).toBe(JSON.stringify({ [new URL(server).href]: 'grace' }));
	});

	test('a sign-in that goes to the server’s page without trying here sends no rp_id_last, and nothing it doesn’t know', async ({ preview, page }) => {
		const requests: URLSearchParams[] = [];
		await signInPage(page.context(), requests);
		await preview.openRoot({ passkey: { user_id: 'grace', name: 'Grace' }, passkeyPage: PASSKEY_PAGE, sent: [] });
		await connectAt(page, preview, 'Passkey');
		const popup = page.waitForEvent('popup');
		await page.getByTestId('passkey-login').click();
		await (await popup).waitForEvent('close');
		await expect(page.getByRole('form', { name: 'Sign in' })).toHaveCount(0);
		expect(requests[0].has('rp_id_last')).toBe(false);
		expect(requests[0].has('login_hint')).toBe(false);
	});

	test('Cancel takes the offer back, and the next tap tries a passkey here again', async ({ preview, page }) => {
		await signInPage(page.context(), []);
		await emptySheet(page);
		await preview.openRoot({ passkey: { user_id: 'grace', name: 'Grace' }, passkeyPageBeside: PASSKEY_PAGE, sent: [] });
		await connectAt(page, preview, 'Passkey');
		const submit = page.getByTestId('passkey-login');
		const label = await submit.textContent();
		await submit.click();
		await expect(submit).toHaveText('Continue on sso.test ↗');
		await expect(submit).toHaveAccessibleName('Continue on sso.test, on the server’s sign-in page');
		const form = page.getByRole('form', { name: 'Sign in' });
		await form.getByRole('button', { name: 'Cancel', exact: true }).click();
		// Back as it was: the form stays open, with its usual button and hint.
		await expect(form).toBeVisible();
		await expect(submit).toHaveText(label!);
		await expect(submit).not.toHaveClass(/ap-btn-elsewhere/);
		await expect(form.getByText('Didn’t find your passkey?')).toHaveCount(0);
		await submit.click();
		await expect.poll(() => sheets(page)).toBe(2);
		// Empty again: the page is offered again.
		await expect(submit).toHaveText('Continue on sso.test ↗');
	});

	test('a server without passkey sign-up still offers its page', async ({ preview, page }) => {
		await signInPage(page.context(), []);
		await emptySheet(page);
		await preview.openRoot({ passkey: { user_id: 'grace', name: 'Grace' }, passkeyPageBeside: PASSKEY_PAGE, server: { signup: ['guest'] }, sent: [] });
		await connectAt(page, preview, 'Passkey');
		const submit = page.getByTestId('passkey-login');
		await submit.click();
		await expect(submit).toHaveText('Continue on sso.test ↗');
		await expect(page.getByRole('form', { name: 'Sign in' }).getByRole('alert')).toHaveCount(0);
	});

	test('a password manager’s errors continue on the server’s page too, whatever their kind', async ({ preview, page }) => {
		await signInPage(page.context(), []);
		// As Bitwarden's extension throws them: a plain Error, named as a DOMException would be, or not at all.
		await page.addInitScript(() => {
			let calls = 0;
			navigator.credentials.get = async () => { throw ++calls === 1 ? new Error('Something went wrong.') : Object.assign(new Error("'rp.id' cannot be used with the current origin"), { name: 'SecurityError' }); };
		});
		const options: MockOptions = { passkey: { user_id: 'grace', name: 'Grace' }, passkeyPageBeside: PASSKEY_PAGE, sent: [] };
		await preview.openRoot(options);
		await connectAt(page, preview, 'Passkey');
		const submit = page.getByTestId('passkey-login');
		const form = page.getByRole('form', { name: 'Sign in' });
		// Some other error: offered, from the same button.
		await submit.click();
		await expect(submit).toHaveText('Continue on sso.test ↗');
		await expect(form.getByRole('alert')).toHaveCount(0);
		await form.getByRole('button', { name: 'Cancel', exact: true }).click();
		// The RP ID refused: straight to the page, as when the browser refuses it.
		const popup = page.waitForEvent('popup');
		await submit.click();
		await (await popup).waitForEvent('close');
		await expect(form).toHaveCount(0);
	});

	test('a new passkey that can’t be saved here is offered on the server’s page', async ({ preview, page }) => {
		await signInPage(page.context(), []);
		await page.addInitScript(() => {
			navigator.credentials.create = async () => { throw new DOMException('The operation either timed out or was not allowed.', 'NotAllowedError'); };
		});
		await preview.openRoot({ passkey: { user_id: 'grace', name: 'Grace' }, passkeyPageBeside: PASSKEY_PAGE, sent: [] });
		await connectAt(page, preview, 'Passkey');
		const form = page.getByRole('form', { name: 'Sign in' });
		await page.getByTestId('passkey-choice-register').click();
		const submit = page.getByTestId('passkey-register');
		await submit.click();
		await expect(submit).toHaveText('Continue on sso.test ↗');
		await expect(form.getByRole('status')).toHaveText('Couldn’t save a passkey here? Try on sso.test');
		// Already on Create account: nothing nudges toward it.
		await expect(page.locator('.ap-choice-nudge')).toHaveCount(0);
	});

	test('remembers that the server’s page worked, and goes straight there next time, without asking the device', async ({ preview, page }) => {
		await signInPage(page.context(), []);
		await emptySheet(page);
		await preview.openRoot({ passkey: { user_id: 'grace', name: 'Grace' }, passkeyPageBeside: PASSKEY_PAGE, sent: [] });
		await connectAt(page, preview, 'Passkey');
		const submit = page.getByTestId('passkey-login');
		await submit.click();
		await expect(submit).toHaveText('Continue on sso.test ↗');
		const popup = page.waitForEvent('popup');
		await submit.click();
		await (await popup).waitForEvent('close');
		await expect(page.getByRole('form', { name: 'Sign in' })).toHaveCount(0);
		const remembered = await page.evaluate(() => JSON.parse(localStorage.getItem('apron.passkeyOnPage') ?? '{}') as Record<string, number>);
		expect(Object.keys(remembered)).toHaveLength(1);
	});

	test('where the server’s page worked before, the first tap goes there, and the device isn’t asked', async ({ preview, page }) => {
		await signInPage(page.context(), []);
		await emptySheet(page);
		await preview.openRoot({ passkey: { user_id: 'grace', name: 'Grace' }, passkeyPageBeside: PASSKEY_PAGE, sent: [] });
		await connectAt(page, preview, 'Passkey');
		const server = (await page.getByTestId('connect-server').locator('.ap-connect-address').textContent())!;
		await page.evaluate((url) => localStorage.setItem('apron.passkeyOnPage', JSON.stringify({ [new URL(url).href]: Date.now() })), server);
		const popup = page.waitForEvent('popup');
		await page.getByTestId('passkey-login').click();
		await (await popup).waitForEvent('close');
		await expect(page.getByRole('form', { name: 'Sign in' })).toHaveCount(0);
		expect(await sheets(page)).toBe(0);
	});

	test('adding a passkey in Preferences that can’t be saved here offers the server’s page', async ({ preview, page }) => {
		await signInPage(page.context(), []);
		// Signing in works here; saving another passkey doesn't.
		await page.addInitScript(() => {
			const bytes = () => new Uint8Array([1, 2, 3]).buffer;
			navigator.credentials.get = async () => ({
				id: 'AQID', rawId: bytes(), type: 'public-key',
				response: { clientDataJSON: bytes(), authenticatorData: bytes(), signature: bytes(), userHandle: bytes() },
				getClientExtensionResults: () => ({})
			}) as unknown as Credential;
			navigator.credentials.create = async () => { throw Object.assign(new Error('Something went wrong.'), { name: 'Error' }); };
		});
		await preview.openRoot({ passkey: { user_id: 'grace', name: 'Grace' }, passkeyPageBeside: PASSKEY_PAGE, sent: [] });
		await connectAt(page, preview, 'Passkey');
		await page.getByTestId('passkey-login').click();
		await expect(page.getByRole('form', { name: 'Sign in' })).toHaveCount(0);
		await page.getByRole('button', { name: /^Open preferences/ }).click();
		const preferences = page.getByRole('dialog', { name: 'Preferences' });
		await preferences.getByRole('group', { name: 'Add a way to sign in' }).getByRole('button', { name: /Passkey/ }).click();
		// Not an error: the sheet may only have been closed.
		await expect(preferences.getByRole('alert')).toHaveCount(0);
		await expect(preferences.getByRole('status')).toContainText('Passkey not saved here.');
		const popup = page.waitForEvent('popup');
		await preferences.getByRole('button', { name: 'Continue on sso.test, on the server’s sign-in page' }).click();
		await (await popup).waitForEvent('close');
		await expect(preferences.getByRole('status')).toContainText('Passkey saved.');
	});

	test('a remembered page that doesn’t work is forgotten: the next tap asks the device again', async ({ preview, page }) => {
		// The server's page declines (access_denied).
		await signInPage(page.context(), [], true);
		await emptySheet(page);
		await preview.openRoot({ passkey: { user_id: 'grace', name: 'Grace' }, passkeyPageBeside: PASSKEY_PAGE, sent: [] });
		await connectAt(page, preview, 'Passkey');
		const server = (await page.getByTestId('connect-server').locator('.ap-connect-address').textContent())!;
		await page.evaluate((url) => localStorage.setItem('apron.passkeyOnPage', JSON.stringify({ [new URL(url).href]: Date.now() })), server);
		const submit = page.getByTestId('passkey-login');
		const popup = page.waitForEvent('popup');
		await submit.click();
		await (await popup).waitForEvent('close');
		await expect(page.getByRole('form', { name: 'Sign in' }).getByRole('alert')).toBeVisible();
		expect(await page.evaluate(() => localStorage.getItem('apron.passkeyOnPage'))).toBe('{}');
		await submit.click();
		await expect.poll(() => sheets(page)).toBe(1);
	});

	test('Change lets the offer go', async ({ preview, page }) => {
		await signInPage(page.context(), []);
		await emptySheet(page);
		await preview.openRoot({ passkey: { user_id: 'grace', name: 'Grace' }, passkeyPageBeside: PASSKEY_PAGE, sent: [] });
		await connectAt(page, preview, 'Passkey');
		const submit = page.getByTestId('passkey-login');
		const label = await submit.textContent();
		await submit.click();
		await expect(submit).toHaveText('Continue on sso.test ↗');
		const form = page.getByRole('form', { name: 'Sign in' });
		await page.getByTestId('connect-server').getByRole('button', { name: 'Change', exact: true }).click();
		await form.getByRole('button', { name: 'Continue', exact: true }).click();
		await form.getByRole('radiogroup', { name: 'Sign in with' }).getByRole('radio', { name: 'Passkey', exact: true }).click();
		await expect(submit).toHaveText(label!);
		await expect(submit).not.toHaveClass(/ap-btn-elsewhere/);
	});
});

test.describe('the account last signed in here, for the server’s passkey page', () => {
	test.use(DEVICES.desktop);
	const last = (page: Page) => page.evaluate(() => localStorage.getItem('apron.lastAccount'));

	test('is noted for a signed-in account, not for a guest', async ({ preview, page }) => {
		await preview.openRoot({});
		await expect(page.getByTestId('connection-status')).toHaveText('Connected');
		expect(await last(page)).toBeNull();
		await preview.openRoot({ token: 'account-session', you: { user_id: 'lovelace', name: 'Ada' } });
		await expect.poll(() => last(page)).toContain('lovelace');
	});

	test('is never noted while local history isn’t kept', async ({ preview, page }) => {
		await page.addInitScript(() => { localStorage.setItem('apron.historyRetention', 'off'); });
		await preview.openRoot({ token: 'account-session', you: { user_id: 'lovelace', name: 'Ada' } });
		await expect(page.getByTestId('connection-status')).toHaveText('Connected');
		await page.waitForTimeout(200);
		expect(await last(page)).toBeNull();
	});
});

