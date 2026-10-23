import { DEVICES, expect, test, type Preview } from './fixtures';

/**
 * A message row's controls as the page wires them (the design system's `Message`, its `MessageHandlers` in
 * `src/routes/+page.svelte`): each acts on the row's own message, which the wire shows.
 */

/** Hovers the row, so its toolbar is built, and presses one of its actions. */
async function act(preview: Preview, text: string, action: string): Promise<void> {
	const row = preview.message(text);
	await row.hover();
	await row.getByRole('button', { name: action, exact: true }).click();
}

test.describe('a message row', () => {
	test.use(DEVICES.desktop);

	test.beforeEach(async ({ preview }) => {
		await preview.open();
	});

	test('React opens the picker beside it, and a pick reacts to that message', async ({ preview, page }) => {
		await act(preview, 'Open a thread, react to a message', 'React');
		const react = preview.message('Open a thread, react to a message').getByRole('button', { name: 'React', exact: true });
		await expect(react).toHaveAttribute('aria-expanded', 'true');
		const picker = page.getByRole('dialog', { name: 'Emoji picker', exact: true });
		await expect(picker).toHaveAttribute('data-state', 'ready');
		await picker.locator('em-emoji-picker input[type="search"]').fill('tada');
		await picker.getByRole('button', { name: '🎉', exact: true }).first().click();
		expect(await preview.waitForSent('reactions')).toMatchObject({ message_id: '1710000000004', emojis: ['🎉'] });
		await preview.message('Open a thread, react to a message').hover();
		await expect(react).toHaveAttribute('aria-expanded', 'false');
		// A right-click on the chip lists who reacted: you.
		await preview.message('Open a thread, react to a message').getByTestId('reaction-chip').click({ button: 'right' });
		await expect(page.getByTestId('reactors').getByTestId('reactor')).toHaveCount(1);
	});

	test('Reply puts the message in the composer’s reply', async ({ preview, page }) => {
		await act(preview, 'Welcome to Apron!', 'Reply to message');
		await expect(page.getByTestId('reply-draft')).toContainText('Welcome to Apron!');
	});

	test('a shift-click in select mode picks every message between', async ({ preview, page }) => {
		await preview.composer().click();
		for (const text of ['first of mine', 'second of mine', 'third of mine']) {
			await page.keyboard.type(text);
			await page.keyboard.press('Enter');
			await expect(preview.message(text)).toBeVisible();
		}
		await act(preview, 'first of mine', 'More actions');
		await preview.message('first of mine').getByTestId('select-message').click();
		await expect(page.getByTestId('selection-bar')).toContainText('1 message selected');
		await preview.message('third of mine').locator('.ap-msg-text').click({ modifiers: ['Shift'] });
		await expect(page.getByTestId('selection-bar')).toContainText('3 messages selected');
	});

	test('an image embed opens full screen', async ({ preview, page }) => {
		await preview.message('Two from the ridge').getByRole('img', { name: /Layered purple hills/ }).click();
		await expect(page.getByRole('dialog').getByRole('button', { name: 'Next image' })).toBeVisible();
	});
});

test.describe('a shared name', () => {
	test.use({ ...DEVICES.desktop, knobs: { seed: 'rich' } });

	test('carries its @user_id beside it, by the test id interop finds it with', async ({ preview }) => {
		await preview.open();
		await expect(preview.message('Another Ada Lovelace').getByTestId('sender-handle')).toHaveText('@ada_b');
		await expect(preview.message('Long names and four roles').getByTestId('sender-handle')).toHaveCount(0);
	});
});
