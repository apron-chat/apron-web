import { DEVICES, expect, test, type Preview } from './fixtures';

/**
 * The app's composer (`src/lib/components/Composer.svelte`): a contenteditable field whose caret, chips and
 * autocomplete keys only a real browser exercises. Each test asserts what reaches the wire, from the frames
 * the memory server recorded.
 */

const picker = (preview: Preview) => preview.page.getByTestId('mention-picker');
const chip = (preview: Preview) => preview.composer().locator('.ap-mention[data-user-id]');

/** The `message` requests sent with this text. */
const sentWithText = (preview: Preview, text: string) => preview.sent('message').then((all) => all.filter((p) => p.body?.text === text));

test.describe('mentions in the composer', () => {
	test.use(DEVICES.desktop);

	test.beforeEach(async ({ preview }) => {
		await preview.open();
		await preview.composer().click();
	});

	test('a mention picked with Tab goes out as @user_id and in body.mentions', async ({ preview, page }) => {
		await page.keyboard.type('@ad');
		await expect(picker(preview).getByRole('option')).toHaveText([/Ada Lovelace/]);
		await page.keyboard.press('ArrowDown');
		await page.keyboard.press('Tab');
		await expect(picker(preview)).toBeHidden();
		await expect(chip(preview)).toHaveText('@Ada Lovelace');
		await expect(preview.composer()).toBeFocused();
		await page.keyboard.type('hi');
		await page.keyboard.press('Enter');

		const sent = await preview.waitForSent('message', (p) => p.body?.text === '@ada hi');
		expect(sent).toMatchObject({ room_id: 'general', body: { text: '@ada hi', mentions: ['ada'] } });
		// The timeline shows the chip as the name, and the field is empty and still focused for the next message.
		await expect(preview.message('@Ada Lovelace hi').getByRole('button', { name: '@Ada Lovelace' })).toBeVisible();
		await expect(preview.composer()).toHaveText('');
		await expect(preview.composer()).toBeFocused();
	});

	test('the arrow keys move through the matches, and Tab picks the active one', async ({ preview, page }) => {
		// A bare @ lists everyone who can be named.
		await page.keyboard.type('@');
		const options = picker(preview).getByRole('option');
		await expect(options.nth(1)).toBeVisible();
		await expect(options.first()).toHaveAttribute('aria-selected', 'true');
		const second = (await options.nth(1).locator('.ap-mpick-id').textContent())!.trim().replace(/^@/, '');
		await page.keyboard.press('ArrowDown');
		await expect(options.nth(1)).toHaveAttribute('aria-selected', 'true');
		await expect(preview.composer()).toHaveAttribute('aria-activedescendant', (await options.nth(1).getAttribute('id'))!);
		await page.keyboard.press('ArrowDown');
		await page.keyboard.press('ArrowUp');
		await page.keyboard.press('Tab');
		await expect(chip(preview)).toHaveAttribute('data-user-id', second);
		await page.keyboard.type('there');
		await preview.press(page.getByRole('button', { name: 'Send message', exact: true }));
		expect(await preview.waitForSent('message', (p) => p.body?.mentions?.length)).toMatchObject({ body: { text: `@${second} there`, mentions: [second] } });
	});

	test('Escape dismisses the picker, and Enter then sends the text as typed', async ({ preview, page }) => {
		await page.keyboard.type('@ad');
		await expect(picker(preview)).toBeVisible();
		await page.keyboard.press('Escape');
		await expect(picker(preview)).toBeHidden();
		await page.keyboard.press('Enter');

		const sent = await preview.waitForSent('message', (p) => p.body?.text === '@ad');
		expect(sent.body.mentions ?? []).toEqual([]);
		await expect(preview.composer()).toHaveText('');
	});

	test('Backspace right after a chip gives back the name as text to edit', async ({ preview, page }) => {
		await page.keyboard.type('@ad');
		await page.keyboard.press('Tab');
		await expect(chip(preview)).toHaveText('@Ada Lovelace');
		// The first Backspace takes the space the pick put after the chip, the second reverts the chip.
		await page.keyboard.press('Backspace');
		await expect(chip(preview)).toHaveCount(1);
		await page.keyboard.press('Backspace');
		await expect(chip(preview)).toHaveCount(0);
		await expect(preview.composer()).toHaveText('@Ada Lovelace');
		// Editing it goes on from the caret at its end.
		await page.keyboard.press('Escape');
		await page.keyboard.type('!');
		await expect(preview.composer()).toHaveText('@Ada Lovelace!');
	});
});

test.describe('Enter on a handheld device', () => {
	test.use(DEVICES.phone);

	test('inserts a new line, and Send sends both lines', async ({ preview, page }) => {
		await preview.open();
		expect(await page.evaluate(() => matchMedia('(hover: none) and (pointer: coarse)').matches), 'the phone preset emulates a handheld').toBe(true);
		await preview.press(preview.composer());
		await page.keyboard.type('first line');
		await page.keyboard.press('Enter');
		await page.keyboard.type('second line');
		// innerText: the line break is an element, which textContent leaves out.
		await expect.poll(() => preview.composer().evaluate((el) => (el as HTMLElement).innerText.trim())).toBe('first line\nsecond line');
		expect(await sentWithText(preview, 'first line')).toEqual([]);

		await preview.press(page.getByRole('button', { name: 'Send message', exact: true }));
		await preview.waitForSent('message', (p) => p.body?.text === 'first line\nsecond line');
	});
});
