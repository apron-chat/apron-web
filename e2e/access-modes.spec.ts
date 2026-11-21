import type { Browser, BrowserContext, Page } from '@playwright/test';
import { NOW } from '../scripts/qa/lib/helpers.js';
import { DEVICES, Preview, expect, test } from './fixtures';
import { LOBBY_DESCRIPTION, MockAccess, mockServer } from './mock-server';

/**
 * Access modes (PLAN §9), with nothing beyond the core protocol: a server in `lobby` mode, where guests and the
 * accounts they make see only the Public Lobby until an admin runs `/welcome`, and which can stop taking guests; and
 * one in `private` mode, with no guests. Against `MockAccess`, whose one state serves every page of a test.
 */

const SERVER = 'wss://server.apron.chat/';

/** Opens the app on `/` against `access`, resuming a kept session `token` if given, and waits until it is connected. */
async function open(page: Page, access: MockAccess, options: { token?: string; connected?: boolean } = {}): Promise<Preview> {
	const base = process.env.E2E_URL;
	if (!base) throw new Error('E2E_URL is unset: run through `npm run e2e`.');
	await page.clock.setFixedTime(NOW);
	await mockServer(page, { access });
	if (options.token) await page.addInitScript(([key, value]) => localStorage.setItem(key, value), [`apron.session:${SERVER}`, options.token] as const);
	await page.goto(`${base}/`);
	if (options.connected !== false) await expect(page.getByTestId('connection-status')).toHaveText('Connected');
	return new Preview(page, {});
}

/** The browsers `someoneElse` opened for this test, closed after it. */
const others: BrowserContext[] = [];
test.afterEach(async () => {
	await Promise.all(others.splice(0).map((context) => context.close()));
});

/** Someone else, in a browser of their own: one browser connects to a server from one window at a time (Web Locks). */
async function someoneElse(browser: Browser): Promise<Page> {
	const context = await browser.newContext({ viewport: DEVICES.desktop.viewport, locale: 'en-US', timezoneId: 'UTC', reducedMotion: 'reduce' });
	others.push(context);
	return context.newPage();
}

const rows = (page: Page) => page.getByTestId('room-list').locator('button[data-room]');

test.describe('a server with a lobby', () => {
	test.use(DEVICES.desktop);

	test('a guest sees only the lobby, with its description, and posts an intro another guest sees', async ({ page, browser }) => {
		const access = new MockAccess('lobby');
		const preview = await open(page, access);
		await expect(rows(page)).toHaveCount(1);
		await expect(rows(page)).toHaveAttribute('data-room', 'lobby');
		await expect(preview.heading()).toHaveText('Public Lobby');
		// What to do comes from the lobby's description, pinned under its header.
		await expect(page.getByTestId('pane-description')).toHaveText(LOBBY_DESCRIPTION);
		await expect(page.getByTestId('room-directory')).toHaveCount(0);
		await expect(preview.message('I’m Nina, here for the meetup')).toBeVisible();
		await preview.composer().fill('Hello, I’m new here');
		await preview.composer().press('Enter');
		await expect(preview.message('Hello, I’m new here')).toBeVisible();
		const other = await open(await someoneElse(browser), access);
		await expect(other.message('Hello, I’m new here')).toBeVisible();
	});

	test('an admin’s /welcome goes to the server as typed, which tells the guest', async ({ page, browser }) => {
		const access = new MockAccess('lobby');
		const guest = await open(await someoneElse(browser), access);
		const admin = await open(page, access, { token: 'admin-token' });
		await admin.openRoom('lobby');
		await admin.composer().fill('/welcome @guest_1');
		// The mention picker offers the guest; Escape keeps the text as typed.
		await admin.composer().press('Escape');
		await admin.composer().press('Enter');
		await expect.poll(() => access.sent.filter(({ from, frame }) => from === 'ada' && frame.method === 'command').map(({ frame }) => frame.params.body.text)).toEqual(['/welcome @guest_1']);
		// Not taken for a request of the client's own.
		expect(access.sent.some(({ from, frame }) => from === 'ada' && frame.method === 'room_join')).toBe(false);
		await expect(page.getByTestId('message-list')).toContainText('You welcomed guest_1.');
		await expect(guest.page.getByTestId('message-list')).toContainText('Ada welcomed you. Add a passkey to finish joining');
	});

	test('a waiting account let in sees the rooms the server now shows it, without a reload', async ({ page }) => {
		const access = new MockAccess('lobby');
		access.waiting('wanda', 'wanda-token');
		const sockets: string[] = [];
		await open(page, access, { token: 'wanda-token' });
		await expect(rows(page)).toHaveCount(1);
		await expect(page.getByTestId('room-directory')).toHaveCount(0);
		page.on('websocket', (ws) => sockets.push(ws.url()));
		access.welcome('wanda');
		await expect(page.getByTestId('message-list')).toContainText('Ada welcomed you in.');
		// General, now visible: under Other Rooms, to read or join.
		const general = page.getByTestId('room-directory').locator('button[data-join="general"]');
		await expect(general).toBeVisible();
		await general.click();
		await expect(page.getByRole('main', { name: 'Conversation' }).getByRole('heading', { level: 1 }).first()).toHaveText('General');
		expect(sockets).toEqual([]);
	});

	test('a guest whose session the server ends (1008) isn’t signed in as a guest again by itself; a newcomer is offered only sign-in', async ({ page, browser }) => {
		const access = new MockAccess('lobby');
		const preview = await open(page, access);
		await expect(preview.message('I’m Nina, here for the meetup')).toBeVisible();
		access.setOpen(false);
		await expect(page.getByTestId('message-list')).toContainText('The Public Lobby is closed.');
		await expect(page.getByTestId('connection-status')).toContainText('The server ended this guest session (The Public Lobby is closed).');
		const auths = () => access.sent.filter(({ frame }) => frame.method === 'auth').length;
		const before = auths();
		await page.waitForTimeout(1_500);
		expect(auths()).toBe(before);

		// Meanwhile a newcomer gets the sign-in screen, without Guest, and nothing of the server behind it.
		const newcomer = await someoneElse(browser);
		await open(newcomer, access, { connected: false });
		const form = newcomer.getByRole('form', { name: 'Sign in' });
		await expect(form.getByRole('radiogroup', { name: 'Sign in with' }).getByRole('radio')).toHaveText(['Passkey', 'Token']);
		await expect(newcomer.getByTestId('message-list')).toHaveCount(0);
		await expect(newcomer.getByTestId('room-list')).toHaveCount(0);

		// Taking guests again, the guest's Sign in connects, as a guest again.
		access.setOpen(true);
		await page.getByRole('main').getByRole('button', { name: 'Sign in', exact: true }).click();
		await expect(page.getByTestId('connection-status')).toHaveText('Connected');
		expect(auths()).toBe(before + 1);
	});
});

test.describe('a private server', () => {
	test.use(DEVICES.desktop);

	test('offers only signing in, shows nothing before it, and onboards with an invite link and a nudge to add a way back in', async ({ page }) => {
		const access = new MockAccess('private');
		await open(page, access, { connected: false });
		const form = page.getByRole('form', { name: 'Sign in' });
		await expect(form).toBeVisible();
		await expect(form.getByRole('radiogroup', { name: 'Sign in with' }).getByRole('radio')).toHaveText(['Passkey', 'Token']);
		// Passkeys sign in only: no account is made with one here.
		await expect(form.getByRole('radiogroup', { name: 'Passkey', exact: true })).toHaveCount(0);
		await expect(page.getByTestId('message-list')).toHaveCount(0);
		await expect(page.getByTestId('room-list')).toHaveCount(0);
		expect(access.sent.filter(({ frame }) => frame.method === 'auth' || frame.method === 'room_list')).toEqual([]);

		// An invite link: asked first, then a member, told to add a way back in.
		await page.goto(`${process.env.E2E_URL}/#server=${encodeURIComponent(SERVER)}&token=${MockAccess.INVITE_TOKEN}`);
		await page.getByRole('dialog').getByRole('button', { name: 'Sign in', exact: true }).click();
		await expect(page.getByTestId('connection-status')).toHaveText('Connected');
		await expect(page.getByTestId('room-list').locator('button[data-room="general"]')).toBeVisible();
		expect(access.sent.some(({ frame }) => frame.method === 'auth' && frame.params?.scheme === 'token' && frame.params?.token === MockAccess.INVITE_TOKEN)).toBe(true);
		await expect(page.getByRole('button', { name: /^Open preferences/ })).toContainText(/add a sign-in/i);
	});
});
