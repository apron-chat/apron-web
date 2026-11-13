import type { Locator } from '@playwright/test';
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

	// Select mode last, so it can't change what the other steps' clicks do.
	test('React reacts to that message, an image embed opens full screen, and a shift-click in select mode picks every message between', async ({ preview, page }) => {
		await preview.open();

		await test.step('React opens the picker beside it, and a pick reacts to that message', async () => {
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
			await page.keyboard.press('Escape');
			await expect(page.getByTestId('reactors')).toHaveCount(0);
		});

		await test.step('the add button after the chips opens the same picker beside it, and a pick adds to them', async () => {
			const row = preview.message('Open a thread, react to a message');
			await row.hover();
			const add = row.getByRole('button', { name: 'Add a reaction', exact: true });
			await add.click();
			await expect(add).toHaveAttribute('aria-expanded', 'true');
			const picker = page.getByRole('dialog', { name: 'Emoji picker', exact: true });
			await expect(picker).toHaveAttribute('data-state', 'ready');
			await picker.locator('em-emoji-picker input[type="search"]').fill('fire');
			await picker.getByRole('button', { name: '🔥', exact: true }).first().click();
			await preview.waitForSent('reactions', (params) => params.message_id === '1710000000004' && params.emojis?.includes('🔥'));
			await expect(row.getByTestId('reaction-chip')).toHaveCount(2);
			await row.hover();
			await expect(add).toHaveAttribute('aria-expanded', 'false');
		});

		await test.step('the toolbar offers the emoji you reacted with last, latest first, and one press reacts with one', async () => {
			const row = preview.message('Try markdown');
			await row.hover();
			const quick = row.getByRole('group', { name: 'Quick reactions' }).getByRole('button');
			await expect(quick).toHaveText(['🔥', '🎉', '👍']);
			await quick.filter({ hasText: '👍' }).click();
			await preview.waitForSent('reactions', (params) => params.message_id !== '1710000000004' && params.emojis?.includes('👍'));
			await expect(row.getByTestId('reaction-chip')).toHaveCount(1);
			// It keeps its place while the pointer stays, and comes first the next time.
			await expect(quick).toHaveText(['🔥', '🎉', '👍']);
			await page.mouse.move(0, 0);
			await row.hover();
			await expect(quick).toHaveText(['👍', '🔥', '🎉']);
			await expect(quick.filter({ hasText: '👍' })).toHaveAttribute('aria-pressed', 'true');
		});

		await test.step('an image embed opens full screen', async () => {
			await preview.message('Two from the ridge').getByRole('img', { name: /Layered purple hills/ }).click();
			await expect(page.getByRole('dialog').getByRole('button', { name: 'Next image' })).toBeVisible();
			await page.keyboard.press('Escape');
			await expect(page.getByRole('dialog')).toHaveCount(0);
		});

		await test.step('a shift-click in select mode picks every message between', async () => {
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
	});
});

/** Whether the toolbar of the message hovered shows Reply's words beside its icon. */
async function replyWords(preview: Preview, text: string): Promise<boolean> {
	const row = preview.message(text);
	await row.hover();
	const reply = row.getByRole('button', { name: 'Reply to message', exact: true });
	await expect(reply).toBeVisible();
	return reply.evaluate((element) => getComputedStyle(element.querySelector('.ap-actions-label')!).display !== 'none');
}

for (const [device, wide] of [['desktop', true], ['tablet', false]] as const) {
	test.describe(`the message toolbar, ${device}`, () => {
		test.use(DEVICES[device]);

		test(wide ? 'shows each icon’s words beside it in a wide pane, and ⋯ opens a menu of them' : 'shows icons alone where the pane is narrow, and ⋯ opens a menu of their words', async ({ preview, page }) => {
			await preview.open();
			expect(await replyWords(preview, 'Try markdown')).toBe(wide);
			const toolbar = preview.message('Try markdown').getByRole('toolbar', { name: 'Message actions' });
			await toolbar.getByRole('button', { name: 'More actions', exact: true }).click();
			await expect(toolbar).toHaveAttribute('aria-orientation', 'vertical');
			await expect(toolbar.getByRole('button', { name: 'Copy link to message', exact: true })).toHaveText('Copy link');
			// It stays while open, the pointer over another message; once Escape shuts it, that message gets the toolbar.
			const other = preview.message('Open a thread');
			await other.hover({ position: { x: 24, y: 12 } });
			await expect(toolbar).toHaveAttribute('aria-orientation', 'vertical');
			await expect(other.getByRole('toolbar', { name: 'Message actions' })).toHaveCount(0);
			await page.keyboard.press('Escape');
			await other.hover({ position: { x: 32, y: 14 } });
			await expect(other.getByRole('toolbar', { name: 'Message actions' })).toBeVisible();
			await expect(other.getByRole('toolbar', { name: 'Message actions' })).not.toHaveAttribute('aria-orientation', 'vertical');
		});

		test('opens ⋯ upward on the last message, inside the timeline, which stays where it was', async ({ preview, page }) => {
			await preview.open();
			await preview.composer().click();
			await page.keyboard.type('The last word');
			await page.keyboard.press('Enter');
			const row = preview.message('The last word');
			await expect(row).toBeVisible();
			const list = page.getByTestId('message-list');
			await row.hover();
			const before = await list.evaluate((el) => el.scrollTop);
			await row.getByRole('button', { name: 'More actions', exact: true }).click();
			const menu = row.getByRole('toolbar', { name: 'Message actions' });
			await expect(menu).toHaveAttribute('aria-orientation', 'vertical');
			const [box, frame] = await Promise.all([menu.boundingBox(), list.boundingBox()]);
			expect(box!.y + box!.height).toBeLessThanOrEqual(frame!.y + frame!.height);
			expect(box!.y).toBeGreaterThanOrEqual(frame!.y);
			expect(await list.evaluate((el) => el.scrollTop)).toBe(before);
			// As wide as it is opened downward, its rows unwrapped: out of flow, it would take the narrowest width its rows
			// allow. A longer label (a translation's, say) than these fits in its least width shows it.
			const [up, down] = await menu.evaluate((el) => {
				el.querySelector('.ap-actions-label')!.textContent = 'A label longer than the menu is wide at its least';
				const width = () => el.getBoundingClientRect().width;
				const upward = width();
				el.classList.remove('ap-actions-up');
				const downward = width();
				el.classList.add('ap-actions-up');
				return [upward, downward];
			});
			expect(up).toBe(down);
			await page.keyboard.press('Escape');
			await expect(menu).not.toHaveAttribute('aria-orientation', 'vertical');
		});

		test('sits above the hovered message, clear of its words, or below it at the top of the timeline', async ({ preview, page }) => {
			await preview.open();
			// First, before any row has had it: a row just under the top of the timeline, where one above would be cut
			// off, has it below. Moved once it's seen cut off (an IntersectionObserver, measuring nothing as the pointer arrives).
			const list = page.getByTestId('message-list');
			// Its images in first, whose sizes arriving would move it.
			await expect.poll(() => page.evaluate(() => [...document.images].every((image) => image.complete))).toBe(true);
			// A row from the middle of the history, so that scrolling it to the top doesn't bring older ones in above it.
			const id = await list.evaluate((frame) => {
				const top = frame.getBoundingClientRect().top - frame.scrollTop;
				const rows = [...frame.querySelectorAll<HTMLElement>('article.ap-msg[data-message-id]:not(.ap-msg-system)')];
				const row = rows.find((el) => el.getBoundingClientRect().top - top > frame.clientHeight && frame.scrollHeight - (el.getBoundingClientRect().top - top) > frame.clientHeight);
				return row?.dataset.messageId;
			});
			expect(id, 'a row with a screenful above and below it').toBeDefined();
			const first = list.locator(`article[data-message-id="${id}"]`);
			await first.evaluate((el) => {
				const frame = el.closest('[data-testid="message-list"]')!;
				frame.scrollTop += el.getBoundingClientRect().top - frame.getBoundingClientRect().top - 2;
			});
			await first.hover({ position: { x: 60, y: 8 } });
			const top = first.getByRole('toolbar', { name: 'Message actions' });
			await expect(top).toBeVisible();
			const [at, frame] = await Promise.all([first.boundingBox(), list.boundingBox()]);
			expect(at!.y - frame!.y, 'still at the top of the timeline').toBeLessThan(8);
			await expect.poll(async () => (await top.boundingBox())!.y).toBeGreaterThanOrEqual(at!.y + at!.height - 4);

			// Elsewhere it sits above the row, over none of its words.
			await preview.composer().click();
			await page.keyboard.type('A line long enough to run under the toolbar, were it over the row, with more words to be sure of it');
			await page.keyboard.press('Enter');
			const row = preview.message('A line long enough');
			await row.hover({ position: { x: 60, y: 8 } });
			const toolbar = row.getByRole('toolbar', { name: 'Message actions' });
			await expect(toolbar).toBeVisible();
			const words = row.locator('.ap-msg-text');
			const [bar, body] = await Promise.all([toolbar.boundingBox(), words.boundingBox()]);
			expect(bar!.y + bar!.height).toBeLessThanOrEqual(body!.y);
			// Its words under the toolbar's end are the row's own, so a link there takes the click.
			const hit = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest('.ap-actions') === null, [bar!.x + bar!.width - 4, body!.y + 4]);
			expect(hit).toBe(true);
		});
	});
}

test.describe('a task list', () => {
	test.use(DEVICES.desktop);

	test('checking a box in your message saves the edit; one in someone else\'s is not yours to tick, mentioned or not', async ({ preview }) => {
		await preview.open();
		await preview.post('general', 'preview_guest', 'Ship it:\n\n- [ ] Foo\n- [x] Bar');
		await preview.post('general', 'ada', 'Mine:\n\n- [ ] Theirs');
		// Without ext:editors only its sender may edit a message, whoever it mentions.
		await preview.post('general', 'ada', { text: 'For @preview_guest:\n\n- [ ] Yours', format: 'markdown', mentions: ['preview_guest'] }, { ext: { editors: { 'body.text': 'mentioned' } } });
		await expect(preview.message('For ').getByRole('checkbox')).toBeDisabled();
		const mine = preview.message('Ship it:').getByRole('checkbox');
		await expect(mine).toHaveCount(2);
		await expect(mine.nth(0)).not.toBeChecked();
		await expect(mine.nth(1)).toBeChecked();
		await expect(preview.message('Mine:').getByRole('checkbox')).toBeDisabled();

		await mine.nth(0).check();
		const edit = await preview.waitForSent('message', (params) => params.message_id !== undefined);
		expect(edit.body).toMatchObject({ text: 'Ship it:\n\n- [x] Foo\n- [x] Bar', format: 'markdown' });
		await expect(mine.nth(0)).toBeChecked();
		await expect(mine.nth(0)).toBeEnabled();
	});

	test('keeps each check on its first word\'s line, centred as the line\'s chips are, in a message and in the composer', async ({ preview, page }) => {
		// A first word with nowhere to break, wider than any line: a line may break after an inline box, which would
		// leave the check alone above it.
		const long = `Long${'o'.repeat(160)}`;
		/** The vertical centre of a box. */
		const centre = (box: { y: number; height: number } | null) => box!.y + box!.height / 2;
		/**
		 * How far the check's centre sits below that of the first letter of `long` (the box a chip or any other inline
		 * box on the line centres on), in px: about a line's height if it went to a line of its own.
		 */
		const offset = (check: Locator) =>
			check.evaluate((box) => {
				const item = box.closest('.ap-task-item, .ap-composer-editable')!;
				const walker = document.createTreeWalker(item, NodeFilter.SHOW_TEXT, (node) => (node.textContent!.includes('Long') ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP));
				const text = walker.nextNode()!;
				const range = document.createRange();
				const at = text.textContent!.indexOf('Long');
				range.setStart(text, at);
				range.setEnd(text, at + 1);
				const middle = (rect: DOMRect) => (rect.top + rect.bottom) / 2;
				return middle(box.getBoundingClientRect()) - middle(range.getBoundingClientRect());
			});

		await preview.open();
		await preview.post('general', 'preview_guest', `Odd one:\n\n- [ ] ${long}\n- [ ] @ada\n- [ ] مرحبا بالعالم`);
		const checks = preview.message('Odd one:').getByRole('checkbox');
		await expect(checks).toHaveCount(3);
		expect(Math.abs(await offset(checks.first()))).toBeLessThan(1);
		// An item that is only a mention: the check level with its chip.
		const chipItem = preview.message('Odd one:').locator('li').nth(1);
		const [check, mention] = await Promise.all([chipItem.getByRole('checkbox').boundingBox(), chipItem.locator('.ap-mention').boundingBox()]);
		expect(Math.abs(centre(check) - centre(mention))).toBeLessThan(0.5);
		// An item whose text runs the other way from the page's (each item takes its own direction): its check stays in
		// the gutter, clear of the text.
		const overlap = await checks.nth(2).evaluate((box) => {
			const range = document.createRange();
			range.selectNodeContents(box.closest('li')!);
			range.setStartAfter(box);
			const ring = box.getBoundingClientRect();
			return [...range.getClientRects()].some((rect) => rect.width > 0 && rect.left < ring.right && rect.right > ring.left);
		});
		expect(overlap).toBe(false);

		await preview.composer().click();
		await page.keyboard.type(`- [ ] ${long}`);
		const chip = preview.composer().locator('.ap-task-chip');
		await expect(chip).toHaveCount(1);
		expect(Math.abs(await offset(chip))).toBeLessThan(1);
		// A click in the space after it puts the caret there, and doesn't tick it.
		const ring = (await chip.boundingBox())!;
		await page.mouse.click(ring.x + ring.width + 3, ring.y + ring.height / 2);
		await expect(chip).not.toHaveClass(/ap-task-chip-done/);
	});
});

test.describe('a message shared with those it mentions (ext:editors)', () => {
	test.use({ ...DEVICES.desktop, knobs: { capabilities: ['ext:editors'] } });

	test('is yours to tick and edit where it mentions you, and says you edited it', async ({ preview, page }) => {
		await preview.open();
		await preview.post('general', 'ada', { text: 'Lunch, @preview_guest:\n\n- [ ] Soup', format: 'markdown', mentions: ['preview_guest'] }, { ext: { editors: { 'body.text': 'mentioned' } } });
		await preview.post('general', 'ada', { text: 'Not shared, @preview_guest:\n\n- [ ] Salad', format: 'markdown', mentions: ['preview_guest'] });
		await expect(preview.message('Not shared').getByRole('checkbox')).toBeDisabled();
		const box = preview.message('Lunch, ').getByRole('checkbox');
		await expect(box).toBeEnabled();
		await box.check();
		const edit = await preview.waitForSent('message', (params) => params.message_id !== undefined);
		expect(edit.body).toMatchObject({ text: 'Lunch, @preview_guest:\n\n- [x] Soup' });
		await expect(preview.message('Lunch, ').getByTestId('message-edited-by')).toHaveText(/edited by/);
		// Its text is yours to edit too, but not to delete.
		await preview.message('Lunch, ').hover();
		await expect(preview.message('Lunch, ').getByRole('button', { name: 'Edit message' })).toBeVisible();
		await preview.message('Lunch, ').getByRole('button', { name: 'More actions' }).click();
		await expect(page.getByRole('menuitem', { name: 'Delete message' })).toHaveCount(0);
	});

	test('Send asks whether those a checklist mentions may edit it', async ({ preview, page }) => {
		await preview.open();
		await preview.composer().click();
		await page.keyboard.type('@ada lunch?');
		await page.keyboard.press('Shift+Enter');
		await page.keyboard.press('Shift+Enter');
		await page.keyboard.type('- [ ] soup');
		await page.keyboard.press('Enter');
		const prompt = page.getByTestId('editors-prompt');
		await expect(prompt).toContainText('Let Ada Lovelace edit this message?');
		await prompt.getByRole('button', { name: 'Let them edit' }).click();
		const sent = await preview.waitForSent('message', (params) => params.message_id === undefined && String(params.body?.text).includes('soup'));
		expect(sent.ext).toEqual({ editors: { 'body.text': 'mentioned' } });
		expect(sent.body?.mentions).toEqual(['ada']);
		await expect(prompt).toHaveCount(0);
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

test.describe('the timeline at its latest', () => {
	test.use(DEVICES.desktop);

	test('stays there when a message above grows without a scroll (an image\'s size arriving), and never offers a jump', async ({ preview, page }) => {
		await preview.open();
		const list = page.getByTestId('message-list');
		const atLatest = () => list.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight < 2);
		await expect.poll(atLatest).toBe(true);
		// Watch for the jump button from here on, in any frame.
		await page.evaluate(() => {
			const w = window as unknown as { jumpShown: boolean };
			w.jumpShown = false;
			new MutationObserver(() => (w.jumpShown ||= Boolean(document.querySelector('[data-testid=jump-button]')))).observe(document.body, { childList: true, subtree: true });
		});
		// A style, not a node: as an image laying out at its size does, which the pane's mutation observer doesn't see.
		await list.evaluate((el) => {
			const rows = el.querySelectorAll<HTMLElement>('[data-timeline-item]');
			rows[rows.length - 3].style.paddingBottom = `${el.clientHeight}px`;
		});
		await expect.poll(atLatest).toBe(true);
		// Two frames more, for the observer to report and anything it shows to render.
		await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
		expect(await page.evaluate(() => (window as unknown as { jumpShown: boolean }).jumpShown)).toBe(false);
		await expect(page.getByTestId('jump-button')).toHaveCount(0);
	});
});

test.describe('the page shown again', () => {
	test.use(DEVICES.desktop);

	test('marks read only what is on screen: what came while it was hidden, below the latest it showed, stays unread', async ({ preview, page }) => {
		// The tab's visibility is played: a test's page is never hidden. As a hidden one, it draws no frames meanwhile
		// (`requestAnimationFrame` waits until it is shown), so nothing measures what arrives.
		await page.addInitScript(() => {
			let hidden = false;
			const held = new Map<number, FrameRequestCallback>();
			let heldId = 0;
			// Taken when hidden: the fake clock (`preview.open`) puts its own in place after this script.
			let request = window.requestAnimationFrame;
			let cancel = window.cancelAnimationFrame;
			Object.defineProperty(Document.prototype, 'visibilityState', { configurable: true, get: () => (hidden ? 'hidden' : 'visible') });
			Object.defineProperty(Document.prototype, 'hidden', { configurable: true, get: () => hidden });
			(window as unknown as { setHidden: (next: boolean) => void }).setHidden = (next) => {
				hidden = next;
				if (hidden) {
					request = window.requestAnimationFrame;
					cancel = window.cancelAnimationFrame;
					window.requestAnimationFrame = (callback) => {
						held.set(--heldId, callback);
						return heldId;
					};
					window.cancelAnimationFrame = (id) => void held.delete(id);
				} else {
					window.requestAnimationFrame = request;
					window.cancelAnimationFrame = cancel;
				}
				document.dispatchEvent(new Event('visibilitychange'));
				if (hidden) return;
				const callbacks = [...held.values()];
				held.clear();
				request((time) => callbacks.forEach((callback) => callback(time)));
			};
		});
		const setHidden = (hidden: boolean) => page.evaluate((next) => (window as unknown as { setHidden: (next: boolean) => void }).setHidden(next), hidden);
		await preview.open();
		const list = page.getByTestId('message-list');
		// A long message last, read: its top on screen, its end a way below, so the pane no longer follows the latest.
		await preview.post('general', 'ada', Array.from({ length: 60 }, (_, n) => `Line ${n + 1}`).join('\n\n'));
		await expect(preview.message('Line 60')).toBeVisible();
		const frames = () => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
		const measure = () => list.evaluate((el) => ({ height: el.scrollHeight, fromEnd: el.scrollHeight - el.scrollTop - el.clientHeight }));
		// Until the long message has laid out, and the pane is held at its new end: before then, a scroll up that lands
		// no higher than the end the pane was last held at reads as the list growing under it, and it pins back to
		// the latest (`trackScroll`), so nothing would be left below to come back to.
		await expect.poll(async () => {
			const before = await measure();
			await frames();
			const after = await measure();
			return after.height === before.height && after.fromEnd < 2;
		}).toBe(true);
		await list.evaluate((el) => el.scrollTo({ top: el.scrollHeight - el.clientHeight - 400 }));
		await frames();
		expect((await measure()).fromEnd).toBeGreaterThan(300);
		await expect(preview.message('Line 60')).toBeInViewport();
		await expect(page.getByTestId('jump-button')).toHaveCount(0);
		await setHidden(true);
		await preview.post('general', 'ada', 'While you were away');
		await expect(preview.message('While you were away')).toHaveCount(1);
		await setHidden(false);
		await expect(page.getByTestId('jump-button')).toBeVisible();
		// Left as it is, general still has it to read.
		await preview.openRoom('engineering');
		await expect(page.locator('[data-testid="room-list"] button[data-room="general"]').getByTestId('room-unread')).toHaveText('1');
	});
});

test.describe('the timeline at its latest, dragged back slowly', () => {
	test.use(DEVICES.phone);

	test('lets go of the latest a pixel at a time, as a slow drag on a phone moves it', async ({ preview, page }) => {
		await preview.open();
		const list = page.getByTestId('message-list');
		const fromEnd = () => list.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight);
		await expect.poll(fromEnd).toBeLessThan(2);
		// A pixel a frame, each step waiting out the frame the pane would pin itself again in.
		await list.evaluate(async (el) => {
			const frame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
			for (let step = 0; step < 150; step++) {
				el.scrollTop -= 1;
				await frame();
			}
		});
		expect(await fromEnd()).toBeGreaterThan(140);
		await expect(page.getByTestId('jump-button')).toBeVisible();
	});
});
