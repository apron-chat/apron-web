import { DEVICES, expect, test } from './fixtures';

/**
 * The keyboard shortcuts (`lib/ui/shortcuts.ts`): `?` or Ctrl/⌘+/ shows them, as does the room header's ⋯ menu; and
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
		await expect(shortcuts.getByRole('heading', { level: 3 })).toHaveText(['General', 'Composer', 'Messages', 'Rooms', 'Viewers']);
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
