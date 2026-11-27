import { DEVICES, expect, test } from './fixtures';

test.use(DEVICES.desktop);

test.describe('starting a thread on a message', () => {
	test('puts its description away, and offers a first message, sent in the thread as it starts, with who it mentions', async ({ preview, page }) => {
		await preview.open();
		const message = preview.message(/Welcome to Apron/);
		const messageId = await message.getAttribute('data-message-id');
		await message.hover();
		await message.getByRole('button', { name: 'Start thread', exact: true }).click();
		const dialog = page.getByRole('dialog', { name: 'Start thread' });
		await expect(dialog.getByRole('textbox', { name: 'Thread title', exact: true })).toBeFocused();
		// Nothing there to mistake for the thread's first message.
		await expect(dialog.getByTestId('description-input')).toHaveCount(0);
		await expect(dialog.getByTestId('first-message-input')).toHaveCount(0);
		await dialog.getByRole('textbox', { name: 'Thread title', exact: true }).fill('About the welcome');

		await dialog.getByRole('button', { name: 'Add first message', exact: true }).click();
		const first = dialog.getByTestId('first-message-input');
		await expect(first).toBeFocused();
		await page.keyboard.type('@ad');
		await page.getByTestId('first-message-picker').getByRole('option', { name: /Ada Lovelace/ }).click();
		await page.keyboard.type('is this still true?');
		await dialog.getByRole('button', { name: 'Start thread', exact: true }).click();
		await expect(dialog).toBeHidden();

		const created = await preview.waitForSent('room_set', (p) => p.title === 'About the welcome');
		expect(created.description).toBeUndefined();
		const sent = await preview.waitForSent('message', (p) => typeof p.body?.text === 'string' && p.body.text.endsWith('is this still true?'));
		// In the thread, replying to the message, as a first message from the thread's composer would.
		expect(sent).toMatchObject({ body: { text: '@ada is this still true?', mentions: ['ada'] }, reply_to: { message_id: messageId } });
		expect(sent.room_id).not.toBe('general');

		await expect(preview.heading()).toHaveText('general › About the welcome');
		await expect(preview.message('@Ada Lovelace is this still true?')).toBeVisible();
		// Sent already: the composer isn't left replying to the message, as it is when the thread starts without one.
		await expect(preview.composer()).toBeVisible();
		await expect(page.getByRole('button', { name: 'Cancel reply', exact: true })).toHaveCount(0);
	});
});
