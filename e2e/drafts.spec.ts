import { DEVICES, expect, test } from './fixtures';

/**
 * Unsent drafts kept on this device (`DraftKeeper`): the app's own route, whose storage is real, against the scripted
 * server. A reload, as of a crashed or closed tab, brings each room's draft back, and one emptied stays empty.
 * Sending one, which the scripted server doesn't take, empties it as clearing does (`pane-drafts.svelte.test.ts`).
 */
test.use(DEVICES.desktop);

test('a draft outlasts a reload, until it is emptied', async ({ preview, page }) => {
	await preview.openRoot();
	await preview.composer().click();
	await page.keyboard.type('Half a thought');
	await page.keyboard.press('Shift+Enter');
	await page.keyboard.type('and its second line');
	await page.reload();
	await expect(page.getByTestId('connection-status')).toHaveText('Connected');
	await expect(preview.composer()).toContainText('Half a thought');
	await expect(preview.composer()).toContainText('and its second line');

	await preview.composer().click();
	await page.keyboard.press('ControlOrMeta+A');
	await page.keyboard.press('Backspace');
	await expect(preview.composer()).toHaveText('');
	await page.reload();
	await expect(page.getByTestId('connection-status')).toHaveText('Connected');
	await expect(preview.composer()).toHaveText('');
	expect(await page.evaluate(() => Object.keys(localStorage).filter((item) => item.startsWith('apron.draft:')))).toEqual([]);
});

test('an edit of a room’s title and description outlasts a reload as a draft, and Cancel asks before discarding it', async ({ preview, page }) => {
	await preview.openRoot();
	await page.getByTestId('room-actions').click();
	await page.getByTestId('edit-room').click();
	const sheet = page.getByTestId('description-sheet');
	const title = page.getByRole('textbox', { name: 'Room title', exact: true });
	await expect(title).toHaveValue('General');
	// The description has the keyboard as the editor opens.
	await expect(page.getByTestId('description-input')).toBeFocused();
	await page.keyboard.type('Where we say hello');
	await title.fill('General chat');
	await expect(page.locator('.ap-roomhead-draft')).toHaveText('Unsaved draft');

	await page.reload();
	await expect(page.getByTestId('connection-status')).toHaveText('Connected');
	await expect(sheet).toHaveCount(0);
	// No description to show its draft beside: Description says so, and takes it up.
	const description = page.getByTestId('show-description');
	await expect(description).toHaveAccessibleName('Show the room description, unsaved draft');
	await description.click();
	await expect(title).toHaveValue('General chat');
	await expect(page.getByTestId('description-input')).toHaveText('Where we say hello');
	await expect(page.locator('.ap-roomhead-draft')).toHaveText('Unsaved draft');

	await test.step('Cancel asks first: kept on No, gone on Yes', async () => {
		page.once('dialog', (dialog) => dialog.dismiss());
		await page.getByRole('button', { name: 'Cancel', exact: true }).click();
		await expect(title).toHaveValue('General chat');
		page.once('dialog', (dialog) => dialog.accept());
		await page.getByRole('button', { name: 'Cancel', exact: true }).click();
		await expect(sheet).toHaveCount(0);
		await expect(page.getByTestId('show-description')).toHaveCount(0);
	});
	await expect.poll(() => page.evaluate(() => Object.keys(localStorage).filter((item) => item.startsWith('apron.draft:')))).toEqual([]);
});
