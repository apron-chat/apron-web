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
		await expect(shortcuts.getByRole('heading', { level: 3 })).toHaveText(['General', 'Composer', 'Messages', 'Rooms']);
		await expect(shortcuts.locator('.ap-keys-row').filter({ hasText: 'Edit your last message' })).toContainText('In an empty composer');
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

test('↑ in the empty composer edits your last message, and Escape there cancels a reply', async ({ preview, page }) => {
	await preview.open();
	const composer = preview.composer();

	await test.step('↑ edits your newest message, and the keyboard comes back to the composer as the edit ends', async () => {
		await composer.click();
		await page.keyboard.type('first try');
		await page.keyboard.press('Enter');
		await expect(preview.message('first try')).toBeVisible();
		await expect(composer).toHaveText('');

		await page.keyboard.press('ArrowUp');
		const editor = page.getByRole('textbox', { name: 'Edit message', exact: true });
		await expect(editor).toBeFocused();
		await expect(editor).toHaveText('first try');
		await page.keyboard.press('Escape');
		await expect(editor).toHaveCount(0);
		await expect(composer).toBeFocused();

		await page.keyboard.press('ArrowUp');
		await expect(editor).toBeFocused();
		await page.keyboard.type(', fixed');
		await page.keyboard.press('Enter');
		const edit = await preview.waitForSent('message', (params) => params.message_id !== undefined);
		expect(edit.body.text).toBe('first try, fixed');
		await expect(composer).toBeFocused();
	});

	await test.step('with a draft, ↑ stays the field\'s', async () => {
		await page.keyboard.type('draft');
		await page.keyboard.press('ArrowUp');
		await expect(page.getByRole('textbox', { name: 'Edit message', exact: true })).toHaveCount(0);
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

test('Alt+↑/↓ steps through the rooms list from the composer, Alt+Shift to the next with news; on a room\'s row it moves the room', async ({ preview, page }) => {
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

	await test.step('Alt+Shift+↓ goes to the room with news, past the ones without', async () => {
		await preview.post('engineering', 'ada', 'Something new');
		const news = sidebar.locator('button.ap-room[data-room="engineering"]');
		await expect(news).toHaveClass(/ap-room-unread/);
		await page.keyboard.press('Alt+Shift+ArrowDown');
		await expect(news).toHaveAttribute('aria-current', 'page');
		await expect(page).toHaveURL(/[#&]room=engineering(&|$)/);
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

test('the shortcuts keep out of what else is under way: a selection, an open edit, an end of the list', async ({ preview, page }) => {
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

	await test.step('↑ with an edit open goes back to it, its words kept', async () => {
		await composer.click();
		await page.keyboard.type('to fix');
		await page.keyboard.press('Enter');
		await expect(preview.message('to fix')).toBeVisible();
		await page.keyboard.press('ArrowUp');
		await expect(editor).toBeFocused();
		await page.keyboard.type(' later');
		await composer.click();
		await page.keyboard.press('ArrowUp');
		await expect(editor).toBeFocused();
		await expect(editor).toHaveText('to fix later');
		await page.keyboard.press('Escape');
		await expect(composer).toBeFocused();
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
