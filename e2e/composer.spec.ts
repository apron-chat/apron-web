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

test.describe('mentions in the composer and the message editor', () => {
	test.use(DEVICES.desktop);

	test('a mention picked with Tab or the arrow keys goes out in body.mentions, Escape and Backspace give back text, and an edit keeps and adds mentions', async ({ preview, page }) => {
		await preview.open();

		await test.step('a mention picked with Tab goes out as @user_id and in body.mentions', async () => {
			await preview.composer().click();
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

		await test.step('the arrow keys move through the matches, and Tab picks the active one', async () => {
			await preview.composer().click();
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
			// The previous step's message has mentions too: this one is the one that ends in `there`.
			expect(await preview.waitForSent('message', (p) => p.body?.mentions?.length && p.body.text.endsWith('there'))).toMatchObject({ body: { text: `@${second} there`, mentions: [second] } });
		});

		await test.step('Escape dismisses the picker, and Enter then sends the text as typed', async () => {
			await preview.composer().click();
			await page.keyboard.type('@ad');
			await expect(picker(preview)).toBeVisible();
			await page.keyboard.press('Escape');
			await expect(picker(preview)).toBeHidden();
			await page.keyboard.press('Enter');

			const sent = await preview.waitForSent('message', (p) => p.body?.text === '@ad');
			expect(sent.body.mentions ?? []).toEqual([]);
			await expect(preview.composer()).toHaveText('');
		});

		await test.step('Backspace right after a chip gives back the name as text to edit', async () => {
			await preview.composer().click();
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

		await test.step('an edit shows its mentions as chips, autocompletes @ as the composer does, and saves body.mentions', async () => {
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

			// The only edit sent.
			const edit = await preview.waitForSent('message', (p) => p.message_id !== undefined);
			expect(edit.body).toMatchObject({ text: `@ada hello fixed and @${other} `, mentions: ['ada', other] });
		});
	});
});

test.describe('line breaks in the composer', () => {
	test.use(DEVICES.desktop);

	test('a blank line typed between two goes out, so the message has two paragraphs', async ({ preview, page }) => {
		await preview.open();
		await preview.composer().click();
		await page.keyboard.type('one');
		await page.keyboard.press('Shift+Enter');
		await page.keyboard.type('two');
		await page.keyboard.press('Shift+Enter');
		await page.keyboard.press('Shift+Enter');
		await page.keyboard.type('three');
		await page.keyboard.press('Enter');
		expect((await preview.waitForSent('message', (p) => p.body?.text?.endsWith('three'))).body.text).toBe('one\ntwo\n\nthree');
		await expect(page.locator('.ap-msg-text').last().locator('p')).toHaveCount(2);
	});
});

test.describe('role mentions in the composer', () => {
	test.use({ ...DEVICES.desktop, knobs: { people: { grace: { roles: ['moderator'] } } } });

	test('a role picked or typed as @&role is a chip, goes out as @&role, and mentions everyone else here who holds it', async ({ preview, page }) => {
		await preview.open();

		await test.step('a picked role is a chip, and mentions everyone else here who holds it', async () => {
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

		await test.step('a typed @&role becomes a chip once finished, and @& lists roles alone', async () => {
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
		for (let n = 1; n <= 8; n++) await preview.post('general', 'grace', `filler ${n}`);
		await expect(preview.message('filler 8')).toBeVisible();
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

test.describe('files pasted outside the composer', () => {
	test.use({ ...DEVICES.desktop, knobs: { capabilities: ['embed:upload'] } });

	test('attach to the draft from the timeline, but not from a field in the emoji picker', async ({ preview, page }) => {
		await preview.open();
		/**
		 * Pastes a file, as a paste of a copied file would, in the emoji picker's search field (in emoji-mart's shadow
		 * root: the event leaves it addressed to the picker's element), or on the timeline.
		 */
		const paste = (inPicker: boolean) => page.evaluate((inPicker) => {
			const data = new DataTransfer();
			data.items.add(new File(['hello'], 'notes.txt', { type: 'text/plain' }));
			const target = inPicker ? document.querySelector('em-emoji-picker')!.shadowRoot!.querySelector('input[type="search"]')! : document.querySelector('[data-testid="message-list"]')!;
			target.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, composed: true, cancelable: true }));
		}, inPicker);
		const message = page.locator('article[data-message-id]').last();
		const react = message.getByRole('button', { name: 'React', exact: true });
		await expect(async () => {
			await message.hover();
			await expect(react).toBeVisible({ timeout: 1000 });
		}).toPass();
		await react.click();
		const emoji = page.getByRole('dialog', { name: 'Emoji picker', exact: true });
		await expect(emoji).toHaveAttribute('data-state', 'ready');
		await paste(true);
		await page.keyboard.press('Escape');
		await expect(emoji).toHaveCount(0);
		await expect(page.getByTestId('staged-files')).toHaveCount(0);
		await paste(false);
		await expect(page.getByTestId('staged-files')).toBeVisible();
	});
});

test.describe('a draft past one line', () => {
	test('takes the box\'s width with the buttons in a row under it, once it wraps or breaks, and goes back to one row', async ({ preview, page }) => {
		const form = page.locator('form.ap-composer');
		const errors: string[] = [];
		page.on('pageerror', (error) => errors.push(error.message));
		await preview.open();
		await preview.composer().click();
		await page.keyboard.type('Canary looks healthy');
		await expect(form).not.toHaveClass(/ap-composer-grown/);
		// Wrapping onto a second line, with no line break.
		await page.keyboard.type(', rolling to the fleet in two waves after lunch, and watching p99 latency and the error rate as we go along');
		await expect(form).toHaveClass(/ap-composer-grown/);
		const [field, box] = await Promise.all([preview.composer().boundingBox(), form.boundingBox()]);
		expect(field!.width).toBeGreaterThan(box!.width * 0.9);
		await expect(page.getByTestId('composer-expand')).toHaveCount(0);
		// A line break: Expand too, and still the row under it.
		await page.keyboard.press('Shift+Enter');
		await page.keyboard.type('Roll back if 5xx goes over 0.5%');
		await expect(page.getByTestId('composer-expand')).toBeVisible();
		await expect(form).toHaveClass(/ap-composer-grown/);
		// Short again: one row.
		await page.keyboard.press('ControlOrMeta+a');
		await page.keyboard.press('Backspace');
		await page.keyboard.type('Short again');
		await expect(form).not.toHaveClass(/ap-composer-grown/);
		expect(errors).toEqual([]);
	});
});

test.describe('the full panel', () => {
	test.use(DEVICES.desktop);

	const panel = (preview: Preview) => preview.page.getByTestId('composer-panel');
	/** The field's text, its line breaks included (an element, which textContent leaves out). */
	const written = (preview: Preview) => preview.composer().evaluate((el) => (el as HTMLElement).innerText.replace(/\n$/, ''));

	test('opens from Expand once a draft has two lines, keeps the caret, formats with its toolbar, previews, and sends with Ctrl+Enter', async ({ preview, page }) => {
		await preview.open();
		await preview.composer().click();
		await page.keyboard.type('first @ad');
		await expect(picker(preview).getByRole('option').first()).toHaveText(/Ada Lovelace/);
		await page.keyboard.press('Tab');
		await expect(chip(preview)).toHaveAttribute('data-user-id', 'ada');
		// Picking a mention puts a space after it.
		await page.keyboard.type('line');
		await expect(page.getByTestId('composer-expand')).toHaveCount(0);
		await page.keyboard.press('Shift+Enter');
		await expect(page.getByTestId('composer-expand')).toBeVisible();
		await page.keyboard.type('second line');

		await test.step('Expand opens the panel under a strip of the conversation, the caret where it was', async () => {
			await page.keyboard.press('ControlOrMeta+Home');
			await page.getByTestId('composer-expand').click();
			await expect(panel(preview)).toBeVisible();
			await expect(preview.composer()).toBeFocused();
			const header = (await page.locator('.ap-roomhead').boundingBox())!;
			const timeline = (await page.getByTestId('message-list').boundingBox())!;
			const box = (await panel(preview).boundingBox())!;
			expect(timeline.y).toBeGreaterThanOrEqual(header.y + header.height - 1);
			expect(box.y).toBeGreaterThanOrEqual(timeline.y + timeline.height - 1);
			// The same field: typing goes in at the start, where the caret was before it opened.
			await page.keyboard.type('The ');
			await expect.poll(() => written(preview)).toBe('The first @Ada Lovelace line\nsecond line');
		});

		await test.step('Quote prefixes every selected line and keeps the mention a chip; pressed again, it takes the quote off', async () => {
			await page.keyboard.press('ControlOrMeta+A');
			await panel(preview).getByRole('button', { name: 'Quote' }).click();
			await expect.poll(() => written(preview)).toBe('> The first @Ada Lovelace line\n> second line');
			await expect(chip(preview)).toHaveAttribute('data-user-id', 'ada');
			// The lines stay selected: a second press takes the quote off, a third puts it back.
			await panel(preview).getByRole('button', { name: 'Quote' }).click();
			await expect.poll(() => written(preview)).toBe('The first @Ada Lovelace line\nsecond line');
			await panel(preview).getByRole('button', { name: 'Quote' }).click();
			await expect.poll(() => written(preview)).toBe('> The first @Ada Lovelace line\n> second line');
		});

		await test.step('Enter starts a line rather than sending, a list carries on, and Bold wraps the selection', async () => {
			await page.keyboard.press('ControlOrMeta+End');
			await page.keyboard.press('Enter');
			await page.keyboard.press('Enter');
			await page.keyboard.type('- canary');
			// The next item's `- ` is there already.
			await page.keyboard.press('Enter');
			await page.keyboard.type('fleet');
			for (let i = 0; i < 'fleet'.length; i++) await page.keyboard.press('Shift+ArrowLeft');
			await panel(preview).getByRole('button', { name: 'Bold' }).click();
			await expect.poll(() => written(preview)).toBe('> The first @Ada Lovelace line\n> second line\n\n- canary\n- **fleet**');
			expect(await sentWithText(preview, 'first')).toEqual([]);
		});

		await test.step('Preview shows the draft as its message will show', async () => {
			await panel(preview).getByRole('radio', { name: 'Preview' }).click();
			const shown = page.getByTestId('draft-preview');
			await expect(shown.locator('blockquote')).toContainText('second line');
			await expect(shown.locator('li')).toHaveText(['canary', 'fleet']);
			await expect(shown.locator('li strong')).toHaveText('fleet');
			await panel(preview).getByRole('radio', { name: 'Write' }).click();
			await expect(preview.composer()).toBeVisible();
		});

		await test.step('Ctrl+Enter sends it, mention and all, and the panel closes', async () => {
			await preview.composer().click();
			await page.keyboard.press('ControlOrMeta+Enter');
			const sent = await preview.waitForSent('message', (p) => p.body?.text?.endsWith('**fleet**'));
			expect(sent.body).toMatchObject({ text: '> The first @ada line\n> second line\n\n- canary\n- **fleet**', mentions: ['ada'] });
			await expect(panel(preview)).toBeHidden();
			await expect(preview.composer()).toHaveText('');
		});
	});

	test('takes three quarters of the pane, the latest messages in view above it, and what arrives there is read', async ({ preview, page }) => {
		const unread = page.locator('[data-testid="room-list"] button[data-room="general"]').getByTestId('room-unread');
		await preview.open();
		await preview.post('general', 'ada', 'Before writing');
		await expect(preview.message('Before writing')).toBeInViewport();
		await preview.composer().click();
		await page.keyboard.type('one');
		await page.keyboard.press('Shift+Enter');
		await page.keyboard.type('two');
		await page.getByTestId('composer-expand').click();
		await expect(panel(preview)).toBeVisible();

		await test.step('the timeline stays at its latest above the panel', async () => {
			const pane = (await page.locator('main.ap-shell-main').boundingBox())!;
			const box = (await panel(preview).boundingBox())!;
			expect(Math.abs(box.height - pane.height * 0.75)).toBeLessThan(2);
			await expect(preview.message('Before writing')).toBeInViewport();
		});

		await test.step('what arrives shows above it, read, as anywhere at the latest', async () => {
			await preview.post('general', 'ada', 'Arrived while writing');
			await expect(preview.message('Arrived while writing')).toBeInViewport();
			await preview.openRoom('engineering');
			await expect(unread).toHaveCount(0);
		});
	});

	test('leaves a few lines of the timeline in a short pane', async ({ preview, page }) => {
		await page.setViewportSize({ width: 1280, height: 420 });
		await preview.open();
		await preview.composer().click();
		await page.keyboard.type('one');
		await page.keyboard.press('Shift+Enter');
		await page.keyboard.type('two');
		await page.getByTestId('composer-expand').click();
		const pane = (await page.locator('main.ap-shell-main').boundingBox())!;
		const header = (await page.locator('.ap-roomhead').boundingBox())!;
		const box = (await panel(preview).boundingBox())!;
		// Capped at the pane less its header and three 32px lines, short of three quarters here.
		expect(box.height).toBeLessThan(pane.height * 0.75);
		expect(Math.round(pane.height - header.height - box.height)).toBeGreaterThanOrEqual(96);
	});

	test('shows the ask to add who a draft mentions above it, and closes once the draft is sent from the ask', async ({ preview, page }) => {
		await preview.open();
		await preview.openRoom('engineering');
		await preview.composer().click();
		await page.keyboard.type('@grace hi');
		await page.keyboard.press('Shift+Enter');
		await page.keyboard.type('the plan is below');
		await page.getByTestId('composer-expand').click();
		await expect(panel(preview)).toBeVisible();
		await page.keyboard.press('ControlOrMeta+Enter');
		const prompt = page.getByTestId('mention-add-prompt');
		await expect(prompt).toBeInViewport();
		await prompt.getByRole('button', { name: 'Send without adding' }).click();
		await preview.waitForSent('message', (p) => p.body?.text === '@grace hi\nthe plan is below');
		await expect(panel(preview)).toBeHidden();
		await expect(preview.composer()).toHaveText('');
	});

	test('Esc closes it with the draft kept', async ({ preview, page }) => {
		await preview.open();
		await preview.composer().click();
		await page.keyboard.type('one');
		await page.keyboard.press('Shift+Enter');
		await page.keyboard.type('two');
		await page.getByTestId('composer-expand').click();
		await expect(panel(preview)).toBeVisible();
		await page.keyboard.press('Escape');
		await expect(panel(preview)).toBeHidden();
		await expect(preview.composer()).toBeFocused();
		expect(await written(preview)).toBe('one\ntwo');
	});
});

test.describe('the full panel on a phone', () => {
	test.use(DEVICES.phone);

	test('fills the pane below the header, and Send sends', async ({ preview, page }) => {
		await preview.open();
		await preview.press(preview.composer());
		await page.keyboard.type('one');
		await page.keyboard.press('Enter');
		await page.keyboard.type('two');
		await preview.press(page.getByTestId('composer-expand'));
		const box = await page.getByTestId('composer-panel').boundingBox();
		const viewport = page.viewportSize()!;
		expect(Math.round(box!.y + box!.height)).toBeLessThanOrEqual(viewport.height);
		expect(box!.height).toBeGreaterThan(viewport.height / 2);
		await preview.press(page.getByRole('button', { name: 'Send message', exact: true }));
		await preview.waitForSent('message', (p) => p.body?.text === 'one\ntwo');
		await expect(page.getByTestId('composer-panel')).toBeHidden();
	});
});
