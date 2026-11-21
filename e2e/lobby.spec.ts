import type { Browser, BrowserContext, Page } from '@playwright/test';
import { NOW } from '../scripts/qa/lib/helpers.js';
import { DEVICES, Preview, expect, test } from './fixtures';
import { MockAccess, mockServer } from './mock-server';

/**
 * Access modes (PLAN §9): a server in `lobby` mode, where guests and the accounts they make see only the Public Lobby
 * until an admin or moderator invites them in, which can close its lobby; and one in `private` mode, with no guests.
 * Against `MockAccess`, whose one state serves every page of a test, as a server serves everyone on it.
 */

const SERVER = 'wss://server.apron.chat/';

/** The browser's passkey sheets, answered: the scripted server verifies nothing. */
async function passkeys(context: BrowserContext): Promise<void> {
	await context.addInitScript(() => {
		const bytes = () => new Uint8Array([1, 2, 3]).buffer;
		navigator.credentials.create = async () => ({
			id: 'AQID', rawId: bytes(), type: 'public-key',
			response: { clientDataJSON: bytes(), attestationObject: bytes(), getTransports: () => ['internal'] },
			getClientExtensionResults: () => ({})
		}) as unknown as Credential;
	});
}

/**
 * Someone else, in a browser of their own: one browser connects to a server from one window at a time (Web Locks), so
 * each person on the server needs their own. As the suite's own context is set up.
 */
async function someoneElse(browser: Browser): Promise<Page> {
	const context = await browser.newContext({ viewport: DEVICES.desktop.viewport, locale: 'en-US', timezoneId: 'UTC', reducedMotion: 'reduce' });
	others.push(context);
	return context.newPage();
}

/** The browsers `someoneElse` opened for this test, closed after it. */
const others: BrowserContext[] = [];
test.afterEach(async () => {
	await Promise.all(others.splice(0).map((context) => context.close()));
});

/** Opens the app on `/` against `access`, signed in with a kept session `token` if given, and waits until it is connected. */
async function open(page: Page, access: MockAccess, options: { token?: string; fragment?: string; connected?: boolean } = {}): Promise<Preview> {
	const base = process.env.E2E_URL;
	if (!base) throw new Error('E2E_URL is unset: run through `npm run e2e`.');
	await page.clock.setFixedTime(NOW);
	await mockServer(page, { access });
	if (options.token) {
		const token = options.token;
		await page.addInitScript(([key, value]) => {
			// Once: a reload resumes with whatever the page keeps by then.
			if (!sessionStorage.getItem('e2e.seeded')) {
				localStorage.setItem(key, value);
				sessionStorage.setItem('e2e.seeded', '1');
			}
		}, [`apron.session:${SERVER}`, token] as const);
	}
	await page.goto(`${base}/${options.fragment ?? ''}`);
	if (options.connected !== false) await expect(page.getByTestId('connection-status')).toHaveText('Connected');
	return new Preview(page, {});
}

const banner = (page: Page) => page.getByTestId('lobby-banner');
const roomRows = (page: Page) => page.getByTestId('room-list').locator('button[data-room]');

/** Signs up with a passkey from the lobby's banner: the connect screen, at Passkey's Create account, on this connection. */
async function createPasskey(page: Page, button: string): Promise<void> {
	await banner(page).getByRole('button', { name: button, exact: true }).click();
	const form = page.getByRole('form', { name: 'Sign in' });
	await expect(form).toBeVisible();
	await expect(form.getByRole('radiogroup', { name: 'Passkey', exact: true }).getByRole('radio', { name: /^Create account/ })).toBeChecked();
	await page.getByTestId('passkey-register').click();
	await expect(form).toHaveCount(0);
}

test.describe('a server with a lobby', () => {
	test.use(DEVICES.desktop);

	test('1. a guest sees only the lobby, is told where they are, and posts an intro others see', async ({ page, browser }) => {
		const access = new MockAccess('lobby');
		const preview = await open(page, access);
		await expect(roomRows(page)).toHaveCount(1);
		await expect(roomRows(page)).toHaveAttribute('data-room', 'lobby');
		await expect(preview.heading()).toHaveText('Public Lobby');
		// Told to them by the banner, not marked as public as it is to members.
		await expect(banner(page)).toContainText('You’re in the Public Lobby.');
		await expect(banner(page)).toContainText('Introduce yourself; an admin or moderator can invite you in. Add a passkey to keep your place.');
		await expect(banner(page).getByRole('button', { name: 'Add a passkey', exact: true })).toBeVisible();
		await expect(page.getByRole('img', { name: 'Visible to everyone' })).toHaveCount(0);
		// Another guest's intro, and theirs.
		await expect(preview.message('I’m Nina, here for the meetup')).toBeVisible();
		await preview.composer().fill('Hello, I’m new here');
		await preview.composer().press('Enter');
		await expect(preview.message('Hello, I’m new here')).toBeVisible();
		// Another guest sees the first one's intro.
		const other = await open(await someoneElse(browser), access);
		await expect(other.message('Hello, I’m new here')).toBeVisible();
		await expect(other.message('I’m Nina, here for the meetup')).toBeVisible();
	});

	test('2. an invited guest is asked for a passkey, and joining lists the rest of the server without a reconnect', async ({ page, context }) => {
		await passkeys(context);
		const access = new MockAccess('lobby');
		const opened: string[] = [];
		await open(page, access);
		page.on('websocket', (ws) => opened.push(ws.url()));
		access.invite('guest_1');
		await expect(banner(page)).toContainText('You’ve been invited.');
		await expect(banner(page)).toContainText('Create a passkey to finish joining. Until you do, closing this page ends your visit.');
		await expect(page.getByTestId('message-list')).toContainText('Ada invited you. Add a passkey to finish joining');
		await createPasskey(page, 'Create passkey');
		// A member now: General joined beside the lobby, which is now marked as everyone's to see, and a welcome.
		await expect(roomRows(page)).toHaveCount(2);
		await expect(page.getByTestId('room-list').locator('button[data-room="general"]')).toBeVisible();
		await expect(banner(page)).toHaveCount(0);
		const welcome = page.getByTestId('welcome-banner');
		await expect(welcome).toContainText('Welcome in');
		await expect(page.getByTestId('room-list').locator('button[data-room="lobby"]').getByRole('img', { name: 'Visible to everyone' })).toBeVisible();
		await welcome.getByRole('button', { name: 'Dismiss', exact: true }).click();
		await expect(welcome).toHaveCount(0);
		// On the same connection.
		expect(opened).toEqual([]);
		expect(access.sent.filter(({ frame }) => frame.method === 'auth' && frame.params?.action === 'register' && frame.params?.step === 'finish')).toHaveLength(1);
	});

	test('3. a guest who adds a passkey waits as an account, through a reload, until an invite lets them in', async ({ page, context }) => {
		await passkeys(context);
		const access = new MockAccess('lobby');
		await open(page, access);
		await createPasskey(page, 'Add a passkey');
		// Waiting as an account: no passkey to add now.
		await expect(banner(page)).toContainText('Introduce yourself; an admin or moderator can invite you in.');
		await expect(banner(page)).not.toContainText('passkey');
		await expect(banner(page).getByRole('button')).toHaveCount(0);
		await expect(page.getByTestId('welcome-banner')).toHaveCount(0);
		// A reload resumes the account, still waiting.
		await page.reload();
		await expect(page.getByTestId('connection-status')).toHaveText('Connected');
		await expect(banner(page)).toContainText('Introduce yourself; an admin or moderator can invite you in.');
		await expect(roomRows(page)).toHaveCount(1);
		expect(access.sent.some(({ frame }) => frame.method === 'auth' && frame.params?.scheme === 'token' && frame.params?.token === 'wanda-token')).toBe(true);
		// Let in while connected: in place.
		access.invite('wanda');
		await expect(page.getByTestId('welcome-banner')).toContainText('Welcome in');
		await expect(banner(page)).toHaveCount(0);
		await expect(page.getByTestId('room-list').locator('button[data-room="general"]')).toBeVisible();
	});

	test('4. an invited guest who leaves comes back as a new guest, waiting', async ({ page }) => {
		const access = new MockAccess('lobby');
		await open(page, access);
		access.invite('guest_1');
		await expect(banner(page)).toContainText('You’ve been invited.');
		await page.reload();
		await expect(page.getByTestId('connection-status')).toHaveText('Connected');
		await expect(banner(page)).toContainText('You’re in the Public Lobby.');
		await expect(banner(page)).not.toContainText('invited');
		expect(access.connections.map((conn) => conn.you?.user_id)).toEqual(['guest_2']);
	});

	test('5. a member sees the lobby marked public, and only an admin is offered Invite, which sends /invite', async ({ page, browser }) => {
		const access = new MockAccess('lobby');
		// A guest waiting in the lobby.
		const guest = await open(await someoneElse(browser), access);
		await guest.composer().fill('Hi all');
		await guest.composer().press('Enter');

		// A member who may not invite: the lobby is marked, and no Invite.
		const memberPage = await someoneElse(browser);
		const member = await open(memberPage, access, { token: 'member-token' });
		const lobbyRow = memberPage.getByTestId('room-list').locator('button[data-room="lobby"]');
		await expect(lobbyRow.getByRole('img', { name: 'Visible to everyone' })).toBeVisible();
		await member.openRoom('lobby');
		await expect(member.heading().getByRole('img', { name: 'Visible to everyone' })).toBeVisible();
		await expect(memberPage.locator('.ap-roomhead-everyone')).toHaveText('Visible to everyone');
		await member.message('Hi all').getByRole('button', { name: 'Guest 1' }).first().click();
		await expect(memberPage.getByTestId('profile-card')).toBeVisible();
		await expect(memberPage.getByTestId('profile-card').getByRole('button', { name: 'Invite' })).toHaveCount(0);

		// An admin: Invite on the guest's profile card sends /invite with their user_id.
		const admin = await open(page, access, { token: 'admin-token' });
		await admin.openRoom('lobby');
		await admin.message('Hi all').getByRole('button', { name: 'Guest 1' }).first().click();
		const card = page.getByTestId('profile-card');
		await card.getByRole('button', { name: 'Invite', exact: true }).click();
		await expect(card).toContainText('Invite sent');
		await expect.poll(() => access.sent.filter(({ from, frame }) => from === 'ada' && frame.method === 'command').map(({ frame }) => frame.params.body.text)).toEqual(['/invite guest_1']);
		await expect(page.getByTestId('message-list')).toContainText('You invited guest_1.');
		await expect(banner(guest.page)).toContainText('You’ve been invited.');
		// None for a member: their profile offers no Invite.
		await page.keyboard.press('Escape');
		const list = await admin.showMembers();
		await list.locator('button[data-user-id="guest_9"]').click({ button: 'right' });
		await expect(page.getByRole('menuitem', { name: 'Invite' })).toBeVisible();
		await page.keyboard.press('Escape');
	});

	test('6. closing the lobby ends a guest’s visit, offers newcomers no guest sign-in, and keeps a waiting account', async ({ page, browser }) => {
		const access = new MockAccess('lobby');
		const preview = await open(page, access);
		await expect(preview.message('I’m Nina, here for the meetup')).toBeVisible();
		access.setOpen(false);
		// Told, and signed out: nothing tries to come back as a guest on its own.
		await expect(page.getByTestId('message-list')).toContainText('The Public Lobby is closed.');
		await expect(page.getByTestId('connection-status')).toContainText('The server ended this guest session');
		const sockets = access.sent.filter(({ frame }) => frame.method === 'auth').length;
		await page.waitForTimeout(1_500);
		expect(access.sent.filter(({ frame }) => frame.method === 'auth')).toHaveLength(sockets);

		// A newcomer meanwhile: the connect screen, with no guest choice and nothing of the lobby behind it.
		const newcomer = await someoneElse(browser);
		await open(newcomer, access, { connected: false });
		const form = newcomer.getByRole('form', { name: 'Sign in' });
		await expect(form).toBeVisible();
		await expect(form.getByRole('radiogroup', { name: 'Sign in with' }).getByRole('radio')).toHaveText(['Passkey', 'Token']);
		await expect(newcomer.getByText('Public Lobby')).toHaveCount(0);
		await expect(newcomer.getByTestId('message-list')).toHaveCount(0);

		// A waiting account still signs in, to the lobby, marked as one closed.
		access.accounts.set('wanda-token', { you: { user_id: 'wanda', name: 'Wanda', roles: ['waiting'], ext: { permissions: { lobby: 'waiting' } } }, waiting: true, token: 'wanda-token' });
		const waiting = await someoneElse(browser);
		await open(waiting, access, { token: 'wanda-token' });
		await expect(banner(waiting)).toContainText('You’re in the Public Lobby.');
		await expect(roomRows(waiting)).toHaveCount(1);

		// A member sees it closed, labelled for when it opens again; reopening it says so at once.
		const member = await someoneElse(browser);
		await open(member, access, { token: 'member-token' });
		const lobbyRow = member.getByTestId('room-list').locator('button[data-room="lobby"]');
		await expect(lobbyRow.getByRole('img', { name: 'Public when the lobby is open' })).toBeVisible();
		access.setOpen(true);
		await expect(lobbyRow.getByRole('img', { name: 'Visible to everyone' })).toBeVisible();
		// The guest's page signs in again as a guest once asked to.
		await page.getByRole('main').getByRole('button', { name: 'Sign in', exact: true }).click();
		await expect(page.getByTestId('connection-status')).toHaveText('Connected');
		await expect(banner(page)).toContainText('You’re in the Public Lobby.');
	});
});

test.describe('a private server', () => {
	test.use(DEVICES.desktop);

	test('7. offers only signing in, shows nothing before it, and onboards with an invite link and a nudge to add a passkey', async ({ page }) => {
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
