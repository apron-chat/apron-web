import { DEVICES, expect, test } from './fixtures';

/**
 * The keyboard shortcuts (`lib/ui/shortcuts.ts`): `?` or Ctrl/⌘+/ shows them, as does the room header's ⋯ menu; Alt+↑/↓
 * through the rooms list; `r` and `e` on a message; and
 * the composer's own, ↑ in the empty field to edit your last message and Escape to cancel a reply.
 */

test.use(DEVICES.desktop);

test('? shows the keyboard shortcuts, but types a ? in a field; Ctrl+/ and the ⋯ menu show them too', async ({ preview, page }) => {
	await preview.open();
	const shortcuts = page.getByRole('dialog', { name: 'Keyboard shortcuts' });

	await test.step('? off a field shows them, and Escape puts them away', async () => {
		await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
		await page.keyboard.press('Shift+?');
		await expect(shortcuts).toBeVisible();
		await expect(shortcuts.getByRole('heading', { level: 3 })).toHaveText(['General', 'Rooms', 'Composer', 'Full panel', 'Messages']);
		await expect(shortcuts.locator('.ap-keys-row').filter({ hasText: 'Go to messages' })).toContainText('When empty');
		await expect(shortcuts.getByRole('region', { name: 'Messages' })).toContainText('On a message');
		await page.keyboard.press('Escape');
		await expect(shortcuts).toHaveCount(0);
	});

	await test.step('in the composer, ? is a character, and Ctrl+/ shows them', async () => {
		await preview.composer().click();
		await page.keyboard.type('why?');
		await expect(preview.composer()).toHaveText('why?');
		await expect(shortcuts).toHaveCount(0);
		await page.keyboard.press('ControlOrMeta+/');
		await expect(shortcuts).toBeVisible();
		await shortcuts.getByRole('button', { name: 'Close' }).click();
		await expect(shortcuts).toHaveCount(0);
	});

	await test.step('the ⋯ menu names the key, and opens them', async () => {
		await page.getByTestId('room-actions').first().click();
		const item = page.getByRole('menuitem', { name: /Keyboard shortcuts/ });
		await expect(item).toContainText('?');
		await item.click();
		await expect(shortcuts).toBeVisible();
	});
});

test('↑ in the empty composer goes up to the messages, ↑ ↓ move between them, and Escape there cancels a reply', async ({ preview, page }) => {
	await preview.open();
	const composer = preview.composer();
	// What ↑ ↓ stop at: messages and notices, and the thread cards between them; each by its id.
	const focused = () => page.evaluate(() => { const element = document.activeElement as HTMLElement | null; return element?.dataset.messageId ?? element?.dataset.thread; });
	const rows = () => page.getByTestId('message-list').locator('article[data-message-id]:not(.ap-msg-system), button.ap-thread').evaluateAll((items) => items.map((item) => (item as HTMLElement).dataset.messageId ?? (item as HTMLElement).dataset.thread));

	await test.step('↑ goes to the newest message, ↑ ↓ from one to the next, ↓ at the newest back to the composer', async () => {
		await composer.click();
		await page.keyboard.type('first try');
		await page.keyboard.press('Enter');
		const mine = preview.message('first try');
		await expect(mine).toBeVisible();
		await expect(composer).toHaveText('');
		const order = await rows();
		const newest = order.at(-1)!;
		expect(await mine.getAttribute('data-message-id')).toBe(newest);

		await page.keyboard.press('ArrowUp');
		await expect(mine).toBeFocused();
		// Its toolbar shows, as on hover.
		await expect(mine.getByRole('button', { name: 'Reply to message', exact: true })).toBeVisible();
		await page.keyboard.press('ArrowUp');
		expect(await focused()).toBe(order.at(-2));
		await page.keyboard.press('Home');
		expect(await focused()).toBe(order[0]);
		await page.keyboard.press('End');
		expect(await focused()).toBe(newest);
		await page.keyboard.press('ArrowDown');
		await expect(composer).toBeFocused();
	});

	await test.step('a message arriving leaves the keyboard where it is; another room gives it back to the composer', async () => {
		await page.keyboard.press('ArrowUp');
		await page.keyboard.press('ArrowUp');
		const on = await focused();
		await preview.post('general', 'ada', 'Arriving meanwhile');
		await expect(preview.message('Arriving meanwhile')).toBeVisible();
		expect(await focused()).toBe(on);
		await page.keyboard.press('Alt+ArrowDown');
		await expect(composer).toBeFocused();
		await preview.openRoom('general');
		await composer.click();
	});

	await test.step('↑ then e edits it, and the keyboard comes back to it as the edit ends; Escape there is the composer', async () => {
		// Ada's arrived since: two up.
		const mine = preview.message('first try');
		await page.keyboard.press('ArrowUp');
		await page.keyboard.press('ArrowUp');
		await expect(mine).toBeFocused();
		await page.keyboard.press('e');
		const editor = page.getByRole('textbox', { name: 'Edit message', exact: true });
		await expect(editor).toBeFocused();
		await expect(editor).toHaveText('first try');
		await page.keyboard.type(', fixed');
		await page.keyboard.press('Enter');
		const edit = await preview.waitForSent('message', (params) => params.message_id !== undefined);
		expect(edit.body.text).toBe('first try, fixed');
		await expect(mine).toBeFocused();
		// Enter goes into its actions, Escape back to the row, and Escape again to the composer.
		await page.keyboard.press('Enter');
		await expect(mine.locator('.ap-msg-actions button').first()).toBeFocused();
		await page.keyboard.press('Escape');
		await expect(mine).toBeFocused();
		await page.keyboard.press('Escape');
		await expect(composer).toBeFocused();
	});

	await test.step('with a draft, ↑ stays the field\'s', async () => {
		await page.keyboard.type('draft');
		await page.keyboard.press('ArrowUp');
		await expect(composer).toBeFocused();
		await expect(composer).toHaveText('draft');
	});

	await test.step('Escape while replying cancels the reply, and keeps the draft', async () => {
		const welcome = page.locator('article[data-message-id="1710000000001"]');
		const reply = welcome.getByRole('button', { name: 'Reply to message', exact: true });
		await expect(async () => {
			await welcome.hover();
			await expect(reply).toBeVisible({ timeout: 1000 });
		}).toPass();
		await reply.click();
		await expect(page.getByTestId('reply-draft')).toBeVisible();
		await expect(composer).toBeFocused();
		await page.keyboard.press('Escape');
		await expect(page.getByTestId('reply-draft')).toHaveCount(0);
		await expect(composer).toHaveText('draft');
		await expect(composer).toBeFocused();
	});
});

test('Alt+↑/↓ steps through the rooms list from the composer, Alt+Shift from room to room past threads; on a room\'s row it moves the room', async ({ preview, page }) => {
	await preview.open();
	const sidebar = page.getByRole('complementary', { name: 'Rooms' });
	/** The rows stepped through, as drawn: joined rooms and threads, and the open one. */
	const rows = () => sidebar.locator('button.ap-room:is([data-room], [data-thread], [data-other-thread], [aria-current="page"])');
	/** The open row's room or thread. */
	const open = () => sidebar.locator('button.ap-room[aria-current="page"]').evaluate((button: HTMLElement) => button.dataset.room ?? button.dataset.thread ?? button.dataset.join);
	const composer = preview.composer();

	await test.step('Alt+↓ and Alt+↑ open the row below and above, the keyboard staying in the composer', async () => {
		await composer.click();
		const before = await open();
		const order = await rows().evaluateAll((buttons: HTMLElement[]) => buttons.map((button) => button.dataset.room ?? button.dataset.thread ?? button.dataset.join));
		const at = order.indexOf(before);
		await page.keyboard.press('Alt+ArrowDown');
		await expect.poll(open).toBe(order[at + 1]);
		await expect(composer).toBeFocused();
		await page.keyboard.press('Alt+ArrowUp');
		await expect.poll(open).toBe(before);
	});

	await test.step('it steps into the threads listed to read without joining, and joins none of them', async () => {
		const other = sidebar.locator('button.ap-room[data-other-thread]').first();
		const id = await other.getAttribute('data-other-thread');
		await other.evaluate((row) => row.scrollIntoView());
		// From the row before it.
		const order = await rows().evaluateAll((buttons: HTMLElement[]) => buttons.map((button) => button.dataset.room ?? button.dataset.thread ?? button.dataset.otherThread));
		await page.locator(`button.ap-room[data-thread="${order[order.indexOf(id!) - 1]}"], button.ap-room[data-room="${order[order.indexOf(id!) - 1]}"]`).click();
		await composer.click();
		await page.keyboard.press('Alt+ArrowDown');
		await expect(page).toHaveURL(new RegExp(`thread=${id}`));
		expect(await preview.sent('room_join')).toEqual([]);
		await page.keyboard.press('Alt+ArrowUp');
		await expect(page).not.toHaveURL(new RegExp(`thread=${id}`));
	});

	await test.step('Alt+Shift+↓ and ↑ go from room to room, past the threads between', async () => {
		// From one of general's threads, past the rest of them to the next room, and back up to general.
		await expect(page).toHaveURL(/[#&]thread=/);
		await page.keyboard.press('Alt+Shift+ArrowDown');
		await expect(page).toHaveURL(/[#&]room=engineering$/);
		await page.keyboard.press('Alt+Shift+ArrowUp');
		await expect(page).toHaveURL(/[#&]room=general$/);
		await page.keyboard.press('Alt+Shift+ArrowDown');
		await expect(page).toHaveURL(/[#&]room=engineering$/);
	});

	await test.step('on a room\'s row, Alt+↑ moves the room up instead, and the open room stays', async () => {
		const row = sidebar.locator('button.ap-room[data-room="engineering"]');
		const ids = async () => sidebar.locator('[data-testid="room-list"] button[data-room]').evaluateAll((buttons) => buttons.map((button) => (button as HTMLElement).dataset.room));
		const before = await ids();
		await row.focus();
		await page.keyboard.press('Alt+ArrowUp');
		await expect.poll(ids).not.toEqual(before);
		await expect(row).toHaveAttribute('aria-current', 'page');
	});
});

test('r replies to the focused message, and e edits it when it is yours', async ({ preview, page }) => {
	await preview.open();
	const welcome = page.locator('article[data-message-id="1710000000001"]');
	await welcome.click();
	await page.keyboard.press('r');
	await expect(page.getByTestId('reply-draft')).toBeVisible();
	await expect(preview.composer()).toBeFocused();
	await expect(preview.composer()).toHaveText('');
	await page.keyboard.press('Escape');

	await page.keyboard.type('mine');
	await page.keyboard.press('Enter');
	const mine = preview.message('mine');
	await expect(mine).toBeVisible();
	// Someone else's isn't yours to edit.
	await welcome.click();
	await page.keyboard.press('e');
	await expect(page.getByRole('textbox', { name: 'Edit message', exact: true })).toHaveCount(0);
	await mine.click();
	await page.keyboard.press('e');
	await expect(page.getByRole('textbox', { name: 'Edit message', exact: true })).toBeFocused();
});

test('the shortcuts keep out of what else is under way: a selection, an edit, an end of the list', async ({ preview, page }) => {
	await preview.open();
	const shortcuts = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
	const editor = page.getByRole('textbox', { name: 'Edit message', exact: true });
	const composer = preview.composer();

	await test.step('Escape that closes the shortcuts leaves a selection as it was', async () => {
		await page.locator('article[data-message-id="1710000000001"]').click();
		await page.keyboard.press('x');
		await expect(page.getByTestId('selection-bar')).toBeVisible();
		await page.keyboard.press('Shift+?');
		await expect(shortcuts).toBeVisible();
		await page.keyboard.press('Escape');
		await expect(shortcuts).toHaveCount(0);
		await expect(page.getByTestId('selection-bar')).toBeVisible();
		await page.keyboard.press('Escape');
		await expect(page.getByTestId('selection-bar')).toHaveCount(0);
	});

	await test.step('in select mode Escape ends the selection, and the keys stay off the composer, which is the bar', async () => {
		await composer.click();
		await page.keyboard.type('to fix');
		await page.keyboard.press('Enter');
		await expect(preview.message('to fix')).toBeVisible();
		await page.keyboard.press('ArrowUp');
		await page.keyboard.press('x');
		await expect(page.getByTestId('selection-bar')).toBeVisible();
		await page.keyboard.press('Escape');
		await expect(page.getByTestId('selection-bar')).toHaveCount(0);
	});

	await test.step('an edit opened on the message with e gives the keyboard back to the message', async () => {
		const mine = preview.message('to fix');
		await mine.click();
		await page.keyboard.press('e');
		await expect(editor).toBeFocused();
		await page.keyboard.press('Escape');
		await expect(editor).toHaveCount(0);
		await expect(mine).toBeFocused();
	});

	await test.step('Alt+↑ with nowhere to go leaves the key to the field', async () => {
		// general is the first row: there's nothing above it.
		await expect(page.locator('button.ap-room[data-room="general"]')).toHaveAttribute('aria-current', 'page');
		const prevented = await composer.evaluate((field) => !field.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', altKey: true, bubbles: true, cancelable: true })));
		expect(prevented).toBe(false);
	});
});

test('? over the connect screen doesn\'t open the shortcuts, then or once it is cancelled', async ({ preview, page }) => {
	await preview.openRoot();
	await preview.openConnect();
	const form = page.getByRole('form', { name: 'Sign in' });
	await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
	await page.keyboard.press('Shift+?');
	await form.getByRole('button', { name: 'Cancel', exact: true }).click();
	await expect(form).toHaveCount(0);
	await expect(page.getByTestId('connection-status')).toHaveText('Connected');
	await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toHaveCount(0);
});

test.describe('Alt+↑/↓ onto a room listed to join', () => {
	test.use({ knobs: { seed: 'rich' } });

	test('opens it to read without joining, with Join in its header; posting there joins it', async ({ preview, page }) => {
		await preview.open();
		const sidebar = page.getByRole('complementary', { name: 'Rooms' });
		const listed = page.getByTestId('room-directory').locator('button.ap-room[data-join="design"]');
		await expect(listed).toBeVisible();
		const rows = sidebar.locator('button.ap-room:is([data-room], [data-thread], [data-other-thread], [data-join], [aria-current="page"])');
		const order = await rows.evaluateAll((buttons: HTMLElement[]) => buttons.map((button) => button.dataset.room ?? button.dataset.thread ?? button.dataset.otherThread ?? button.dataset.join));
		// From the row above it, Alt+↓.
		const before = order[order.indexOf('design') - 1];
		await sidebar.locator(`button.ap-room:is([data-room="${before}"], [data-thread="${before}"], [data-other-thread="${before}"], [data-join="${before}"])`).click();
		await preview.composer().click();
		await page.keyboard.press('Alt+ArrowDown');
		await expect(page).toHaveURL(/[#&]room=design(&|$)/);
		await expect(listed).toHaveAttribute('aria-current', 'page');
		await expect(page.getByTestId('join-room')).toBeVisible();
		expect((await preview.sent('room_join')).filter((params) => params.room_id === 'design')).toEqual([]);

		// Posting joins it, so what follows arrives live.
		await preview.composer().click();
		await page.keyboard.type('Hello, design');
		await page.keyboard.press('Enter');
		await preview.waitForSent('room_join', (params) => params.room_id === 'design');
		await expect(preview.message('Hello, design')).toBeVisible();
		await expect(sidebar.locator('button.ap-room[data-room="design"]')).toHaveAttribute('aria-current', 'page');
	});

	test('a click on its row opens it to read too, and the header\'s Join, beside the ⋯, joins it', async ({ preview, page }) => {
		await preview.open();
		const sidebar = page.getByRole('complementary', { name: 'Rooms' });
		await page.getByTestId('room-directory').locator('button.ap-room[data-join="design"]').click();
		await expect(page).toHaveURL(/[#&]room=design(&|$)/);
		expect((await preview.sent('room_join')).filter((params) => params.room_id === 'design')).toEqual([]);
		const join = page.getByTestId('join-room');
		await expect(join).toHaveClass(/ap-btn-primary/);
		// Right before the ⋯ menu, at the header's end.
		expect(await join.evaluate((button) => button.nextElementSibling?.querySelector('[data-testid="room-actions"]') !== null || button.nextElementSibling?.matches('[data-testid="room-actions"]'))).toBe(true);
		await join.click();
		await preview.waitForSent('room_join', (params) => params.room_id === 'design');
		await expect(sidebar.locator('[data-testid="room-list"] button.ap-room[data-room="design"]')).toHaveAttribute('aria-current', 'page');
		await expect(join).toHaveCount(0);
	});

	test('/join on a room open to read joins it, rather than only opening it', async ({ preview, page }) => {
		await preview.open();
		await page.getByTestId('room-directory').locator('button.ap-room[data-join="design"]').click();
		await expect(page.getByTestId('join-room')).toBeVisible();
		await preview.openRoom('general');
		await preview.composer().click();
		await page.keyboard.type('/join design');
		await page.keyboard.press('Enter');
		await preview.waitForSent('room_join', (params) => params.room_id === 'design');
		await expect(page.getByRole('complementary', { name: 'Rooms' }).locator('[data-testid="room-list"] button.ap-room[data-room="design"]')).toBeVisible();
	});
});

test.describe('a guest who only reads', () => {
	test.use({ knobs: { seed: 'rich', permissions: { write: false } } });

	test('↑ with nothing focused goes to the newest message, ↑ ↓ between them, Escape off them', async ({ preview, page }) => {
		await preview.open();
		await expect(preview.composer()).toHaveCount(0);
		await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
		const focused = () => page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.messageId);
		const order = await page.getByTestId('message-list').locator('article.ap-msg[data-message-id]:not(.ap-msg-system)').evaluateAll((articles) => articles.map((article) => (article as HTMLElement).dataset.messageId));
		await page.keyboard.press('ArrowUp');
		expect(await focused()).toBe(order.at(-1));
		await page.keyboard.press('ArrowUp');
		expect(await focused()).toBe(order.at(-2));
		await page.keyboard.press('ArrowDown');
		await page.keyboard.press('ArrowDown');
		// The newest, with no composer below it: it stays.
		expect(await focused()).toBe(order.at(-1));
		await page.keyboard.press('Escape');
		expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);
		// ↓ from nowhere goes there too.
		await page.keyboard.press('ArrowDown');
		expect(await focused()).toBe(order.at(-1));
	});
});

test('the timeline is one Tab stop: ← → go through a message, its words shown and keys boxed for the keyboard; thread cards are stops; Shift+↑ ↓ select a run', async ({ preview, page }) => {
	await preview.open();
	const composer = preview.composer();
	const list = page.getByTestId('message-list');
	const inList = () => list.evaluate((element) => element.contains(document.activeElement));
	await composer.click();
	for (const text of ['alpha-1', 'beta-2', 'gamma-3']) {
		await page.keyboard.type(text);
		await page.keyboard.press('Enter');
		await expect(preview.message(text)).toBeVisible();
	}
	const three = preview.message('gamma-3');

	await test.step('Shift+Tab from the composer lands on the newest message, and Tab goes past the timeline', async () => {
		await page.keyboard.press('Shift+Tab');
		await expect(three).toBeFocused();
		await page.keyboard.press('Tab');
		expect(await inList()).toBe(false);
		await page.keyboard.press('Shift+Tab');
		await expect(three).toBeFocused();
		await page.keyboard.press('Shift+Tab');
		expect(await inList()).toBe(false);
		// Back in, to the item it was last on.
		await page.keyboard.press('Tab');
		await expect(three).toBeFocused();
	});

	await test.step('→ goes into its links and buttons, ← → through them, Escape back to the row; words shown and R and E boxed for the keyboard', async () => {
		// Each icon's words beside it, the letter of its key boxed (`::first-letter`).
		const label = (element: Element) => {
			const words = element.querySelector('.ap-actions-label')!;
			return [getComputedStyle(words).display !== 'none', getComputedStyle(words, '::first-letter').backgroundColor !== 'rgba(0, 0, 0, 0)'];
		};
		const reply = three.getByRole('button', { name: 'Reply to message', exact: true });
		expect(await reply.evaluate(label)).toEqual([true, true]);
		const seen: string[] = [];
		// Past its links, the quick reactions, React and Reply, to Edit.
		for (let i = 0; i < 12; i++) {
			await page.keyboard.press('ArrowRight');
			seen.push(await page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.textContent ?? ''));
		}
		expect(seen).toContain('Reply to message');
		expect(seen).toContain('Edit message');
		expect(await three.evaluate((row) => row.contains(document.activeElement) && row !== document.activeElement)).toBe(true);
		await page.keyboard.press('Escape');
		await expect(three).toBeFocused();
		// A click from there lands on the button pressed: the words stay while it's pressed, rather than going as focus would leave the row.
		await three.getByRole('button', { name: 'Edit message', exact: true }).click();
		await expect(page.getByRole('textbox', { name: 'Edit message', exact: true })).toBeVisible();
		await page.keyboard.press('Escape');
		// A pointer on a message in this wide pane shows the words too, but boxes no key.
		await composer.click();
		await preview.message('alpha-1').hover();
		expect(await preview.message('alpha-1').getByRole('button', { name: 'Reply to message', exact: true }).evaluate(label)).toEqual([true, false]);
	});

	await test.step('Shift+↑ selects up from the message, Shift+↓ gives them back', async () => {
		await page.keyboard.press('ArrowUp');
		await expect(three).toBeFocused();
		await page.keyboard.press('Shift+ArrowUp');
		const bar = page.getByTestId('selection-bar');
		await expect(bar).toContainText('2 messages selected');
		await page.keyboard.press('Shift+ArrowUp');
		await expect(bar).toContainText('3 messages selected');
		await expect(preview.message('alpha-1')).toBeFocused();
		await page.keyboard.press('Shift+ArrowDown');
		await expect(bar).toContainText('2 messages selected');
		await page.keyboard.press('Escape');
		await expect(bar).toHaveCount(0);
	});

	await test.step('a thread\'s card between the messages is a stop for ↑', async () => {
		await composer.click();
		await page.keyboard.press('ArrowUp');
		let onCard = false;
		for (let i = 0; i < 12 && !onCard; i++) {
			await page.keyboard.press('ArrowUp');
			onCard = await page.evaluate(() => document.activeElement?.classList.contains('ap-thread') ?? false);
		}
		expect(onCard).toBe(true);
	});
});
