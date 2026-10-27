import { DEVICES, expect, test, type Preview } from './fixtures';

/**
 * The server's own look and the extensions EXTENSIONS.md defines, in the browser: the server's title and avatar
 * beside its address (§3.1, §1), `ext:permissions` and `ext:settings` in their current shapes, custom emoji
 * (`ext:emoji`) in text, reactions and the pickers, reaction keys and U+FE0F (§4.7), and text direction (§3.5.2).
 */

// 2×2 PNGs: red is the animated image, blue its still copy, green an avatar.
const RED = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEElEQVR4nGP4z8AARAwQCgAf7gP9i18U1AAAAABJRU5ErkJggg==';
const BLUE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAD0lEQVR4nGNgYPgPRmAKABf2A/1+6zfzAAAAAElFTkSuQmCC';
const GREEN = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAD0lEQVR4nGNgWMAAQhAKABGOAoEf3CQEAAAAAElFTkSuQmCC';

const CATALOG = {
	':partyparrot:': { url: RED, static_url: BLUE, category: 'Parrots', tags: ['celebrate'] },
	':wide:': { url: RED, width: 64, height: 32, alt: 'A wide one' },
	':secret:': { url: RED, hidden: true }
};
const EMOJI = { capabilities: ['ext:emoji'], server: { ext: { emoji: { catalog_url: `data:application/json,${encodeURIComponent(JSON.stringify(CATALOG))}` } } } };
const WELCOME = '1710000000001';

test.use(DEVICES.desktop);

/** A message's toolbar button, shown on hover. */
async function action(preview: Preview, id: string, name: string): Promise<void> {
	const message = preview.page.locator(`article[data-message-id="${id}"]`);
	const button = message.getByRole('button', { name, exact: true });
	await expect(async () => {
		await message.hover();
		await expect(button).toBeVisible({ timeout: 1000 });
	}).toPass();
	await button.click();
}

test.describe('the server frame: title, description and avatar (§3.1), and the address (§1)', () => {
	test('shows the title and avatar, always with the address, and keeps one recent entry per address', async ({ preview, page }) => {
		// Saved before addresses were normalized: two entries for this server, and another server with the same title.
		await page.addInitScript(() => {
			if (sessionStorage.getItem('seeded')) return;
			sessionStorage.setItem('seeded', '1');
			localStorage.setItem('apron.recentServers', JSON.stringify([
				{ url: 'WSS://Server.Apron.Chat:443', label: 'server.apron.chat' },
				{ url: 'wss://server.apron.chat/', title: 'Old title' },
				{ url: 'wss://evil.example/', title: 'Mock Chat' }
			]));
		});
		await preview.openRoot({ server: { title: 'Mock Chat', description: 'Where **tests** talk.', avatar: GREEN } });
		await expect(page.locator('.ap-shell-sidehead-name')).toHaveText('Mock Chat');
		await expect(page.locator('.ap-shell-sidehead-name')).toHaveAttribute('title', 'wss://server.apron.chat/');
		await expect(page.locator('img.ap-shell-sidehead-avatar')).toHaveAttribute('src', GREEN);

		await page.getByRole('button', { name: 'Connection settings', exact: true }).click();
		const server = page.getByTestId('connect-server');
		await expect(server).toContainText('Mock Chat');
		await expect(server.locator('.ap-connect-address')).toHaveText('wss://server.apron.chat/');
		await expect(server.locator('img')).toHaveAttribute('src', GREEN);
		await expect(page.locator('.ap-connect-server-desc strong')).toHaveText('tests');
		// Recent: this server once, by its address, with the title it sent last; the copycat with its own address.
		const recent = page.getByRole('group', { name: 'Recent backends' }).getByRole('button');
		await expect(recent).toHaveCount(2);
		await expect(recent.nth(0)).toContainText('Mock Chat');
		await expect(recent.nth(0).locator('.ap-connect-address')).toHaveText('wss://server.apron.chat/');
		await expect(recent.nth(1)).toContainText('Mock Chat');
		await expect(recent.nth(1).locator('.ap-connect-address')).toHaveText('wss://evil.example/');
	});

	test('without a title, names the server by its host', async ({ preview, page }) => {
		await preview.openRoot();
		await expect(page.locator('.ap-shell-sidehead-name')).toHaveText('server.apron.chat');
		await page.getByRole('button', { name: 'Connection settings', exact: true }).click();
		await expect(page.getByTestId('connect-server')).toContainText('server.apron.chat');
		await expect(page.getByTestId('connect-server').locator('.ap-connect-address')).toHaveText('wss://server.apron.chat/');
	});
});

test.describe('ext:permissions and ext:settings', () => {
	test.describe('a guest who may not write', () => {
		test.use({ knobs: { seed: 'rich', permissions: { write: false } } });

		test('reads, with sign-in offered in place of the composer, and no reactions or joins', async ({ preview, page }) => {
			await preview.open();
			const bar = page.locator('.ap-composer-readonly');
			await expect(bar).toContainText('You’re reading as a guest');
			await expect(bar.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
			await expect(preview.composer()).toHaveCount(0);
			const welcome = page.locator(`article[data-message-id="${WELCOME}"]`);
			await welcome.hover();
			await expect(welcome.getByRole('button', { name: 'React', exact: true })).toHaveCount(0);
			await expect(page.getByRole('button', { name: 'Add member', exact: true })).toHaveCount(0);
			// Browse rooms opens a room to read rather than joining it.
			await page.getByTestId('browse-rooms').click();
			await expect(page.getByTestId('room-directory')).toContainText('Design reviews');
			await expect(page.getByTestId('room-directory').getByRole('button', { name: /^Join/ })).toHaveCount(0);
		});
	});

	test.describe('an account that may not write', () => {
		test.use({ knobs: { account: true, permissions: { write: false } } });

		test('reads, and isn\'t offered a sign-in it already has', async ({ preview, page }) => {
			await preview.open();
			const bar = page.locator('.ap-composer-readonly');
			await expect(bar).toContainText('doesn’t let you post');
			await expect(bar.getByRole('button', { name: 'Sign in', exact: true })).toHaveCount(0);
		});
	});

	test.describe('without add_members', () => {
		test.use({ knobs: { permissions: {} } });

		test('adds people only to a private room you are in', async ({ preview, page }) => {
			await preview.open('#room=private_1710000000060');
			await preview.showMembers();
			await expect(page.getByRole('button', { name: 'Add member', exact: true })).toBeVisible();
			await preview.openRoom('engineering');
			await preview.showMembers();
			await expect(page.getByRole('button', { name: 'Add member', exact: true })).toHaveCount(0);
		});
	});

	test.describe('permissions of the wrong type, the old list', () => {
		test.use({ knobs: { permissions: ['write', 'add_members'] as never } });

		test('take every default: you write, and add people only to private rooms', async ({ preview, page }) => {
			await preview.open('#room=engineering');
			await expect(preview.composer()).toBeVisible();
			await preview.showMembers();
			await expect(page.getByRole('button', { name: 'Add member', exact: true })).toHaveCount(0);
		});
	});

	test.describe('settings that no longer exist', () => {
		test.use({ knobs: { server: { ext: { settings: { guest_posting: false, add_members: false, read_cursors: false } } } } });

		test('mean nothing: a guest still writes, and add_members comes from permissions', async ({ preview, page }) => {
			await preview.open('#room=engineering');
			await expect(preview.composer()).toBeVisible();
			await preview.showMembers();
			await expect(page.getByRole('button', { name: 'Add member', exact: true })).toBeVisible();
		});
	});
});

test.describe('custom emoji (ext:emoji) and reaction keys (§4.7)', () => {
	test.use({ knobs: EMOJI });

	test('render in text as their images, scanned left to right, never in code', async ({ preview, page }) => {
		await preview.open();
		await preview.post('general', 'ada', 'Shipped :partyparrot: at 12:30:wide: and `:partyparrot:`, but :nope:');
		const message = preview.message('Shipped');
		const parrot = message.locator('.ap-msg-text img.ap-cemoji[alt=":partyparrot:"]');
		await expect(parrot).toHaveCount(1);
		// The browser suite prefers reduced motion: the still copy shows.
		await expect(parrot).toHaveAttribute('src', BLUE);
		const wide = message.locator('img.ap-cemoji[alt="A wide one"]');
		await expect(wide).toHaveAttribute('style', 'aspect-ratio: 64 / 32');
		await expect(wide).toHaveAttribute('title', 'A wide one');
		await expect(message.locator('.ap-msg-text')).toContainText('12:30');
		await expect(message.locator('code')).toHaveText(':partyparrot:');
		await expect(message.locator('.ap-msg-text')).toContainText(':nope:');
		// The image is taller than nothing, and no taller than its line.
		const box = await parrot.boundingBox();
		expect(box!.height).toBeGreaterThan(10);
		expect(box!.height).toBeLessThan(40);
		await expect(page.locator('img.ap-cemoji[alt=":secret:"]')).toHaveCount(0);
	});

	test('show in reactions as images or placeholders, entries differing only in U+FE0F as one, each toggled as written', async ({ preview, page }) => {
		await preview.open();
		await preview.reactAs('grace', WELCOME, [':partyparrot:', ':unknown:', '❤']);
		await preview.reactAs('linus', WELCOME, ['❤️']);
		const welcome = page.locator(`article[data-message-id="${WELCOME}"]`);
		const chips = welcome.getByTestId('reaction-chip');
		await expect(chips).toHaveCount(3);
		const heart = welcome.locator('[data-testid="reaction-chip"][data-emoji="❤️"]');
		await expect(heart).toContainText('2');
		const parrot = welcome.locator('[data-testid="reaction-chip"][data-emoji=":partyparrot:"]');
		await expect(parrot.locator('img.ap-cemoji')).toHaveAttribute('src', BLUE);
		await expect(parrot).toHaveAttribute('title', /reacted with :partyparrot:$/);
		const unknown = welcome.locator('[data-testid="reaction-chip"][data-emoji=":unknown:"]');
		await expect(unknown.locator('.ap-rchip-placeholder')).toBeVisible();
		await expect(unknown).toHaveAttribute('title', /reacted with :unknown:$/);
		// Tapping the placeholder reacts with that same key; the heart with its fully-qualified form.
		await unknown.click();
		await preview.waitForSent('reactions', (p) => p.message_id === WELCOME && p.emojis.includes(':unknown:'));
		await heart.click();
		await preview.waitForSent('reactions', (p) => p.message_id === WELCOME && p.emojis.includes('❤️'));
		await expect(heart).toContainText('3');
	});

	test('are offered in the picker, without hidden ones, and a pick reacts with the key', async ({ preview, page }) => {
		await preview.open();
		await action(preview, WELCOME, 'React');
		const picker = page.getByRole('dialog', { name: 'Emoji picker', exact: true });
		await expect(picker).toHaveAttribute('data-state', 'ready');
		const search = picker.locator('em-emoji-picker input[type="search"]');
		await search.fill('secret');
		await expect(picker.getByRole('button', { name: ':secret:', exact: true })).toHaveCount(0);
		await search.fill('celebrate');
		await picker.getByRole('button', { name: ':partyparrot:', exact: true }).first().click();
		await preview.waitForSent('reactions', (p) => p.message_id === WELCOME && p.emojis.length === 1 && p.emojis[0] === ':partyparrot:');
		await expect(page.locator(`article[data-message-id="${WELCOME}"] [data-testid="reaction-chip"][data-emoji=":partyparrot:"] img`)).toBeVisible();
	});

	test('are offered first by the composer\'s :shortcode list, which inserts the key', async ({ preview, page }) => {
		await preview.open();
		await preview.composer().click();
		await page.keyboard.type(':part');
		const list = page.getByRole('listbox', { name: 'Emoji suggestions' });
		await expect(list.getByRole('option').first()).toContainText(':partyparrot:');
		await expect(list.getByRole('option').first().locator('img.ap-cemoji')).toBeVisible();
		await page.keyboard.press('Tab');
		await expect(preview.composer()).toContainText(':partyparrot:');
	});
});

test.describe('without ext:emoji', () => {
	test('a key in a reaction is a placeholder, and in text stays text', async ({ preview, page }) => {
		await preview.open();
		await preview.post('general', 'ada', 'Shipped :partyparrot:');
		await expect(preview.message('Shipped :partyparrot:').locator('img')).toHaveCount(0);
		await preview.reactAs('grace', WELCOME, [':partyparrot:']);
		const chip = page.locator(`article[data-message-id="${WELCOME}"] [data-testid="reaction-chip"][data-emoji=":partyparrot:"]`);
		await expect(chip.locator('.ap-rchip-placeholder')).toBeVisible();
	});
});

test.describe('text direction (§3.5.2)', () => {
	test('drops bidi overrides from what users write, and isolates names from the words around them', async ({ preview, page }) => {
		await preview.open();
		await preview.post('general', 'ada', 'See evil‮gnp.exe', { from: { user_id: 'mallory', name: 'Mal‮lory' } });
		const message = preview.message('See evilgnp.exe');
		await expect(message).toBeVisible();
		const sender = message.locator('.ap-msg-sender');
		await expect(sender).toHaveText('Mallory');
		expect(await message.innerText()).not.toMatch(/[‪-‮]/);
		expect(await sender.evaluate((element) => getComputedStyle(element).unicodeBidi)).toBe('plaintext');
		expect(await message.locator('.ap-msg-text p').evaluate((element) => getComputedStyle(element).unicodeBidi)).toBe('plaintext');
	});
});
