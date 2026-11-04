import { NOW } from '../scripts/qa/lib/helpers.js';
import { DEVICES, expect, test } from './fixtures';
import { mockServer } from './mock-server';

/**
 * One tab, not two (`src/lib/ui/tab-handoff.ts`): an emailed sign-in link opens a new tab while the tab that
 * asked waits for its code. The tab that asked approves the link on its own connection and goes dormant ("Apron
 * is open in another tab"); the new tab takes up the session it saved. With no tab waiting, the new tab signs in
 * with the link itself.
 */

const ADA = { user_id: 'ada_1234', name: 'Ada', status: 'online' };
const email = { you: ADA, token: 'session-ada' };
// A server with email sign-in also lists `token`, which resumes the session it issues (§4.11).
const server = { auth: ['guest', 'webauthn', 'email', 'token'], signup: ['guest', 'webauthn', 'email'] };

test.describe('a sign-in link opened in another tab', () => {
	test.use(DEVICES.desktop);

	test('the tab that asked approves it and goes dormant, and the new tab takes over signed in', async ({ preview, page, context }) => {
		await preview.openRoot({ email, server });
		// Ask for a code on the connect screen.
		await page.getByRole('button', { name: /^Open preferences/ }).click();
		await page.getByRole('dialog', { name: 'Preferences' }).getByRole('button', { name: 'Sign in', exact: true }).click();
		const form = page.getByRole('form', { name: 'Sign in' });
		await form.getByRole('radio', { name: 'Email' }).click();
		await form.getByTestId('connect-email-input').fill('ada@example.com');
		await form.getByRole('button', { name: /code/i }).click();
		await expect(form.getByTestId('connect-code-input')).toBeVisible();
		const state = await page.evaluate(() => (JSON.parse(localStorage.getItem('apron.proposals') ?? '[]') as { state: string }[]).at(-1)?.state);
		expect(state).toBeTruthy();

		// The emailed link, opened in a new tab of the same browser.
		const opened = await context.newPage();
		await opened.clock.setFixedTime(NOW);
		const sent: Record<string, any>[] = [];
		await mockServer(opened, { email, server, sent });
		await opened.goto(`${process.env.E2E_URL}/#token=apron_email_abc&state=${encodeURIComponent(state!)}`);

		await expect(page.getByTestId('dormant-tab')).toContainText('Apron is open in another tab');
		await expect(opened.getByTestId('connection-status')).toHaveText('Connected');
		await expect(opened.getByRole('button', { name: /^Open preferences/ })).toContainText('Ada');
		// It resumed with the session the other tab handed over, and never used the link itself.
		expect(sent.filter((frame) => frame.method === 'auth').map((frame) => frame.params.scheme === 'token' ? frame.params.token : frame.params.scheme)).toEqual(['guest', 'session-ada']);
		// The token and state were scrubbed from the new tab's address.
		expect(new URL(opened.url()).hash).not.toContain('token=');
	});

	test('with no tab waiting, the new tab signs in with the link itself', async ({ page }) => {
		await page.clock.setFixedTime(NOW);
		await mockServer(page, { email, server });
		// A proposal this browser made, whose tab is gone.
		await page.addInitScript(() => {
			localStorage.setItem('apron.proposals', JSON.stringify([{ scheme: 'email', kind: 'sign-in', url: 'wss://server.apron.chat/', state: 'gone-tab', email: 'ada@example.com', expires: Date.now() + 3_600_000 }]));
		});
		await page.goto(`${process.env.E2E_URL}/#token=apron_email_abc&state=gone-tab`);
		await expect(page.getByRole('button', { name: /^Open preferences/ })).toContainText('Ada');
		await expect(page.getByTestId('dormant-tab')).toHaveCount(0);
	});
});
