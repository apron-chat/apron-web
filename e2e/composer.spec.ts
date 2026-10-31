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
		// Ada's role matches too, after her.
		await expect(picker(preview).getByRole('option')).toHaveText([/Ada Lovelace/, /@admin/]);
		await page.keyboard.press('ArrowDown');
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
		// Editing it goes on from the caret at its end: a name changed into no one's is text, and no mention.
		await page.keyboard.press('Escape');
		await page.keyboard.press('Backspace');
		await page.keyboard.type('! see you');
		await expect(preview.composer()).toHaveText('@Ada Lovelac! see you');
		await expect(chip(preview)).toHaveCount(0);
		await page.keyboard.press('Enter');
		const sent = await preview.waitForSent('message', (p) => p.body?.text === '@Ada Lovelac! see you');
		expect(sent.body.mentions ?? []).toEqual([]);
	});
});

test.describe('role mentions in the composer', () => {
	test.use({ ...DEVICES.desktop, knobs: { people: { grace: { roles: ['moderator'] } } } });

	test('a picked role is a chip, goes out as @&role, and mentions everyone else here who holds it', async ({ preview, page }) => {
		await preview.open();
		await preview.composer().click();
		await page.keyboard.type('@mod');
		await expect(picker(preview).getByRole('option')).toHaveText([/@moderator\s*2 people/]);
		await page.keyboard.press('Tab');
		const role = preview.composer().locator('.ap-mention-role');
		await expect(role).toHaveText('@moderator');
		await expect(role).toHaveAttribute('title', 'Mentions all 2 people here with the role moderator');
		await page.keyboard.type('please look');
		await page.keyboard.press('Enter');

		const sent = await preview.waitForSent('message', (p) => p.body?.text === '@&moderator please look');
		expect([...sent.body.mentions].sort()).toEqual(['grace', 'margaret']);
		// The timeline draws it as the role, not as `@&moderator`.
		await expect(preview.message('@moderator please look').locator('.ap-mention-role')).toHaveText('@moderator');
	});

	test('a typed @&role becomes a chip once finished, and @& lists roles alone', async ({ preview, page }) => {
		await preview.open();
		await preview.composer().click();
		await page.keyboard.type('@&');
		await expect(picker(preview).getByRole('option')).toHaveText([/@moderator/, /@admin/]);
		await page.keyboard.type('admin ok');
		await expect(preview.composer().locator('.ap-mention-role')).toHaveText('@admin');
		await page.keyboard.press('Enter');
		const sent = await preview.waitForSent('message', (p) => p.body?.text === '@&admin ok');
		expect(sent.body.mentions).toEqual(['ada']);
	});
});

test.describe('mentions in the message editor', () => {
	test.use(DEVICES.desktop);

	test('an edit shows its mentions as chips, autocompletes @ as the composer does, and saves body.mentions', async ({ preview, page }) => {
		await preview.open();
		await preview.composer().click();
		await page.keyboard.type('@ad');
		await page.keyboard.press('Tab');
		await page.keyboard.type('hello');
		await page.keyboard.press('Enter');
		const mine = preview.message('@Ada Lovelace hello');
		await expect(mine).toBeVisible();
		await expect(async () => {
			await mine.hover();
			await expect(mine.getByRole('button', { name: 'Edit message', exact: true })).toBeVisible({ timeout: 1000 });
		}).toPass();
		await mine.getByRole('button', { name: 'Edit message', exact: true }).click();

		const editor = page.getByRole('textbox', { name: 'Edit message', exact: true });
		await expect(editor).toBeFocused();
		await expect(editor.locator('.ap-mention[data-user-id="ada"]')).toHaveText('@Ada Lovelace');
		// `x` is a letter here, not the row's Select.
		await page.keyboard.type(' fixed and @');
		const options = page.getByTestId('message-editor').getByRole('option');
		await expect(options.first()).toBeVisible();
		const other = (await options.nth(1).locator('.ap-mpick-id').textContent())!.trim().replace(/^@/, '');
		await page.keyboard.press('ArrowDown');
		await page.keyboard.press('Tab');
		await expect(editor.locator(`.ap-mention[data-user-id="${other}"]`)).toHaveCount(1);
		// Escape with no picker open cancels; with one open, it only closes the picker.
		await page.keyboard.type('@');
		await expect(options.first()).toBeVisible();
		await page.keyboard.press('Escape');
		await expect(options).toHaveCount(0);
		await expect(editor).toBeVisible();
		await page.keyboard.press('Backspace');
		await page.keyboard.press('Enter');

		const edit = await preview.waitForSent('message', (p) => p.message_id !== undefined);
		expect(edit.body).toMatchObject({ text: `@ada hello fixed and @${other} `, mentions: ['ada', other] });
	});
});

test.describe('the message editor\u2019s picker', () => {
	test.use({ viewport: { width: 1280, height: 480 } });

	test('opens below the field where the timeline has no room above it, and stays in view', async ({ preview, page }) => {
		await preview.open();
		await preview.composer().click();
		await page.keyboard.type('edit me');
		await page.keyboard.press('Enter');
		const mine = preview.message('edit me');
		await expect(mine).toBeVisible();
		// Messages after it, so it can be scrolled to the top of the timeline and edited there.
		for (const word of ['filler 1', 'filler 2', 'filler 3', 'filler 4', 'filler 5', 'filler 6', 'filler 7', 'filler 8']) {
			await page.keyboard.type(word);
			await page.keyboard.press('Enter');
			await expect(preview.message(word)).toBeVisible();
		}
		await mine.evaluate((row) => row.scrollIntoView({ block: 'start' }));
		await expect(async () => {
			await mine.hover();
			await expect(mine.getByRole('button', { name: 'Edit message', exact: true })).toBeVisible({ timeout: 1000 });
		}).toPass();
		await mine.getByRole('button', { name: 'Edit message', exact: true }).click();
		const editor = page.getByRole('textbox', { name: 'Edit message', exact: true });
		await editor.evaluate((field) => field.scrollIntoView({ block: 'start' }));
		await expect(editor).toBeFocused();
		await page.keyboard.type(' @');
		const list = page.getByTestId('message-editor').getByRole('listbox');
		await expect(list).toBeVisible();
		const [box, timeline] = await Promise.all([list.boundingBox(), page.locator('.ap-timeline').boundingBox()]);
		expect(box!.y).toBeGreaterThanOrEqual(timeline!.y);
		await expect(list).toHaveClass(/ap-mpick-below/);
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
