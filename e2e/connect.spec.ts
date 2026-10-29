import { DEVICES, expect, test, type Preview } from './fixtures';

/**
 * The rooms list's head, which shows the server you're on and is no control, and the way to the connect screen,
 * the profile's Connect to a server…, for a guest and an account, on a desktop and a phone (§3.1, §1).
 */

// A 2×2 green PNG, the server's avatar.
const GREEN = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAD0lEQVR4nGNgWMAAQhAKABGOAoEf3CQEAAAAAElFTkSuQmCC';
const LONG = 'Northwind Operations & Site Reliability (EU + US)';

const head = (preview: Preview) => preview.page.locator('.ap-shell-sidehead');

test.describe('the rooms list’s head', () => {
	test.use(DEVICES.desktop);

	test('shows the server’s avatar and title over its host, its address the tooltip, and nothing to press', async ({ preview }) => {
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
		await expect(head(preview).getByRole('button')).toHaveCount(0);
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

test.describe('Connect to a server…, in the profile', () => {
	test.use(DEVICES.desktop);

	test('opens the connect screen for a guest, closing the profile', async ({ preview, page }) => {
		await preview.openRoot({ server: { title: 'Mock Chat' } });
		await page.getByRole('button', { name: /^Your profile on/ }).click();
		const profile = page.getByRole('dialog', { name: 'Edit profile', exact: true });
		await expect(profile.getByText('Signed in as a guest')).toBeVisible();
		const connect = profile.getByRole('group', { name: 'Server' }).getByRole('button', { name: 'Connect to a server…', exact: true });
		await connect.click();
		await expect(page.getByRole('form', { name: 'Sign in' })).toBeVisible();
		await expect(page.getByTestId('connect-server')).toContainText('Mock Chat');
		await expect(profile).toHaveCount(0);
		// Cancel goes back to the chat as it was.
		await page.getByRole('form', { name: 'Sign in' }).getByRole('button', { name: 'Cancel', exact: true }).click();
		await expect(page.getByTestId('connection-status')).toHaveText('Connected');
	});

	test('opens it for an account too, from the keyboard', async ({ preview, page }) => {
		await preview.openRoot({ token: 'account-session' });
		await page.getByRole('button', { name: /^Your profile on/ }).focus();
		await page.keyboard.press('Enter');
		const profile = page.getByRole('dialog', { name: 'Edit profile', exact: true });
		await expect(profile.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible();
		const connect = profile.getByRole('button', { name: 'Connect to a server…', exact: true });
		await connect.focus();
		await expect(connect).toBeFocused();
		await page.keyboard.press('Enter');
		await expect(page.getByRole('form', { name: 'Sign in' })).toBeVisible();
		await expect(page.getByTestId('server-url-input')).toHaveValue('wss://server.apron.chat/');
	});
});

test.describe('on a phone', () => {
	test.use(DEVICES.phone);

	test('the head keeps the › back beside the server, and the profile reaches the connect screen', async ({ preview, page }) => {
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
