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

/** The browser's passkey sheets, answered: the scripted server verifies nothing. */
async function passkeys(page: Page): Promise<void> {
	await page.addInitScript(() => {
		const bytes = () => new Uint8Array([1, 2, 3]).buffer;
		navigator.credentials.create = async () => ({
			id: 'AQID', rawId: bytes(), type: 'public-key',
			response: { clientDataJSON: bytes(), attestationObject: bytes(), getTransports: () => ['internal'] },
			getClientExtensionResults: () => ({})
		}) as unknown as Credential;
	});
}

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
		// A guest shows with their user_id, whatever name they took: one of anyone's.
		await expect(preview.message('Hello, I’m new here').locator('.ap-msg-handle')).toHaveText('@guest_1');
		const other = await open(await someoneElse(browser), access);
		await expect(other.message('Hello, I’m new here')).toBeVisible();
		await expect(other.message('Hello, I’m new here').locator('.ap-msg-handle')).toHaveText('@guest_1');
		await expect(other.message('I’m Nina, here for the meetup').locator('.ap-msg-handle')).toHaveText('@guest_9');
		// Her join was logged under the name she joined with, and her user object carries none: the line names her as her messages do.
		await expect(other.page.getByTestId('membership-line').first()).toHaveText(/Nina \(@guest_9\) joined/);
	});

	test('a guest who signs up with a passkey is a new user: what they posted as a guest stays the guest’s', async ({ page, browser }) => {
		const access = new MockAccess('lobby');
		await passkeys(page);
		const preview = await open(page, access);
		const someone = await open(await someoneElse(browser), access);
		await preview.composer().fill('Hi, I’m Maya');
		await preview.composer().press('Enter');
		await expect(preview.message('Hi, I’m Maya').locator('.ap-msg-handle')).toHaveText('@guest_1');
		// Signing up from Profile: Passkey, Create account, on this connection.
		await page.getByRole('button', { name: /^Open preferences/ }).click();
		await page.getByRole('dialog', { name: 'Preferences' }).getByRole('button', { name: 'Sign in', exact: true }).click();
		const form = page.getByRole('form', { name: 'Sign in' });
		await form.getByRole('radiogroup', { name: 'Sign in with' }).getByRole('radio', { name: 'Passkey' }).click();
		await form.getByRole('radiogroup', { name: 'Passkey', exact: true }).getByRole('radio', { name: /^Create account/ }).click();
		await page.getByTestId('connect-name-input').fill('Maya');
		await page.getByTestId('passkey-register').click();
		await expect(form).toHaveCount(0);
		expect(access.connections.find((conn) => conn.account?.token === 'wanda-token')?.you?.user_id).toBe('wanda');
		await expect(page.getByRole('button', { name: /^Open preferences/ })).toContainText('Maya');
		// The account is a new user (shazow/apron#137): the guest's message stays the guest's, name and ID, for them and for others.
		for (const viewer of [preview, someone]) {
			const theirs = viewer.message('Hi, I’m Maya');
			await expect(theirs.locator('.ap-msg-handle')).toHaveText('@guest_1');
			await expect(theirs).toContainText('Guest 1');
		}
		// Others see the guest leave and the account arrive, in the lobby's member list.
		const list = await someone.showMembers();
		await expect(list.locator('button[data-user-id="wanda"]')).toBeVisible();
		await expect(list.locator('button[data-user-id="guest_1"]')).toHaveCount(0);
	});

	test('a welcomed guest who signs up leaves no welcomed badge on what they posted as a guest', async ({ page, browser }) => {
		const access = new MockAccess('lobby');
		await passkeys(page);
		const preview = await open(page, access);
		const someone = await open(await someoneElse(browser), access);
		await preview.composer().fill('Hi, I’m Robin');
		await preview.composer().press('Enter');
		access.welcome('guest_1');
		const badge = (viewer: Preview) => viewer.message('Hi, I’m Robin').locator('.ap-role', { hasText: 'welcomed' });
		await expect(badge(preview)).toBeVisible();
		await expect(badge(someone)).toBeVisible();
		await page.getByRole('button', { name: /^Open preferences/ }).click();
		await page.getByRole('dialog', { name: 'Preferences' }).getByRole('button', { name: 'Sign in', exact: true }).click();
		const form = page.getByRole('form', { name: 'Sign in' });
		await form.getByRole('radiogroup', { name: 'Sign in with' }).getByRole('radio', { name: 'Passkey' }).click();
		await form.getByRole('radiogroup', { name: 'Passkey', exact: true }).getByRole('radio', { name: /^Create account/ }).click();
		await page.getByTestId('connect-name-input').fill('Robin');
		await page.getByTestId('passkey-register').click();
		await expect(form).toHaveCount(0);
		expect(access.connections.find((conn) => conn.account?.token === 'grace-token')?.you?.user_id).toBe('grace');
		// The guest is gone, on their page (its new account) and another's (it left): its message keeps no role it had last.
		for (const viewer of [preview, someone]) {
			await expect(viewer.message('Hi, I’m Robin').locator('.ap-msg-handle')).toHaveText('@guest_1');
			await expect(badge(viewer)).toHaveCount(0);
		}
	});

	/** Ada's `command` requests, as the server received them. */
	const commands = (access: MockAccess) => access.sent.filter(({ from, frame }) => from === 'ada' && frame.method === 'command').map(({ frame }) => frame.params);

	test('an admin’s /welcome goes to the server as typed, a user picked from the mention picker named in it, which tells the guest', async ({ page, browser }) => {
		const access = new MockAccess('lobby');
		const guest = await open(await someoneElse(browser), access);
		const admin = await open(page, access, { token: 'admin-token' });
		await admin.openRoom('lobby');
		await admin.composer().click();
		// The server lists `/welcome` and `/lobby` to her (`ext:command_list`), offered as she types, beside the app's own.
		await page.keyboard.type('/');
		const commandPicker = page.getByRole('listbox', { name: 'Command suggestions', exact: true });
		await expect(commandPicker.getByRole('option').filter({ hasText: /^\/welcome/ })).toBeVisible();
		await expect(commandPicker.getByRole('option').filter({ hasText: /^\/lobby/ })).toBeVisible();
		await expect(commandPicker.getByRole('option').filter({ hasText: /^\/invite/ })).toBeVisible();
		await page.keyboard.type('wel');
		await page.keyboard.press('Tab');
		await expect(admin.composer()).toHaveText('/welcome ');
		await page.keyboard.type('@Gue');
		await page.getByTestId('mention-picker').getByRole('option', { name: /Guest 1/ }).click();
		await admin.composer().press('Enter');
		await expect.poll(() => commands(access)).toHaveLength(1);
		const [sent] = commands(access);
		expect(sent).toMatchObject({ room_id: 'lobby', body: { text: expect.stringMatching(/^\/welcome @guest_1\s*$/), mentions: ['guest_1'] } });
		expect(sent.reply_to).toBeUndefined();
		// Not taken for a request of the client's own.
		expect(access.sent.some(({ from, frame }) => from === 'ada' && frame.method === 'room_join')).toBe(false);
		await expect(page.getByTestId('message-list')).toContainText('You welcomed guest_1.');
		await expect(guest.page.getByTestId('message-list')).toContainText('Ada welcomed you. Add a passkey to finish joining');
	});

	test('an admin’s /welcome in reply to a guest’s introduction carries the reply, which names them', async ({ page, browser }) => {
		const access = new MockAccess('lobby');
		const guest = await open(await someoneElse(browser), access);
		await guest.composer().fill('Hi, I’m new here');
		await guest.composer().press('Enter');
		const admin = await open(page, access, { token: 'admin-token' });
		await admin.openRoom('lobby');
		const intro = admin.message('Hi, I’m new here');
		await intro.hover();
		await intro.getByRole('button', { name: 'Reply to message', exact: true }).click();
		// Replying, the commands that use a reply come first: `/welcome` heads the list.
		await page.keyboard.type('/');
		const commandPicker = page.getByRole('listbox', { name: 'Command suggestions', exact: true });
		await expect(commandPicker.getByRole('option').first()).toHaveText(/^\/welcome/);
		await page.keyboard.type('welcome');
		await page.keyboard.press('Enter');
		await expect.poll(() => commands(access)).toHaveLength(1);
		const introId = await intro.getAttribute('data-message-id');
		expect(commands(access)[0]).toMatchObject({ room_id: 'lobby', body: { text: '/welcome' }, reply_to: { message_id: introId } });
		await expect(page.getByTestId('message-list')).toContainText('You welcomed guest_1.');
		await expect(guest.page.getByTestId('message-list')).toContainText('Ada welcomed you.');
		// The server lists it to no one else: a guest isn't offered it.
		await guest.composer().click();
		await guest.page.keyboard.type('/');
		const theirs = guest.page.getByRole('listbox', { name: 'Command suggestions', exact: true });
		await expect(theirs.getByRole('option').first()).toBeVisible();
		await expect(theirs.getByRole('option').filter({ hasText: /^\/welcome/ })).toHaveCount(0);
	});

	test('a waiting account let in sees the rooms the server now shows it, without a reload', async ({ page }) => {
		const access = new MockAccess('lobby');
		access.waiting('wanda', 'wanda-token');
		await open(page, access, { token: 'wanda-token' });
		await expect(rows(page)).toHaveCount(1);
		await expect(page.getByTestId('room-directory')).toHaveCount(0);
		const opened = access.opened;
		access.welcome('wanda');
		await expect(page.getByTestId('message-list')).toContainText('Ada welcomed you in.');
		// General, now visible: under Other Rooms, to read or join.
		const general = page.getByTestId('room-directory').locator('button[data-join="general"]');
		await expect(general).toBeVisible();
		await general.click();
		await expect(page.getByRole('main', { name: 'Conversation' }).getByRole('heading', { level: 1 }).first()).toHaveText('General');
		// On the same connection.
		expect(access.opened).toBe(opened);
	});

	test('a guest the server denies as its lobby closes shows signed out and isn’t signed in again by itself; Sign in offers only the ways in left, and Guest once it reopens', async ({ page, browser }) => {
		const access = new MockAccess('lobby');
		const preview = await open(page, access);
		await expect(preview.message('I’m Nina, here for the meetup')).toBeVisible();
		const guestAuths = () => access.sent.filter(({ frame }) => frame.method === 'auth' && frame.params?.scheme === 'guest').length;
		// Counted by the server: the page's sockets are routed to it, which the page's own `websocket` events don't show.
		const opened = access.opened;
		access.setOpen(false);
		const status = page.getByTestId('connection-status');
		await expect(status).toContainText(MockAccess.CLOSED);
		// Shown as it was, disconnected: nothing catching up, and no composer to type into that sends nothing.
		const signedOut = page.getByRole('note').filter({ hasText: 'You’re signed out, so nothing can be sent here.' });
		await expect(signedOut).toBeVisible();
		await expect(preview.composer()).toHaveCount(0);
		// No reconnect of its own (§1.1, after `denied`), however long it waits, and the server's words stay.
		await page.waitForTimeout(5_000);
		expect(access.opened).toBe(opened);
		await expect(status).toContainText(MockAccess.CLOSED);
		await expect(page.getByText('Checking for new messages…')).toHaveCount(0);

		// Sign in while the lobby is still closed: the connect screen, with only what the server offers now, and no guest sign-in.
		const before = guestAuths();
		await signedOut.getByRole('button', { name: 'Sign in', exact: true }).click();
		const form = page.getByRole('form', { name: 'Sign in' });
		await expect(form).toBeVisible();
		const choices = (where: typeof form) => where.getByRole('radiogroup', { name: 'Sign in with' }).getByRole('radio');
		await expect(choices(form)).toHaveText(['Passkey', 'Token']);
		expect(access.opened).toBe(opened + 1);
		expect(guestAuths()).toBe(before);

		// A newcomer meanwhile gets the same, and nothing of the server behind it.
		const newcomer = await someoneElse(browser);
		await open(newcomer, access, { connected: false });
		const theirs = newcomer.getByRole('form', { name: 'Sign in' });
		await expect(choices(theirs)).toHaveText(['Passkey', 'Token']);
		await expect(newcomer.getByTestId('message-list')).toHaveCount(0);
		await expect(newcomer.getByTestId('room-list')).toHaveCount(0);

		// It opens again: the new `server` frame offers Guest on both screens, and nobody is signed in as one unasked.
		access.setOpen(true);
		await expect(choices(form)).toHaveText(['Guest', 'Passkey', 'Token']);
		await expect(choices(theirs)).toHaveText(['Guest', 'Passkey', 'Token']);
		await newcomer.waitForTimeout(1_000);
		expect(guestAuths()).toBe(before);
		await expect(form).toBeVisible();
		// Chosen, Guest joins.
		await choices(theirs).filter({ hasText: 'Guest' }).click();
		await newcomer.getByTestId('connect').click();
		await expect(newcomer.getByTestId('connection-status')).toHaveText('Connected');
		expect(guestAuths()).toBe(before + 1);
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
