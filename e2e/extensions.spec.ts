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

/** Picks a message (shift-click) and asks to move it to a new thread from the selection bar. */
async function pickAndMoveToNewThread(preview: Preview, id: string): Promise<void> {
	await preview.page.locator(`article[data-message-id="${id}"]`).click({ modifiers: ['Shift'] });
	const bar = preview.page.getByTestId('selection-bar');
	await expect(bar).toContainText('1 message selected');
	await bar.getByRole('button', { name: 'Move to thread ▾', exact: true }).click();
	await preview.page.getByTestId('new-thread').click();
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
		await expect(page.locator('.ap-shell-sidehead-host')).toHaveText('server.apron.chat');
		await expect(page.locator('.ap-shell-sidehead-server')).toHaveAttribute('title', 'wss://server.apron.chat/');
		await expect(page.locator('img.ap-shell-sidehead-avatar')).toHaveAttribute('src', GREEN);

		await preview.openConnect();
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
		// Its host once, beside its initials.
		await expect(page.locator('.ap-shell-sidehead-host')).toHaveCount(0);
		await expect(page.locator('.ap-shell-sidehead-initials')).toHaveText('S');
		await preview.openConnect();
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
			// Other Rooms, open from the start, opens a room to read rather than joining it, so it says no Join.
			await expect(page.getByTestId('room-directory')).toContainText('Design reviews');
			await expect(page.getByTestId('room-directory').getByRole('button', { name: /^Join/ })).toHaveCount(0);
			for (const topic of await page.getByTestId('room-directory').locator('.ap-room-topic').allTextContents()) expect(topic).not.toMatch(/Join|Open/);
		});

		test('reads the messages of a room it hasn’t joined, opened by its link', async ({ preview, page }) => {
			await preview.open();
			await preview.post('design', 'ada', 'The new palette is up for review.');
			await page.evaluate(() => { location.hash = '#room=design'; });
			await expect(preview.message('The new palette is up for review.')).toBeVisible();
			expect((await preview.sent('room_join')).filter((p) => p.room_id === 'design')).toEqual([]);
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

		test('adds people only to a private room you are in, and moves only your own messages', async ({ preview, page }) => {
			await preview.open('#room=private_1710000000060');
			await preview.showMembers();
			await expect(page.getByRole('button', { name: 'Add member', exact: true })).toBeVisible();
			await preview.openRoom('engineering');
			await preview.showMembers();
			await expect(page.getByRole('button', { name: 'Add member', exact: true })).toHaveCount(0);
			await preview.openRoom('general');
			await pickAndMoveToNewThread(preview, WELCOME);
			await expect(page.getByText('You can only move your own messages, so none were moved')).toBeVisible();
		});
	});

	test.describe('with add_members and move_any', () => {
		test.use({ knobs: { permissions: { add_members: true, move_any: true } } });

		test('adds people in any room, and moves anyone\'s messages', async ({ preview, page }) => {
			await preview.open('#room=engineering');
			await preview.showMembers();
			await expect(page.getByRole('button', { name: 'Add member', exact: true })).toBeVisible();
			await preview.openRoom('general');
			await pickAndMoveToNewThread(preview, WELCOME);
			await expect(page.getByRole('dialog', { name: 'Move to a new thread', exact: true })).toBeVisible();
		});
	});

	test.describe('without the extension', () => {
		// you.ext.permissions means nothing where the server doesn't advertise ext:permissions.
		test.use({ knobs: { withoutCapabilities: ['ext:permissions'], permissions: { write: false, add_members: false, move_any: true } } });

		test('offers what PROTOCOL.md allows: writing, adding people in any room, and moving only your own', async ({ preview, page }) => {
			await preview.open('#room=private_1710000000060');
			await preview.showMembers();
			await expect(page.getByRole('button', { name: 'Add member', exact: true })).toBeVisible();
			await preview.openRoom('engineering');
			await expect(preview.composer()).toBeVisible();
			await preview.showMembers();
			await expect(page.getByRole('button', { name: 'Add member', exact: true })).toBeVisible();
			await preview.openRoom('general');
			await pickAndMoveToNewThread(preview, WELCOME);
			await expect(page.getByText('You can only move your own messages, so none were moved')).toBeVisible();
			await expect(page.getByRole('dialog', { name: 'Move to a new thread', exact: true })).toHaveCount(0);
		});
	});

	test.describe('without the extension, on a server that refuses', () => {
		test.use({ knobs: { withoutCapabilities: ['ext:permissions'], denyAdding: true } });

		test('shows why an add was denied, and keeps offering it', async ({ preview, page }) => {
			await preview.open('#room=engineering');
			await preview.showMembers();
			await page.getByRole('button', { name: 'Add member', exact: true }).click();
			const dialog = page.getByRole('dialog', { name: 'Add people to engineering' });
			await dialog.getByRole('combobox', { name: 'Add', exact: true }).fill('grace');
			await page.keyboard.press('Enter');
			await dialog.getByRole('button', { name: /^Add Grace/ }).click();
			await expect(dialog.getByRole('alert')).toContainText('Only moderators add people here');
			await page.keyboard.press('Escape');
			await expect(page.getByRole('button', { name: 'Add member', exact: true })).toBeVisible();
			await expect(page.getByRole('complementary', { name: 'Room member list' }).locator('li.ap-member[data-user="grace"]')).toHaveCount(0);
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

/**
 * Every bidi embedding or override (U+202A–U+202E) the page shows, as text or in an attribute, outside the editors:
 * what users write is shown without them (§3.5.2), and an editor holds it as written.
 */
function overridesShown(page: Preview['page']): Promise<string[]> {
	return page.evaluate(() => {
		const bidi = /[‪-‮]/;
		const found: string[] = [];
		if (bidi.test(document.title)) found.push(`<title> ${document.title}`);
		for (const element of document.body.querySelectorAll('*')) {
			if (element.closest('textarea, input, [contenteditable="true"]')) continue;
			for (const attribute of element.attributes) if (bidi.test(attribute.value)) found.push(`${element.tagName}[${attribute.name}] ${attribute.value}`);
			for (const node of element.childNodes) if (node.nodeType === Node.TEXT_NODE && bidi.test(node.nodeValue ?? '')) found.push(`${element.tagName}.${element.className} ${node.nodeValue}`);
		}
		return found;
	});
}

const RLO = '‮';

test.describe('text direction (§3.5.2)', () => {
	test.use({
		knobs: {
			server: { title: `Mock${RLO} Chat`, description: `Where${RLO} we talk.` },
			people: { ada: { name: `Ada${RLO} Lovelace`, roles: [`ad${RLO}min`], ext: { bio: `Writes${RLO} programs` } } },
			rooms: { engineering: { title: `engi${RLO}neering`, description: `About${RLO} builds` }, thread_deploy: { title: `Deploy${RLO} checklist`, description: `Before${RLO} a deploy` } }
		}
	});

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

	test('shows none anywhere: names, roles, bios, titles, descriptions, messages, replies, embeds and the server', async ({ preview, page }) => {
		await preview.open();
		const posted = await preview.post('general', 'ada', {
			text: `Shipped${RLO} it`, format: 'markdown',
			embeds: [{ kind: 'link', url: 'https://example.com/', og: { title: `Release${RLO} notes`, description: `What${RLO} changed`, site_name: `Exa${RLO}mple` } }]
		});
		await preview.post('general', 'grace', `Nice${RLO} work`, { reply_to: { message_id: posted } });
		await preview.reactAs('ada', WELCOME, ['👍']);
		await expect(page.locator(`article[data-message-id="${posted}"]`)).toContainText('Release notes');
		await expect(page.locator('.ap-reply-text').filter({ hasText: 'Shipped it' })).toBeVisible();
		await expect(page.locator('.ap-shell-sidehead-name')).toHaveText('Mock Chat');
		await preview.showMembers();
		await expect(page.getByTestId('room-member-list')).toContainText('Ada Lovelace');
		expect(await overridesShown(page)).toEqual([]);

		// Ada's profile card: her name, role and bio.
		await page.getByTestId('message-list').getByRole('button', { name: 'Ada Lovelace', exact: true }).first().click();
		const card = page.getByTestId('profile-card');
		await expect(card.getByTestId('profile-bio')).toHaveText('Writes programs');
		await expect(card).toContainText('admin');
		expect(await overridesShown(page)).toEqual([]);
		await page.keyboard.press('Escape');

		// A room's title and description, in the sidebar, the header and the page title; a thread's.
		await preview.openRoom('engineering');
		await expect(preview.heading()).toHaveText('engineering');
		expect(await overridesShown(page)).toEqual([]);
		await preview.openRoom('general');
		await preview.openThread('thread_deploy');
		await expect(preview.heading()).toContainText('Deploy checklist');
		expect(await overridesShown(page)).toEqual([]);
	});

	test('shows none in the server\'s title and description where it is picked', async ({ preview, page }) => {
		await preview.openRoot({ server: { title: `Mock${RLO} Chat`, description: `Where${RLO} **we** talk.` } });
		await expect(page.locator('.ap-shell-sidehead-name')).toHaveText('Mock Chat');
		await preview.openConnect();
		await expect(page.getByTestId('connect-server')).toContainText('Mock Chat');
		await expect(page.locator('.ap-connect-server-desc')).toHaveText('Where we talk.');
		expect(await overridesShown(page)).toEqual([]);
	});

	test('keeps every character on the wire: an edit sends back what was written, a room edit its title', async ({ preview, page }) => {
		await preview.open('#room=engineering');
		// Your own message, sent as typed, then edited: the override stays in what is sent.
		await preview.composer().click();
		await page.keyboard.insertText(`mine ${RLO}abc`);
		await page.getByRole('button', { name: 'Send message', exact: true }).click();
		const sent = await preview.waitForSent('message', (p) => typeof p.body?.text === 'string' && p.body.text.startsWith('mine'));
		expect(sent.body.text).toBe(`mine ${RLO}abc`);
		const mine = preview.message('mine abc');
		await expect(mine).toBeVisible();
		await expect(async () => {
			await mine.hover();
			await expect(mine.getByRole('button', { name: 'Edit message', exact: true })).toBeVisible({ timeout: 1000 });
		}).toPass();
		await mine.getByRole('button', { name: 'Edit message', exact: true }).click();
		const editor = page.getByRole('textbox', { name: 'Edit message', exact: true });
		await expect(editor).toBeVisible();
		await editor.press('ControlOrMeta+End');
		await page.keyboard.insertText(' more');
		await page.getByRole('button', { name: 'Save changes', exact: true }).click();
		const edit = await preview.waitForSent('message', (p) => p.message_id !== undefined && typeof p.body?.text === 'string' && p.body.text.endsWith('more'));
		expect(edit.body.text).toBe(`mine ${RLO}abc more`);
		await expect(preview.message('mine abc more')).toBeVisible();

		// The room's description changed alone: its title goes back as written.
		await page.getByTestId('room-actions').click();
		await page.getByTestId('edit-room').click();
		const dialog = page.getByRole('dialog', { name: 'Edit room', exact: true });
		// The editor starts from the title as written.
		await expect(dialog.getByRole('textbox', { name: 'Room title', exact: true })).toHaveValue(`engi${RLO}neering`);
		await dialog.getByRole('textbox', { name: /description/i }).fill('About builds, and releases');
		await dialog.getByRole('button', { name: 'Save', exact: true }).click();
		const saved = await preview.waitForSent('room_set', (p) => p.room_id === 'engineering');
		expect(saved.description).toBe('About builds, and releases');
		expect(saved.title ?? `engi${RLO}neering`).toBe(`engi${RLO}neering`);
		expect(await overridesShown(page)).toEqual([]);
	});
});
