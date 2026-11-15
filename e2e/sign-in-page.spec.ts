import type { BrowserContext, Page } from '@playwright/test';
import { DEVICES, expect, test } from './fixtures';
import type { MockOptions } from './mock-server';

/**
 * Signing in on a server's page (§4.12, and the passkey page of PLAN_WEBAUTHN_EXTERNAL.md): the page opens in a
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

/** The connect screen, on the server the page is on, at `scheme`. */
async function connectAt(page: Page, preview: { openConnect(options: { signIn?: boolean }): Promise<void> }, scheme: string): Promise<void> {
	await preview.openConnect({ signIn: true });
	const form = page.getByRole('form', { name: 'Sign in' });
	await form.getByRole('radiogroup', { name: 'Sign in with' }).getByRole('radio', { name: scheme }).click();
}

const auths = (options: MockOptions) => options.sent!.filter((frame) => frame.method === 'auth').map((frame) => frame.params);

test.describe('external sign-in', () => {
	test.use(DEVICES.desktop);

	test('opens the server’s page in a popup and signs in with the code it sends back', async ({ preview, page }) => {
		const requests: URLSearchParams[] = [];
		await signInPage(page.context(), requests);
		const options: MockOptions = {
			server: { auth: ['guest', 'external', 'token'] }, external: { url: `${SSO}?scope=chat`, you: { user_id: 'ada', name: 'Ada' }, token: 'st_ada' }, sent: []
		};
		await preview.openRoot(options);
		await connectAt(page, preview, 'External');
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
		await connectAt(page, preview, 'External');
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
		await connectAt(page, preview, 'External');
		await page.getByTestId('external-start').click();
		await expect.poll(() => requests.length).toBe(1);
		// Back on the app, without the code in its address.
		await page.waitForURL((url) => url.pathname === '/' && !url.search.includes('code'));
		await expect(page.getByTestId('connection-status')).toHaveText('Connected');
		await expect.poll(() => auths(options).some((params) => params.scheme === 'external' && params.code === 'code_1')).toBe(true);
		await expect(page.getByRole('form', { name: 'Sign in' })).toHaveCount(0);
		await preview.openConnect({ signIn: true });
		await expect(page.getByRole('form', { name: 'Sign in' }).getByText('last used: External')).toBeVisible();
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
});
