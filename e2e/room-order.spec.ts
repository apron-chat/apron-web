import type { BrowserContext, Page } from '@playwright/test';
import { DEVICES, expect, test } from './fixtures';

/** The sidebar's top-level rooms in an order of your own (`src/lib/ui/room-order.svelte.ts`, svelte-dnd-action). */

const rows = (page: Page) => page.getByTestId('room-list').locator('button[data-room]');
const order = (page: Page) => rows(page).evaluateAll((buttons) => buttons.map((button) => (button as HTMLElement).dataset.room));
const threadLists = (page: Page) => page.getByRole('complementary', { name: 'Rooms' }).getByTestId('thread-list');
const lifted = (page: Page) => page.locator('#dnd-action-dragged-el');

async function middle(page: Page, room: string): Promise<{ x: number; y: number; top: number }> {
	const box = (await page.getByTestId('room-list').locator(`button[data-room="${room}"]`).boundingBox())!;
	return { x: box.x + box.width / 2, y: box.y + box.height / 2, top: box.y };
}

test.describe('room order, with a mouse', () => {
	test.use(DEVICES.desktop);

	test('a room dragged by its row lands where it’s let go, every room’s threads folded away while it’s carried', async ({ preview, page }) => {
		await preview.open('#room=general');
		expect(await order(page)).toEqual(['general', 'engineering']);
		await expect(threadLists(page)).toHaveCount(1);
		// From the row's edge, its padding, not its text: the row is a button the library would otherwise leave alone.
		const edge = (await page.getByTestId('room-list').locator('button[data-room="engineering"]').boundingBox())!;
		await page.mouse.move(edge.x + 3, edge.y + 2);
		await page.mouse.down();
		await page.mouse.move(edge.x + 3, edge.y - 8, { steps: 3 });
		await expect(lifted(page)).toHaveCount(1);
		await expect(threadLists(page)).toHaveCount(0);
		// Over the top of general, now just its row.
		const to = await middle(page, 'general');
		await page.mouse.move(to.x, to.top + 4, { steps: 10 });
		await page.mouse.up();
		await expect.poll(() => order(page)).toEqual(['engineering', 'general']);
		// The threads come back as they were, and the open room stays open: a drag isn't a pick.
		await expect(threadLists(page)).toHaveCount(1);
		await expect(preview.heading()).toHaveText('general');
		// A click still picks.
		await rows(page).filter({ hasText: 'engineering' }).click();
		await expect(preview.heading()).toHaveText('engineering');
	});

	test('a room let go outside the list goes back, and its threads stay put as a drag can’t start from them', async ({ preview, page }) => {
		await preview.open('#room=general');
		const from = await middle(page, 'engineering');
		await page.mouse.move(from.x, from.y);
		await page.mouse.down();
		await page.mouse.move(640, 400, { steps: 10 });
		await page.mouse.up();
		await expect(threadLists(page)).toHaveCount(1);
		expect(await order(page)).toEqual(['general', 'engineering']);
		// Pressing a thread (on its title) and moving doesn't carry its room.
		const thread = (await threadLists(page).locator('button[data-thread] .ap-room-label').first().boundingBox())!;
		await page.mouse.move(thread.x + thread.width / 2, thread.y + thread.height / 2);
		await page.mouse.down();
		await page.mouse.move(thread.x + thread.width / 2, thread.y + 60, { steps: 6 });
		await expect(lifted(page)).toHaveCount(0);
		await page.mouse.up();
	});

	test('Alt+↑ and Alt+↓ move the focused room, the keyboard staying on it', async ({ preview, page }) => {
		await preview.open('#room=general');
		await rows(page).filter({ hasText: 'general' }).focus();
		await page.keyboard.press('Alt+ArrowDown');
		await expect.poll(() => order(page)).toEqual(['engineering', 'general']);
		await expect(page.getByTestId('room-list').locator('button[data-room="general"]')).toBeFocused();
		await page.keyboard.press('Alt+ArrowUp');
		await expect.poll(() => order(page)).toEqual(['general', 'engineering']);
		await expect(page.getByTestId('room-list').locator('button[data-room="general"]')).toBeFocused();
	});
});

test.describe('room order, by touch', () => {
	test.use({ ...DEVICES.tablet, hasTouch: true });

	/** Touches through the browser's own input, which svelte-dnd-action listens to as a phone's. */
	async function finger(context: BrowserContext, page: Page) {
		const cdp = await context.newCDPSession(page);
		return (type: 'touchStart' | 'touchMove' | 'touchEnd', x = 0, y = 0) =>
			cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
	}

	/** A tap as a finger makes one: down for a moment, well short of the hold that lifts a room. */
	async function tap(touch: Awaited<ReturnType<typeof finger>>, page: Page, x: number, y: number): Promise<void> {
		await touch('touchStart', x, y);
		await page.waitForTimeout(60);
		await touch('touchEnd');
	}

	test('a room held lifts and can be dragged; a tap picks it and a swipe doesn’t carry it', async ({ preview, page, context }) => {
		await preview.open('#room=general');
		const touch = await finger(context, page);
		let from = await middle(page, 'engineering');
		await touch('touchStart', from.x, from.y);
		for (let i = 1; i <= 6; i++) await touch('touchMove', from.x, from.y - i * 10);
		await touch('touchEnd');
		await expect(lifted(page)).toHaveCount(0);
		expect(await order(page)).toEqual(['general', 'engineering']);

		from = await middle(page, 'engineering');
		await touch('touchStart', from.x, from.y);
		await expect(lifted(page)).toHaveCount(1);
		await expect(threadLists(page)).toHaveCount(0);
		const to = await middle(page, 'general');
		for (let i = 1; i <= 12; i++) await touch('touchMove', from.x, from.y + (to.top + 4 - from.y) * (i / 12));
		await touch('touchEnd');
		await expect.poll(() => order(page)).toEqual(['engineering', 'general']);
		await expect(threadLists(page)).toHaveCount(1);
		await expect(preview.heading()).toHaveText('general');

		// A tap picks once: a second click would find it open, and fold its threads.
		from = await middle(page, 'engineering');
		await tap(touch, page, from.x, from.y);
		await expect(preview.heading()).toHaveText('engineering');
		await page.waitForTimeout(300);
		await expect(page.getByTestId('expand-threads')).toHaveCount(0);
		// A thread tapped opens it, not a drag of its room.
		await page.getByTestId('room-list').locator('button[data-room="general"]').click();
		const thread = (await threadLists(page).locator('button[data-thread] .ap-room-label').first().boundingBox())!;
		await tap(touch, page, thread.x + thread.width / 2, thread.y + thread.height / 2);
		await expect(preview.heading()).toHaveText(/^general › /);
	});
});

test.describe('folding a room on a phone', () => {
	test.use(DEVICES.phone);

	test('tapping the open room folds its threads in the rooms list, which stays, its › going back to the room', async ({ preview, page }) => {
		await preview.open('#room=general');
		await preview.roomsPane();
		const general = page.getByTestId('room-list').locator('button[data-room="general"]');
		await expect(threadLists(page)).toHaveCount(1);
		await preview.press(general);
		await expect(page.getByTestId('room-list')).toBeVisible();
		await expect(page.getByTestId('expand-threads')).toBeVisible();
		await expect(threadLists(page)).toHaveCount(0);
		await preview.press(general);
		await expect(page.getByTestId('expand-threads')).toHaveCount(0);
		await expect(threadLists(page)).toHaveCount(1);
		await preview.press(page.getByRole('button', { name: 'Back to general' }));
		await expect(page.getByTestId('room-list')).toBeHidden();
		await expect(preview.heading()).toHaveText('general');
	});
});
