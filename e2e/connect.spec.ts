import { DEVICES, expect, test, type Preview } from './fixtures';

/**
 * The rooms list's head, which shows the server you're on and opens the server pane: what is known of it, New
 * server… (the way to the connect screen) and Disconnect, for a guest and an account, on a desktop and a phone
 * (§3.1, §1).
 */

// A 2×2 green PNG, the server's avatar.
const GREEN = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAD0lEQVR4nGNgWMAAQhAKABGOAoEf3CQEAAAAAElFTkSuQmCC';
const LONG = 'Northwind Operations & Site Reliability (EU + US)';

const head = (preview: Preview) => preview.page.locator('.ap-shell-sidehead');

test.describe('the rooms list’s head', () => {
	test.use(DEVICES.desktop);

	test('shows the server’s avatar and title over its host, its address the tooltip, and opens the server pane', async ({ preview }) => {
		await preview.openRoot({ server: { title: 'Mock Chat', avatar: GREEN } });
		const avatar = head(preview).locator('img.ap-shell-sidehead-avatar');
		await expect(avatar).toHaveAttribute('src', GREEN);
		expect(await avatar.boundingBox()).toMatchObject({ width: 32, height: 32 });
		await expect(head(preview).locator('.ap-shell-sidehead-name')).toHaveText('Mock Chat');
		await expect(head(preview).locator('.ap-shell-sidehead-name')).toHaveCSS('font-weight', '600');
		const host = head(preview).locator('.ap-shell-sidehead-host');
		await expect(host).toHaveText('server.apron.chat');
		// Left to right, whatever the title's direction.
		await expect(host).toHaveCSS('direction', 'ltr');
		await expect(host).toHaveCSS('unicode-bidi', 'isolate');
		await expect(head(preview).locator('.ap-shell-sidehead-server')).toHaveAttribute('title', 'wss://server.apron.chat/');
		await expect(head(preview).getByRole('button')).toHaveCount(1);
		await expect(head(preview).getByRole('button', { name: /^Server: / })).toHaveAttribute('aria-expanded', 'false');
		await expect(preview.page.getByRole('button', { name: 'Connection settings' })).toHaveCount(0);
	});

	test('without a title or avatar: the host’s initials, and the host on one line', async ({ preview }) => {
		await preview.openRoot();
		const initials = head(preview).locator('.ap-shell-sidehead-initials');
		await expect(initials).toHaveText('S');
		expect(await initials.boundingBox()).toMatchObject({ width: 32, height: 32 });
		await expect(head(preview).locator('img')).toHaveCount(0);
		await expect(head(preview).locator('.ap-shell-sidehead-name')).toHaveText('server.apron.chat');
		await expect(head(preview).locator('.ap-shell-sidehead-host')).toHaveCount(0);
	});

	test('cuts a long title short with an ellipsis, keeping the host and the head’s height', async ({ preview }) => {
		await preview.openRoot({ server: { title: LONG, avatar: GREEN } });
		const name = head(preview).locator('.ap-shell-sidehead-name');
		await expect(name).toHaveText(LONG);
		await expect(name).toHaveCSS('text-overflow', 'ellipsis');
		expect(await name.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
		await expect(head(preview).locator('.ap-shell-sidehead-host')).toBeVisible();
		expect((await head(preview).boundingBox())?.height).toBe(48);
		const side = (await preview.page.locator('.ap-shell-side').boundingBox())!;
		const box = (await name.boundingBox())!;
		expect(box.x + box.width).toBeLessThanOrEqual(side.x + side.width);
	});
});

test.describe('the server pane', () => {
	test.use(DEVICES.desktop);

	test('says what is known of the server, and Connect to another server… opens the connect screen, closing it', async ({ preview, page }) => {
		await preview.openRoot({ server: { title: 'Mock Chat', description: 'Where the **mock** team chats.' } });
		const server = head(preview).getByRole('button', { name: /^Server: / });
		await server.click();
		const pane = page.getByTestId('server-pane');
		await expect(pane).toBeFocused();
		await expect(server).toHaveAttribute('aria-expanded', 'true');
		await expect(pane.locator('.ap-servcard-name')).toHaveText('Mock Chat');
		await expect(pane.locator('.ap-servcard-description strong')).toHaveText('mock');
		await expect(pane.locator('.ap-servcard-address')).toHaveText('wss://server.apron.chat/');
		await expect(pane.locator('.ap-servcard-state')).toContainText('Connected');
		await expect(pane.locator('.ap-servcard-dot-ok')).toBeVisible();
		await expect(pane.locator('.ap-servcard-you')).toHaveText(/^Signed in as .+ \(guest\)\s*·\s*Edit profile$/);
		// The address, and a button that copies it.
		await expect(pane.getByRole('button', { name: 'Copy the address' })).toBeVisible();
		await pane.getByRole('button', { name: 'Connect to another server…', exact: true }).click();
		await expect(page.getByRole('form', { name: 'Sign in' })).toBeVisible();
		await expect(page.getByTestId('connect-server')).toContainText('Mock Chat');
		await expect(pane).toHaveCount(0);
		// Cancel goes back to the chat as it was.
		await page.getByRole('form', { name: 'Sign in' }).getByRole('button', { name: 'Cancel', exact: true }).click();
		await expect(page.getByTestId('connection-status')).toHaveText('Connected');
	});

	test('Edit profile opens Preferences at Profile', async ({ preview, page }) => {
		await preview.openRoot({ token: 'account-session' });
		await head(preview).getByRole('button', { name: /^Server: / }).click();
		await page.getByTestId('server-pane').getByRole('button', { name: 'Edit profile', exact: true }).click();
		await expect(page.getByTestId('server-pane')).toHaveCount(0);
		await expect(page.getByRole('dialog', { name: 'Preferences' }).getByTestId('display-name-input')).toBeVisible();
	});

	test('a guest gets Sign in in Profile, opening the connect screen, on a server signing in no other way here', async ({ preview, page }) => {
		// A guest's own sign-in methods (`auth`) offer nothing to add, yet the server signs up with a passkey.
		await preview.openRoot({ server: { auth: ['guest'], signup: ['guest', 'webauthn'] } });
		await page.getByRole('button', { name: /^Open preferences/ }).click();
		const preferences = page.getByRole('dialog', { name: 'Preferences' });
		await expect(preferences).toContainText('You’re a guest here. Sign in to keep your name and rooms.');
		await expect(preferences.getByRole('button', { name: /^Add / })).toHaveCount(0);
		await preferences.getByRole('button', { name: 'Sign in', exact: true }).click();
		await expect(preferences).toHaveCount(0);
		await expect(page.getByRole('form', { name: 'Sign in' })).toBeVisible();
	});

	test('Enter in an unchanged Display name sends nothing, and a changed one saves', async ({ preview, page }) => {
		const sent: Record<string, any>[] = [];
		await preview.openRoot({ token: 'account-session', sent });
		await page.getByRole('button', { name: /^Open preferences/ }).click();
		const preferences = page.getByRole('dialog', { name: 'Preferences' });
		const name = preferences.getByTestId('display-name-input');
		await name.press('Enter');
		await expect(preferences.getByRole('button', { name: 'Save', exact: true })).toHaveCount(0);
		await expect(preferences.getByText('Saved.', { exact: true })).toHaveCount(0);
		expect(sent.filter((frame) => frame.method === 'me')).toEqual([]);
		await name.fill('Ada L');
		await name.press('Enter');
		await expect(preferences.getByText('Saved.', { exact: true })).toBeVisible();
		expect(sent.filter((frame) => frame.method === 'me').map((frame) => frame.params)).toEqual([{ name: 'Ada L' }]);
	});

	test('Sign out in Profile shows the guest’s own name and bio, and focus moves to Sign in', async ({ preview, page }) => {
		await preview.openRoot({
			token: 'account-session',
			you: { user_id: 'lovelace', name: 'Ada', ext: { bio: 'Writes the engines.' } },
			server: { capabilities: ['history', 'rooms', 'status', 'ext:bio'] }
		});
		await page.getByRole('button', { name: /^Open preferences/ }).click();
		const preferences = page.getByRole('dialog', { name: 'Preferences' });
		const bio = preferences.getByRole('textbox', { name: 'Bio' });
		await expect(bio).toHaveValue('Writes the engines.');
		// Keep local history is checked: Sign out keeps it, asking nothing.
		await expect(preferences.getByTestId('keep-history')).toBeChecked();
		page.on('dialog', () => { throw new Error('Sign out asked, keeping history'); });
		await preferences.getByRole('button', { name: 'Sign out', exact: true }).click();
		await expect(preferences).toContainText('Signed out.');
		await expect(preferences.getByTestId('display-name-input')).toHaveValue('Guest 2');
		await expect(bio).toHaveValue('');
		await expect(preferences.getByRole('button', { name: 'Sign in', exact: true })).toBeFocused();
	});

	test('Sign out without Keep local history asks first, and declined stays signed in', async ({ preview, page }) => {
		await preview.openRoot({ token: 'account-session', you: { user_id: 'lovelace', name: 'Ada' } });
		await page.getByRole('button', { name: /^Open preferences/ }).click();
		const preferences = page.getByRole('dialog', { name: 'Preferences' });
		await preferences.getByTestId('keep-history').uncheck();
		let asked = '';
		page.once('dialog', (dialog) => { asked = dialog.message(); void dialog.dismiss(); });
		await preferences.getByRole('button', { name: 'Sign out', exact: true }).click();
		await expect.poll(() => asked).toBe('Signing out deletes local history. Continue?');
		await expect(preferences.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible();
		await expect(preferences.getByTestId('display-name-input')).toHaveValue('Ada');
		await expect(preferences).not.toContainText('Signed out');
		page.once('dialog', (dialog) => void dialog.accept());
		await preferences.getByRole('button', { name: 'Sign out', exact: true }).click();
		await expect(preferences).toContainText('Signed out, and this account’s local history deleted.');
	});

	test('opens and closes from the keyboard, Escape giving focus back', async ({ preview, page }) => {
		await preview.openRoot({ token: 'account-session' });
		const server = head(preview).getByRole('button', { name: /^Server: / });
		await server.focus();
		await page.keyboard.press('Enter');
		const pane = page.getByTestId('server-pane');
		await expect(pane).toBeFocused();
		await page.keyboard.press('Escape');
		await expect(pane).toHaveCount(0);
		await expect(server).toBeFocused();
	});

	test('Disconnect closes the connection, and the connect screen is the way back', async ({ preview, page }) => {
		await preview.openRoot({ server: { title: 'Mock Chat' } });
		await head(preview).getByRole('button', { name: /^Server: / }).click();
		await page.getByTestId('server-pane').getByRole('button', { name: 'Disconnect', exact: true }).click();
		const form = page.getByRole('form', { name: 'Sign in' });
		await expect(form).toBeVisible();
		// Nothing to cancel back to: the connection is closed, and stays closed.
		await expect(form.getByRole('button', { name: 'Cancel', exact: true })).toHaveCount(0);
		await expect(page.getByTestId('server-url-input')).toHaveValue('wss://server.apron.chat/');
		// Connecting again opens it, and the chat comes back.
		await form.getByRole('button', { name: /^(Connect|Done|Continue as guest)$/ }).first().click();
		await expect(page.getByTestId('connection-status')).toHaveText('Connected');
		await expect(form).toHaveCount(0);
	});
});

test.describe('on a phone', () => {
	test.use(DEVICES.phone);

	test('the head keeps the › back beside the server, and the server pane reaches the connect screen', async ({ preview, page }) => {
		await preview.openRoot({ server: { title: LONG, avatar: GREEN } });
		await preview.openRoom('general');
		await preview.roomsPane();
		const back = head(preview).getByRole('button', { name: 'Back to General', exact: true });
		await expect(back).toBeVisible();
		const name = (await head(preview).locator('.ap-shell-sidehead-name').boundingBox())!;
		const backBox = (await back.boundingBox())!;
		expect(name.x + name.width).toBeLessThanOrEqual(backBox.x);
		await expect(head(preview).locator('.ap-shell-sidehead-host')).toHaveText('server.apron.chat');
		await preview.openConnect();
		await expect(page.getByTestId('connect-server')).toContainText(LONG);
	});
});
