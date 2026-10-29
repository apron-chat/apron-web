import type { BrowserContext, Page } from '@playwright/test';
import { DEVICES, expect, test } from './fixtures';

/** The sidebar's top-level rooms in an order of your own: dragged by their rows, or moved with Alt+↑/↓. */

const rows = (page: Page) => page.getByTestId('room-list').locator('button[data-room]');
const row = (page: Page, room: string) => page.getByTestId('room-list').locator(`button[data-room="${room}"]`);
const order = (page: Page) => rows(page).evaluateAll((buttons) => buttons.map((button) => (button as HTMLElement).dataset.room));
/** Every room's threads fold away while one is carried: how a drag shows from outside. */
const threadLists = (page: Page) => page.getByRole('complementary', { name: 'Rooms' }).getByTestId('thread-list');
/** A thread of general in the preview's seed, by its title. */
const deployThread = (page: Page) => threadLists(page).getByText('Deploy checklist', { exact: true });
/** Lets any input the browser has queued (a click after a tap) run. */
const nextFrame = (page: Page) => page.evaluate(() => new Promise((done) => requestAnimationFrame(() => done(null))));

async function middle(page: Page, room: string): Promise<{ x: number; y: number; top: number }> {
	const box = (await row(page, room).boundingBox())!;
	return { x: box.x + box.width / 2, y: box.y + box.height / 2, top: box.y };
}

test.describe('room order, with a mouse', () => {
	test.use(DEVICES.desktop);

	test('a room dragged by any part of its row lands where it’s let go, every room’s threads folded away while it’s carried', async ({ preview, page }) => {
		await preview.open('#room=general');
		expect(await order(page)).toEqual(['general', 'engineering']);
		await expect(threadLists(page)).toHaveCount(1);
		// From the row's very edge, not its name.
		const edge = (await row(page, 'engineering').boundingBox())!;
		await page.mouse.move(edge.x + 3, edge.y + 2);
		await page.mouse.down();
		await page.mouse.move(edge.x + 3, edge.y - 8, { steps: 3 });
		await expect(threadLists(page)).toHaveCount(0);
		const to = await middle(page, 'general');
		await page.mouse.move(to.x, to.top + 4, { steps: 10 });
		await page.mouse.up();
		await expect.poll(() => order(page)).toEqual(['engineering', 'general']);
		// The threads come back, and the open room stays open: a drag isn't a pick.
		await expect(threadLists(page)).toHaveCount(1);
		await expect(preview.heading()).toHaveText('general');
	});

	test('a click still opens a room, and one let go outside the list goes back', async ({ preview, page }) => {
		await preview.open('#room=general');
		const from = await middle(page, 'engineering');
		await page.mouse.move(from.x, from.y);
		await page.mouse.down();
		await page.mouse.move(640, 400, { steps: 10 });
		await page.mouse.up();
		await expect(threadLists(page)).toHaveCount(1);
		expect(await order(page)).toEqual(['general', 'engineering']);
		await row(page, 'engineering').click();
		await expect(preview.heading()).toHaveText('engineering');
	});

	test('pressing a thread and moving doesn’t carry its room', async ({ preview, page }) => {
		await preview.open('#room=general');
		const thread = (await deployThread(page).boundingBox())!;
		await page.mouse.move(thread.x + thread.width / 2, thread.y + thread.height / 2);
		await page.mouse.down();
		await page.mouse.move(thread.x + thread.width / 2, thread.y + 60, { steps: 6 });
		await expect(threadLists(page)).toHaveCount(1);
		await page.mouse.up();
		expect(await order(page)).toEqual(['general', 'engineering']);
	});

	test('Alt+↑ and Alt+↓ move the focused room, the keyboard staying on it', async ({ preview, page }) => {
		await preview.open('#room=general');
		await row(page, 'general').focus();
		await page.keyboard.press('Alt+ArrowDown');
		await expect.poll(() => order(page)).toEqual(['engineering', 'general']);
		await expect(row(page, 'general')).toBeFocused();
		await page.keyboard.press('Alt+ArrowUp');
		await expect.poll(() => order(page)).toEqual(['general', 'engineering']);
		await expect(row(page, 'general')).toBeFocused();
	});
});

test.describe('folding a room, with motion allowed', () => {
	// The suite runs with reduced motion, which leaves the rooms nothing to animate: this checks they don't when they could.
	test.use({ ...DEVICES.desktop, contextOptions: { reducedMotion: 'no-preference' } });

	test('a click on the open room that drifts a little folds it, rather than lifting it, and nothing in the list animates', async ({ preview, page }) => {
		await preview.open('#room=general');
		const from = await middle(page, 'general');
		await page.mouse.move(from.x, from.y);
		await page.mouse.down();
		await page.mouse.move(from.x + 5, from.y + 1, { steps: 2 });
		await page.mouse.up();
		await expect(page.getByRole('button', { name: 'Show all threads in general' })).toBeVisible();
		await expect(threadLists(page)).toHaveCount(0);
		expect(await order(page)).toEqual(['general', 'engineering']);
		// The rooms below close up at once: no animation in the list as it folds.
		const moving = await page.getByTestId('room-list').evaluate((list) => document.getAnimations().filter((animation) => {
			const target = (animation.effect as KeyframeEffect | null)?.target;
			return target instanceof Element && list.contains(target);
		}).length);
		expect(moving).toBe(0);
	});
});

test.describe('room order, by touch', () => {
	test.use({ ...DEVICES.tablet, hasTouch: true });

	/**
	 * Touches through the browser's own input (CDP), as a finger's: Playwright can tap, but can't hold and move one.
	 * `tap` is down for a moment, well short of the hold that lifts a room.
	 */
	async function finger(context: BrowserContext, page: Page) {
		const cdp = await context.newCDPSession(page);
		const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', x = 0, y = 0) =>
			cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
		const tap = async (x: number, y: number) => {
			await touch('touchStart', x, y);
			await page.waitForTimeout(60);
			await touch('touchEnd');
			await nextFrame(page);
		};
		return { touch, tap };
	}

	test('a room held lifts, and can then be dragged to another place', async ({ preview, page, context }) => {
		await preview.open('#room=general');
		const { touch } = await finger(context, page);
		const from = await middle(page, 'engineering');
		await touch('touchStart', from.x, from.y);
		await expect(threadLists(page)).toHaveCount(0);
		const to = await middle(page, 'general');
		for (let i = 1; i <= 12; i++) await touch('touchMove', from.x, from.y + (to.top + 4 - from.y) * (i / 12));
		await touch('touchEnd');
		await expect.poll(() => order(page)).toEqual(['engineering', 'general']);
		await expect(threadLists(page)).toHaveCount(1);
		await expect(preview.heading()).toHaveText('general');
	});

	test('a swipe across the rooms doesn’t carry one', async ({ preview, page, context }) => {
		await preview.open('#room=general');
		const { touch } = await finger(context, page);
		const from = await middle(page, 'engineering');
		await touch('touchStart', from.x, from.y);
		for (let i = 1; i <= 6; i++) await touch('touchMove', from.x, from.y - i * 10);
		await touch('touchEnd');
		await expect(threadLists(page)).toHaveCount(1);
		expect(await order(page)).toEqual(['general', 'engineering']);
	});

	test('a tap opens a room', async ({ preview, page, context }) => {
		await preview.open('#room=general');
		const { tap } = await finger(context, page);
		const room = await middle(page, 'engineering');
		await tap(room.x, room.y);
		await expect(preview.heading()).toHaveText('engineering');
	});

	test('a tap on a thread opens the thread', async ({ preview, page, context }) => {
		await preview.open('#room=general');
		const { tap } = await finger(context, page);
		const thread = (await deployThread(page).boundingBox())!;
		await tap(thread.x + thread.width / 2, thread.y + thread.height / 2);
		await expect(preview.heading()).toHaveText('general › Deploy checklist');
	});
});

test.describe('folding a room on a phone', () => {
	test.use(DEVICES.phone);

	// A tap is one pick: were it two (svelte-dnd-action clicks after a tap, as the browser does), this fold would undo itself.
	test('tapping the open room folds its threads in the rooms list, which stays, its › going back to the room', async ({ preview, page }) => {
		await preview.open('#room=general');
		await preview.roomsPane();
		await expect(threadLists(page)).toHaveCount(1);
		await preview.press(row(page, 'general'));
		await expect(page.getByTestId('room-list')).toBeVisible();
		await expect(page.getByRole('button', { name: 'Show all threads in general' })).toBeVisible();
		await expect(threadLists(page)).toHaveCount(0);
		await preview.press(row(page, 'general'));
		await expect(threadLists(page)).toHaveCount(1);
		await preview.press(page.getByRole('button', { name: 'Back to general' }));
		await expect(page.getByTestId('room-list')).toBeHidden();
		await expect(preview.heading()).toHaveText('general');
	});
});
