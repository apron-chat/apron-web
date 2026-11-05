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
		await list.evaluate((el) => el.scrollTo({ top: el.scrollHeight - el.clientHeight - 400 }));
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
