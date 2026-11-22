import { NOW } from '../scripts/qa/lib/helpers.js';
import { PREVIEW_WAIT_MS } from '../src/lib/ui/link-previews';
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

test.describe('a command in the composer', () => {
	test.use(DEVICES.desktop);

	test('turns off capitals, corrections and spelling marks while the Command tag shows, and goes to the server as typed', async ({ preview, page }) => {
		await preview.open();
		const field = preview.composer();
		const attributes = () => field.evaluate((element) => ['autocapitalize', 'autocorrect', 'spellcheck'].map((name) => element.getAttribute(name)));
		await field.click();
		expect(await attributes()).toEqual([null, null, 'true']);
		await page.keyboard.type('/');
		await expect(page.getByTestId('command-tag')).toBeVisible();
		expect(await attributes()).toEqual(['none', 'off', 'false']);
		await page.keyboard.type('/');
		await expect(page.getByTestId('command-tag')).toHaveCount(0);
		expect(await attributes()).toEqual([null, null, 'true']);
		await page.keyboard.press('Backspace');
		expect(await attributes()).toEqual(['none', 'off', 'false']);
		// Names are case-sensitive: `/NICK Ada` is no `/nick`, so it goes to the server as a command, not as `me`.
		await page.keyboard.type('NICK Ada');
		await page.keyboard.press('Enter');
		await preview.waitForSent('command', (params) => params.body?.text === '/NICK Ada');
		expect((await preview.sent('me')).filter((params) => params.name === 'Ada')).toEqual([]);
		// The server knows no `NICK` and gives the draft back; emptied, the field is a message's again.
		await field.click();
		await page.keyboard.press('ControlOrMeta+a');
		await page.keyboard.press('Backspace');
		await expect(page.getByTestId('command-tag')).toHaveCount(0);
		expect(await attributes()).toEqual([null, null, 'true']);
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
		for (let n = 1; n <= 16; n++) await preview.post('general', 'grace', `filler ${n}`);
		await expect(preview.message('filler 16')).toBeVisible();
		await mine.evaluate((row) => row.scrollIntoView({ block: 'start' }));
		await expect(async () => {
			await mine.hover();
			await expect(mine.getByRole('button', { name: 'Edit message', exact: true })).toBeVisible({ timeout: 1000 });
		}).toPass();
		await mine.getByRole('button', { name: 'Edit message', exact: true }).click();
		const editor = page.getByRole('textbox', { name: 'Edit message', exact: true });
		await expect(editor).toBeFocused();
		await page.keyboard.type(' @');
		const list = page.getByTestId('message-editor').getByRole('listbox');
		await expect(list).toBeVisible();
		const [box, timeline] = await Promise.all([list.boundingBox(), page.locator('.ap-timeline').boundingBox()]);
		// Whole in the timeline that clips it, below the field, which opening it didn't move.
		expect(box!.y).toBeGreaterThanOrEqual(timeline!.y);
		expect(box!.y + box!.height).toBeLessThanOrEqual(timeline!.y + timeline!.height);
		await expect(list).toHaveClass(/ap-mpick-below/);
		expect((await editor.boundingBox())!.y).toBeLessThan(box!.y);
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
	test('takes the box\'s width with the buttons in a row under it, by wrapping or a line break, and settles back to one row', async ({ preview, page }) => {
		const form = page.locator('form.ap-composer');
		const errors: string[] = [];
		page.on('pageerror', (error) => errors.push(error.message));
		await page.setViewportSize({ width: 900, height: 700 });
		await preview.open();
		await preview.composer().click();
		await page.keyboard.type('Canary looks healthy');
		await expect(form).not.toHaveClass(/ap-composer-grown/);

		await test.step('wrapping onto a second line grows it, with no Expand', async () => {
			await page.keyboard.type(', rolling to the fleet in two waves after lunch, and watching p99 latency');
			await expect(form).toHaveClass(/ap-composer-grown/);
			const [field, box] = await Promise.all([preview.composer().boundingBox(), form.boundingBox()]);
			expect(field!.width).toBeGreaterThan(box!.width * 0.9);
			await expect(page.getByTestId('composer-expand')).toHaveCount(0);
		});

		await test.step('a line break offers Expand, and it stays grown', async () => {
			await page.keyboard.press('Shift+Enter');
			await page.keyboard.type('Roll back if 5xx goes over 0.5%');
			await expect(page.getByTestId('composer-expand')).toBeVisible();
			await expect(form).toHaveClass(/ap-composer-grown/);
		});

		await test.step('a pasted paragraph deleted key by key goes back to one row without flipping on every key', async () => {
			await page.keyboard.press('ControlOrMeta+a');
			await page.keyboard.insertText('Canary looks healthy, rolling to the fleet in two waves after lunch, watching p99 latency and the error rate as we go, and rolling back if 5xx goes over half a percent.');
			await expect(form).toHaveClass(/ap-composer-grown/);
			await form.evaluate((el) => {
				const w = window as unknown as { flips: number };
				w.flips = 0;
				new MutationObserver(() => w.flips++).observe(el, { attributes: true, attributeFilter: ['class'] });
			});
			await page.keyboard.press('End');
			for (let i = 0; i < 150; i++) await page.keyboard.press('Backspace');
			await expect(form).not.toHaveClass(/ap-composer-grown/);
			expect(await page.evaluate(() => (window as unknown as { flips: number }).flips)).toBeLessThanOrEqual(5);
		});

		await test.step('grown in a narrow pane, it goes back to one row as the pane widens', async () => {
			await page.keyboard.press('ControlOrMeta+a');
			await page.keyboard.insertText('Canary looks healthy, rolling to the fleet in two waves after lunch');
			await page.setViewportSize({ width: 600, height: 700 });
			await expect(form).toHaveClass(/ap-composer-grown/);
			await page.setViewportSize({ width: 1400, height: 700 });
			await expect(form).not.toHaveClass(/ap-composer-grown/);
		});
		expect(errors).toEqual([]);
	});
});

test.describe('a long draft on a small phone with its keyboard up', () => {
	// An iPhone SE's screen less its keyboard: too short for the header, the description and a 200px field.
	test.use({ ...DEVICES.phone, viewport: { width: 375, height: 330 } });

	test('shrinks the composer to fit, its field scrolled to the line being written, Send in view', async ({ preview, page }) => {
		await preview.open();
		await preview.press(preview.composer());
		const words = 'one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty';
		await page.keyboard.type(`${words} ${words} ${words} the end`);
		const pane = (await page.locator('main.ap-shell-main').boundingBox())!;
		const box = (await page.locator('form.ap-composer').boundingBox())!;
		expect(box.y + box.height).toBeLessThanOrEqual(pane.y + pane.height);
		await expect(page.getByRole('button', { name: 'Send message', exact: true })).toBeInViewport({ ratio: 1 });
		const { caret, field } = await preview.composer().evaluate((el) => {
			const rect = getSelection()!.getRangeAt(0).getBoundingClientRect();
			const own = el.getBoundingClientRect();
			return { caret: { top: rect.top, bottom: rect.bottom }, field: { top: own.top, bottom: own.bottom, scrolled: el.scrollTop } };
		});
		expect(field.scrolled).toBeGreaterThan(0);
		expect(caret.top).toBeGreaterThanOrEqual(field.top);
		expect(caret.bottom).toBeLessThanOrEqual(field.bottom + 1);
	});
});

test.describe('a room’s description and a long draft on a phone', () => {
	const description = 'Welcome to the demo server. Messages expire after a month.\n\n- Guests are read-only. Create an account with a passkey to post.\n- Use `/invite-device` to get a login link for another device.\n- Be kind.';
	test.use({ ...DEVICES.phone, viewport: { width: 375, height: 667 }, knobs: { rooms: { general: { description } } } });

	test('makes way while the window is short and the draft is past one line, and comes back as either ends', async ({ preview, page }) => {
		// A stand-in for the visual viewport, which what covers the bottom of the page shrinks (`trackKeyboard`): an iPhone
		// SE's keyboard, 337px, or a tablet's shortcut bar over a hardware keyboard. The window itself stays as tall.
		await page.addInitScript(() => {
			const viewport = Object.assign(new EventTarget(), { height: innerHeight, offsetTop: 0, scale: 1 });
			Object.defineProperty(window, 'visualViewport', { value: viewport, configurable: true });
			(window as unknown as { cover: (px: number) => void }).cover = (px) => {
				viewport.height = innerHeight - px;
				viewport.dispatchEvent(new Event('resize'));
			};
		});
		const cover = (px: number) => page.evaluate((by) => (window as unknown as { cover: (px: number) => void }).cover(by), px);
		/** How far the composer runs past what the keyboard leaves on screen (none: 0 or less). */
		const under = () => page.locator('form.ap-composer').evaluate((form) => form.getBoundingClientRect().bottom - window.visualViewport!.height);
		const pinned = page.getByTestId('pane-description');
		const words = 'one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty';
		await preview.open();
		await preview.press(preview.composer());
		await page.keyboard.type('one line');

		await test.step('one line with the keyboard up: it stays', async () => {
			await cover(337);
			await expect(page.locator('html')).toHaveAttribute('data-keyboard', '');
			await expect(pinned).toBeVisible();
		});

		await test.step('past one line: it makes way, and the field has its full 200px above the keyboard', async () => {
			await page.keyboard.type(` ${words} ${words} ${words} the end`);
			await expect(page.locator('form.ap-composer')).toHaveClass(/ap-composer-grown/);
			await expect(pinned).toHaveCount(0);
			await expect.poll(async () => (await preview.composer().boundingBox())!.height).toBeGreaterThanOrEqual(199);
			expect(await under()).toBeLessThanOrEqual(0);
		});

		await test.step('the full panel opening and closing keeps the line being written in view, after a line break too', async () => {
			// The caret is at the end: the field is scrolled to its foot, within half a line (the caret's box is the text's, not its line's).
			const atFoot = () => preview.composer().evaluate((el) => (el.scrollHeight - el.clientHeight - el.scrollTop) / parseFloat(getComputedStyle(el).lineHeight));
			await page.keyboard.press('Enter');
			await page.keyboard.type('a second paragraph');
			await preview.press(page.getByTestId('composer-expand'));
			await expect(page.getByTestId('composer-panel')).toBeVisible();
			await expect.poll(atFoot).toBeLessThan(0.5);
			expect(await under()).toBeLessThanOrEqual(0);
			await page.keyboard.press('Enter');
			await preview.press(page.getByRole('button', { name: 'Collapse composer' }));
			await expect(page.getByTestId('composer-panel')).toBeHidden();
			await expect.poll(atFoot).toBeLessThan(0.5);
			await expect(pinned).toHaveCount(0);
		});

		await test.step('only a shortcut bar over the bottom, the window tall enough for both: it comes back, with the draft as it was', async () => {
			await cover(60);
			await expect(page.locator('html')).toHaveAttribute('data-keyboard', '');
			await expect(pinned).toBeVisible();
			await expect(preview.composer()).toContainText('the end');
			expect(await under()).toBeLessThanOrEqual(0);
		});

		await test.step('the keyboard down: it stays', async () => {
			await cover(0);
			await expect(page.locator('html')).not.toHaveAttribute('data-keyboard');
			await expect(pinned).toBeVisible();
		});
	});
});

test.describe('a room’s description and the full panel', () => {
	test.use({ ...DEVICES.desktop, knobs: { rooms: { general: { description: 'Say hello.' } } } });

	test('makes way while it is open, and comes back as the composer goes for a selection', async ({ preview, page }) => {
		const pinned = page.getByTestId('pane-description');
		await preview.open();
		await preview.composer().click();
		await page.keyboard.type('pick me');
		await page.keyboard.press('Enter');
		await expect(preview.message('pick me')).toBeVisible();
		await page.keyboard.type('one');
		await page.keyboard.press('Shift+Enter');
		await page.keyboard.type('two');
		await page.getByTestId('composer-expand').click();
		await expect(pinned).toHaveCount(0);
		await preview.message('pick me').click({ modifiers: ['Shift'] });
		await expect(page.getByTestId('selection-bar')).toContainText('1 message selected');
		await expect(page.getByTestId('composer-panel')).toHaveCount(0);
		await expect(pinned).toBeVisible();
	});
});

test.describe('a room’s description', () => {
	test('is written as in the composer: mentions as chips from the picker, formatting, Preview, and Ctrl+Enter saves', async ({ preview, page }) => {
		const errors: string[] = [];
		page.on('pageerror', (error) => errors.push(error.message));
		await preview.open();
		await page.getByTestId('room-actions').click();
		await page.getByTestId('edit-room').click();
		const dialog = page.getByRole('dialog', { name: 'Edit room', exact: true });
		const field = dialog.getByRole('textbox', { name: 'Room description', exact: true });
		await field.click();
		await page.keyboard.press('ControlOrMeta+a');
		await page.keyboard.press('Backspace');
		await page.keyboard.type('Ask @ad');
		const list = page.getByTestId('description-picker');
		await expect(list.getByRole('option').first()).toHaveText(/Ada Lovelace/);
		// The picker shows whole, in the window, over the dialog rather than cut off by it.
		const [box, viewport] = [await list.boundingBox(), page.viewportSize()!];
		expect(box!.y).toBeGreaterThanOrEqual(0);
		expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
		// Escape closes the picker, not the dialog.
		await page.keyboard.press('Escape');
		await expect(list).toHaveCount(0);
		await expect(dialog).toBeVisible();
		await page.keyboard.type('a');
		await expect(list.getByRole('option').first()).toHaveText(/Ada Lovelace/);
		await page.keyboard.press('Tab');
		await expect(field.locator('.ap-mention[data-user-id="ada"]')).toBeVisible();
		// Enter starts a line, and a list carries on.
		await page.keyboard.type('about deploys');
		await page.keyboard.press('Enter');
		await page.keyboard.type('- canary');
		await page.keyboard.press('Enter');
		await page.keyboard.type('fleet');
		for (let i = 0; i < 'fleet'.length; i++) await page.keyboard.press('Shift+ArrowLeft');
		await dialog.getByRole('button', { name: 'Bold', exact: true }).click();
		await dialog.getByRole('radio', { name: 'Preview', exact: true }).click();
		const rendered = dialog.getByTestId('draft-preview');
		await expect(rendered.locator('strong')).toHaveText('fleet');
		await expect(rendered.locator('.ap-mention')).toContainText('Ada Lovelace');
		await dialog.getByRole('radio', { name: 'Write', exact: true }).click();
		await expect(field).toBeFocused();
		await page.keyboard.press('ControlOrMeta+Enter');
		const saved = await preview.waitForSent('room_set', (p) => p.room_id === 'general');
		expect(saved.description).toBe('Ask @ada about deploys\n- canary\n- **fleet**');
		await expect(dialog).toHaveCount(0);
		await expect(page.getByTestId('pane-description').locator('strong')).toHaveText('fleet');
		expect(errors).toEqual([]);
	});
});

test.describe('the full panel', () => {
	test.use(DEVICES.desktop);

	const panel = (preview: Preview) => preview.page.getByTestId('composer-panel');
	/** The field's text, its line breaks included (an element, which textContent leaves out). */
	const written = (preview: Preview) => preview.composer().evaluate((el) => (el as HTMLElement).innerText.replace(/\n$/, ''));

	test('its formatting toolbar is one Tab stop, the arrows moving through its groups', async ({ preview, page }) => {
		await preview.open();
		await preview.composer().click();
		await page.keyboard.type('notes');
		await page.keyboard.press('Shift+Enter');
		await page.getByTestId('composer-expand').click();
		const toolbar = panel(preview).getByRole('toolbar', { name: 'Formatting' });
		await expect(toolbar.getByRole('group', { name: 'Lists' }).getByRole('button')).toHaveCount(4);
		await toolbar.getByRole('button', { name: 'Bold', exact: true }).focus();
		await page.keyboard.press('ArrowRight');
		await expect(toolbar.getByRole('button', { name: 'Italic' })).toBeFocused();
		await page.keyboard.press('End');
		await expect(toolbar.getByRole('button', { name: 'Code block' })).toBeFocused();
		await page.keyboard.press('ArrowRight');
		await expect(toolbar.getByRole('button', { name: 'Bold', exact: true })).toBeFocused();
		await page.keyboard.press('ArrowLeft');
		await expect(toolbar.getByRole('button', { name: 'Code block' })).toBeFocused();
		// Tab leaves it, rather than stepping through its other ten; Shift+Tab comes back to where it was.
		await page.keyboard.press('Tab');
		expect(await toolbar.evaluate((bar) => bar.contains(document.activeElement))).toBe(false);
		await page.keyboard.press('Shift+Tab');
		await expect(toolbar.getByRole('button', { name: 'Code block' })).toBeFocused();
	});

	test('opens from Expand on a draft of two lines, keeps the caret, formats with its toolbar, previews, and sends with Ctrl+Enter', async ({ preview, page }) => {
		await preview.open();
		await preview.composer().click();
		await page.keyboard.type('first @ad');
		await expect(picker(preview).getByRole('option').first()).toHaveText(/Ada Lovelace/);
		await page.keyboard.press('Tab');
		await expect(chip(preview)).toHaveAttribute('data-user-id', 'ada');
		// Picking a mention puts a space after it.
		await page.keyboard.type('line');
		await page.keyboard.press('Shift+Enter');
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

	test('shows the line offering to add who a draft mentions above it, and closes once the draft is sent', async ({ preview, page }) => {
		await preview.open();
		await preview.openRoom('engineering');
		await preview.composer().click();
		// A role no one here holds: the line names its holders.
		await page.keyboard.type('@&moderator hi ');
		await page.keyboard.press('Shift+Enter');
		await page.keyboard.type('the plan is below');
		await page.getByTestId('composer-expand').click();
		await expect(panel(preview)).toBeVisible();
		const line = page.getByTestId('mention-outside-hint');
		await expect(line).toBeInViewport();
		await expect(line).toContainText('Margaret Hamilton (moderator)');
		await line.getByTestId('mention-outside-add').uncheck();
		await preview.composer().click();
		await page.keyboard.press('ControlOrMeta+Enter');
		await preview.waitForSent('message', (p) => p.body?.text?.startsWith('@&moderator hi'));
		await expect(panel(preview)).toBeHidden();
		await expect(preview.composer()).toHaveText('');
		expect(await preview.sent('room_join')).toEqual([]);
	});

	test('offers people who aren’t in the room last, faded, and Send adds them first, as the line over the composer says', async ({ preview, page }) => {
		await preview.open();
		await preview.openRoom('engineering');
		await preview.composer().click();
		await page.keyboard.type('@gr');
		const grace = picker(preview).getByRole('option', { name: /Grace/ });
		await expect(grace).toHaveClass(/ap-mpick-out/);
		await expect(grace).toContainText('Not in room');
		await page.keyboard.press('Tab');
		await expect(chip(preview)).toHaveAttribute('data-user-id', 'grace');
		const hint = page.getByTestId('mention-outside-hint');
		await expect(hint).toContainText('Not in this room, add them so they’ll see the mention? Grace Hopper');
		await expect(hint.getByTestId('mention-outside-add')).toBeChecked();
		await page.keyboard.type('hi');
		await page.keyboard.press('Enter');
		await preview.waitForSent('room_join', (p) => p.user_id === 'grace');
		await preview.waitForSent('message', (p) => p.body?.mentions?.includes('grace'));
		await expect(hint).toBeHidden();
		await expect(preview.composer()).toBeFocused();
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

test.describe('the full panel on a small phone with its keyboard up', () => {
	const description = 'Welcome to the demo server. Messages expire after a month.\n\n- Guests are read-only. Create an account with a passkey to post.\n- Use `/invite-device` to get a login link for another device.\n- Be kind.';
	// An iPhone SE's screen less its keyboard, and a description long enough to take the timeline's few lines.
	test.use({ ...DEVICES.phone, viewport: { width: 375, height: 330 }, knobs: { rooms: { general: { description } } } });

	test('puts the room’s description away while it is open, keeps its foot in view, and brings the description back once the draft is sent', async ({ preview, page }) => {
		await preview.open();
		await expect(page.getByTestId('pane-description')).toBeVisible();
		await preview.press(preview.composer());
		await page.keyboard.type('one');
		await page.keyboard.press('Enter');
		await page.keyboard.type('two');
		await preview.press(page.getByTestId('composer-expand'));
		await expect(page.getByTestId('composer-panel')).toBeVisible();
		await expect(page.getByTestId('pane-description')).toHaveCount(0);
		const pane = (await page.locator('main.ap-shell-main').boundingBox())!;
		const box = (await page.getByTestId('composer-panel').boundingBox())!;
		expect(Math.round(box.y + box.height)).toBeLessThanOrEqual(Math.round(pane.y + pane.height));
		await expect(page.getByRole('button', { name: 'Send message', exact: true })).toBeInViewport({ ratio: 1 });
		await preview.press(page.getByRole('button', { name: 'Collapse composer' }));
		await expect(page.getByTestId('composer-panel')).toBeHidden();
		// Still two lines, in a window this short: still away.
		await expect(page.getByTestId('pane-description')).toHaveCount(0);
		await preview.press(page.getByRole('button', { name: 'Send message', exact: true }));
		await preview.waitForSent('message', (p) => p.body?.text === 'one\ntwo');
		await expect(page.getByTestId('pane-description')).toBeVisible();
	});
});

test.describe('link previews a message is sent with', () => {
	test.use(DEVICES.desktop);

	const VIDEO = 'https://www.youtube.com/watch?v=c8GIM-MJ7lM';
	const THUMBNAIL = 'https://i.ytimg.com/vi/c8GIM-MJ7lM/hqdefault.jpg';
	const OEMBED = /^https:\/\/www\.youtube\.com\/oembed\?/;
	const oembed = { title: 'Music for Dark Legends', author_name: 'Secession Studios' };

	/**
	 * Opens the preview with the page's timers stopped once it is up, so a message's wait for its previews ends only
	 * when the test lets time pass (`page.clock.runFor`), however slow the machine. The date stays the preview's.
	 */
	async function openStopped(preview: Preview): Promise<void> {
		await preview.page.clock.install();
		await preview.open();
		await preview.page.clock.pauseAt(NOW);
		await preview.page.clock.setFixedTime(NOW);
	}

	test('a link sent at once goes with its preview: the draft clears, and Send holds in the room until the message goes', async ({ preview, page }) => {
		await openStopped(preview);
		let answer!: () => void;
		const answered = new Promise<void>((resolve) => (answer = resolve));
		await page.route(OEMBED, async (route) => {
			await answered;
			await route.fulfill({ json: oembed, headers: { 'Access-Control-Allow-Origin': '*' } });
		});
		const text = `watch ${VIDEO}`;
		await preview.composer().click();
		await page.keyboard.insertText(text);
		await page.keyboard.press('Enter');
		await expect(preview.composer()).toHaveText('');
		// Send spins and holds, its name saying so; no toast, which is for a slow server.
		await expect(page.getByRole('button', { name: 'Sending…', exact: true })).toBeDisabled();
		await page.clock.runFor(700);
		await expect(page.getByRole('status').filter({ hasText: 'Sending…' })).toHaveCount(0);

		await test.step('what is typed meanwhile is a new draft, and Enter keeps it while the message waits', async () => {
			await page.keyboard.type('next one');
			await page.keyboard.press('Enter');
			await expect(preview.composer()).toHaveText('next one');
			expect(await sentWithText(preview, text)).toEqual([]);
		});

		await test.step('the preview arrives: the message goes with it, then the next one can', async () => {
			answer();
			const sent = await preview.waitForSent('message', (p) => p.body?.text === text);
			await expect(page.getByRole('button', { name: 'Send message', exact: true })).toBeEnabled();
			expect(sent.body.embeds).toEqual([{ kind: 'link', url: VIDEO, og: { site_name: 'YouTube · Secession Studios', title: oembed.title, image: { url: THUMBNAIL, type: 'image/jpeg', width: 480, height: 360, alt: oembed.title } } }]);
			await page.keyboard.press('Enter');
			const next = await preview.waitForSent('message', (p) => p.body?.text === 'next one');
			expect(next.body.embeds).toBeUndefined();
			expect(await sentWithText(preview, text)).toHaveLength(1);
		});
	});

	test('messages wait in more than one room at once, each holding Send only in its own', async ({ preview, page }) => {
		await openStopped(preview);
		await page.route(OEMBED, () => {});
		const first = `watch ${VIDEO}`;
		const second = 'and https://youtu.be/dQw4w9WgXcQ';
		await preview.composer().click();
		await page.keyboard.insertText(first);
		await page.keyboard.press('Enter');
		await preview.openRoom('engineering');
		await preview.composer().click();
		await page.keyboard.insertText(second);
		// The wait in general holds Send there only.
		await expect(page.getByRole('button', { name: 'Send message', exact: true })).toBeEnabled();
		await page.keyboard.press('Enter');
		await expect(preview.composer()).toHaveText('');
		await preview.openRoom('general');
		await expect(page.getByRole('button', { name: 'Sending…', exact: true })).toBeDisabled();
		await preview.composer().click();
		await page.keyboard.type('after');
		await page.keyboard.press('Enter');
		await expect(preview.composer()).toHaveText('after');
		expect(await sentWithText(preview, first)).toEqual([]);
		expect(await sentWithText(preview, 'after')).toEqual([]);
		await page.clock.runFor(PREVIEW_WAIT_MS);
		await preview.waitForSent('message', (p) => p.body?.text === first);
		await preview.waitForSent('message', (p) => p.body?.text === second);
		await page.keyboard.press('Enter');
		await preview.waitForSent('message', (p) => p.body?.text === 'after');
	});

	test('a message waiting for its previews goes at once when the page is hidden', async ({ preview, page }) => {
		await openStopped(preview);
		await page.route(OEMBED, () => {});
		const text = `watch ${VIDEO}`;
		await preview.composer().click();
		await page.keyboard.insertText(text);
		await page.keyboard.press('Enter');
		await page.evaluate(() => {
			Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
			document.dispatchEvent(new Event('visibilitychange'));
		});
		await preview.waitForSent('message', (p) => p.body?.text === text);
	});

	test('a message waiting for its previews goes at once when the page is put away', async ({ preview, page }) => {
		await openStopped(preview);
		await page.route(OEMBED, () => {});
		const text = `watch ${VIDEO}`;
		await preview.composer().click();
		await page.keyboard.insertText(text);
		await page.keyboard.press('Enter');
		await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false })));
		const sent = await preview.waitForSent('message', (p) => p.body?.text === text);
		expect(sent.body.embeds[0].og).toEqual({ site_name: 'YouTube', image: { url: THUMBNAIL, type: 'image/jpeg', width: 480, height: 360 } });
	});

	test('a preview that is slow to come is not waited for long: the message goes with the card its URL gives', async ({ preview, page }) => {
		await openStopped(preview);
		await page.route(OEMBED, () => {});
		const text = `watch ${VIDEO}`;
		await preview.composer().click();
		await page.keyboard.insertText(text);
		await page.keyboard.press('Enter');
		await page.clock.runFor(PREVIEW_WAIT_MS);
		const sent = await preview.waitForSent('message', (p) => p.body?.text === text);
		expect(sent.body.embeds).toEqual([{ kind: 'link', url: VIDEO, og: { site_name: 'YouTube', image: { url: THUMBNAIL, type: 'image/jpeg', width: 480, height: 360 } } }]);
	});
});
