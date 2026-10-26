import { DEVICES, expect, test } from './fixtures';

/**
 * Private conversations (§4.2.4): Message on a profile card, the + beside Private, and a room someone else added you
 * to. Starting one takes an account, so the memory server signs the viewer in to one (`account`), except where a
 * guest's view is the point.
 */

test.use(DEVICES.desktop);

test.describe('signed in to an account', () => {
	test.use({ knobs: { account: true } });

	test('Message on a profile card starts a private room with them, which opens under Private', async ({ preview, page }) => {
		await preview.open();
		await page.getByTestId('message-list').getByRole('button', { name: 'Linus', exact: true }).first().click();
		const card = page.getByTestId('profile-card');
		await card.getByRole('button', { name: 'Message', exact: true }).click();

		// Created private, then Linus added once its record said so, then opened.
		const created = await preview.waitForSent('room_set', (p) => p.private === true && p.parent_room_id === undefined);
		expect(created.title).toBeUndefined();
		await preview.waitForSent('room_join', (p) => p.user_id === 'linus');
		await expect(card).toBeHidden();
		await expect(preview.heading()).toHaveText(/^Linus/);
		await expect(page.getByTestId('private-list').locator('button[aria-current="page"]')).toHaveAccessibleName('Linus');
		await expect(page.getByTestId('room-list').getByText('Linus')).toHaveCount(0);
		await expect(preview.composer()).toHaveAttribute('aria-placeholder', 'Message Linus');
		await expect(page.getByTestId('private-intro')).toContainText('@linus');
		// Started here, so no banner says you were added.
		await expect(page.getByTestId('added-banner')).toHaveCount(0);

		// Message again opens the same room rather than starting another.
		await preview.openRoom('general');
		await page.getByTestId('message-list').getByRole('button', { name: 'Linus', exact: true }).first().click();
		await page.getByTestId('profile-card').getByRole('button', { name: 'Message', exact: true }).click();
		await expect(preview.heading()).toHaveText(/^Linus/);
		expect((await preview.sent('room_set')).filter((p) => p.private === true)).toHaveLength(1);
	});

	test('the + beside Private starts a named room with the people picked, one at a time', async ({ preview, page }) => {
		await preview.open();
		await page.getByRole('button', { name: 'New private conversation', exact: true }).click();
		const dialog = page.getByRole('dialog', { name: 'New private conversation' });
		// The server's limit, counted: the two seeded private rooms of five.
		await expect(dialog).toContainText('2 of 5');
		const field = dialog.getByRole('combobox', { name: 'To' });
		await field.fill('lin');
		await field.press('Enter');
		await field.fill('marg');
		await field.press('Enter');
		await expect(dialog.getByRole('button', { name: /^Remove / })).toHaveCount(2);
		// Backspace in the empty field takes the last back.
		await field.press('Backspace');
		await expect(dialog.getByRole('button', { name: /^Remove / })).toHaveCount(1);
		await expect(dialog.getByRole('button', { name: 'Message Linus' })).toBeEnabled();
		await field.fill('marg');
		await field.press('Enter');
		await dialog.getByRole('textbox', { name: 'Name' }).fill('Release crew');
		await dialog.getByRole('button', { name: 'Start conversation' }).click();

		await preview.waitForSent('room_set', (p) => p.private === true && p.title === 'Release crew');
		await expect(dialog).toBeHidden();
		await expect(preview.heading()).toHaveText(/^Release crew/);
		const joins = (await preview.sent('room_join')).map((p) => p.user_id);
		expect(joins).toEqual(['linus', 'margaret']);
		await expect(page.getByTestId('private-list').locator('button[aria-current="page"]')).toHaveAccessibleName('Release crew');
	});

	test('a private room someone else added you to says so under its header, until put away', async ({ preview, page }) => {
		await preview.open();
		const roomId = await page.evaluate(() => (window as any).__apronPreview.addYouToPrivate('margaret') as string);
		const row = page.getByTestId('private-list').locator(`button[data-room="${roomId}"]`);
		// Being added alerts as a mention would: the row counts it until opened.
		await expect(row).toHaveAccessibleName('Margaret Hamilton 1 unread message, a mention of you');
		await expect(row.getByTestId('room-unread')).toHaveText('@ 1');
		await row.click();
		await expect(row).toHaveAccessibleName('Margaret Hamilton');
		const banner = page.getByTestId('added-banner');
		await expect(banner).toContainText('You were added to this private room.');
		await banner.getByRole('button', { name: 'Dismiss' }).click();
		await expect(banner).toHaveCount(0);
		await preview.openRoom('general');
		await row.click();
		await expect(preview.heading()).toHaveText(/^Margaret Hamilton/);
		await expect(page.getByTestId('added-banner')).toHaveCount(0);
	});
});

test.describe('as a guest', () => {
	test('lists the private rooms you are in, but offers no way to start one', async ({ preview, page }) => {
		await preview.open();
		const list = page.getByTestId('private-list');
		await expect(list.locator('button[data-room]')).toHaveCount(2);
		for (const name of ['Grace Hopper', 'Launch plans']) await expect(list.getByRole('button', { name, exact: true })).toBeVisible();
		await expect(page.getByRole('button', { name: 'New private conversation' })).toHaveCount(0);
		await page.getByTestId('message-list').getByRole('button', { name: 'Linus', exact: true }).first().click();
		await expect(page.getByTestId('profile-card').getByRole('button', { name: 'Message', exact: true })).toHaveCount(0);
	});
});
