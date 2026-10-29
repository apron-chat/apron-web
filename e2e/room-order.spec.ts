import type { Page } from '@playwright/test';
import { DEVICES, expect, test } from './fixtures';

/** The sidebar's top-level rooms in an order of your own (`src/lib/ui/room-order.svelte.ts`, `list-drag.svelte.ts`). */

const rooms = (page: Page) => page.getByTestId('room-list').locator('button[data-room]');
const order = (page: Page) => rooms(page).evaluateAll((buttons) => buttons.map((button) => (button as HTMLElement).dataset.room));

/** Presses on `from`'s row and lets go `dy` pixels from the middle of `to`'s row, moving in steps as a hand would. */
async function drag(page: Page, from: string, to: string, dy: number, finish: 'drop' | 'escape' = 'drop'): Promise<void> {
	const start = (await page.locator(`button[data-room="${from}"]`).boundingBox())!;
	const end = (await page.locator(`button[data-room="${to}"]`).boundingBox())!;
	await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
	await page.mouse.down();
	await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2 + dy, { steps: 8 });
	if (finish === 'escape') await page.keyboard.press('Escape');
	await page.mouse.up();
}

test.describe('room order', () => {
	test.use(DEVICES.desktop);

	test('a room dragged by its row lands where the line shows, with its threads, without opening it', async ({ preview, page }) => {
		await preview.open('#room=general');
		expect(await order(page)).toEqual(['general', 'engineering']);
		const start = (await page.locator('button[data-room="engineering"]').boundingBox())!;
		const end = (await page.locator('button[data-room="general"]').boundingBox())!;
		await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
		await page.mouse.down();
		await page.mouse.move(end.x + end.width / 2, end.y + 4, { steps: 8 });
		// The line goes above general, and engineering steps back while it's carried.
		await expect(page.locator('.ap-roomblock-drop-before[data-drag-id="general"]')).toHaveCount(1);
		await expect(page.locator('.ap-roomblock-dragged[data-drag-id="engineering"]')).toHaveCount(1);
		await page.mouse.up();
		await expect.poll(() => order(page)).toEqual(['engineering', 'general']);
		await expect(page.locator('.ap-roomblock-dragged, .ap-roomblock-drop-before, .ap-roomblock-drop-after')).toHaveCount(0);
		// The press wasn't a pick: general is still open, its threads still under it.
		await expect(preview.heading()).toHaveText('general');
		await expect(page.locator('[data-drag-id="general"] [data-testid="thread-list"]')).toBeVisible();

		// The open room moves with its threads, below engineering's middle: back to the top.
		await drag(page, 'general', 'engineering', -8);
		await expect.poll(() => order(page)).toEqual(['general', 'engineering']);
		await expect(preview.heading()).toHaveText('general');
	});

	test('Escape puts a dragged room back, and a short press stays a click', async ({ preview, page }) => {
		await preview.open('#room=general');
		await drag(page, 'engineering', 'general', -10, 'escape');
		expect(await order(page)).toEqual(['general', 'engineering']);
		await expect(preview.heading()).toHaveText('general');
		await page.locator('button[data-room="engineering"]').click();
		await expect(preview.heading()).toHaveText('engineering');
	});

	test('the room’s ⋯ menu moves it, offering only the ways it can go', async ({ preview, page }) => {
		await preview.open('#room=general');
		await page.getByRole('button', { name: 'Room actions' }).click();
		await expect(page.getByRole('menuitem', { name: 'Move up in sidebar' })).toHaveCount(0);
		await page.getByRole('menuitem', { name: 'Move down in sidebar' }).click();
		await expect.poll(() => order(page)).toEqual(['engineering', 'general']);
		await page.getByRole('button', { name: 'Room actions' }).click();
		await expect(page.getByRole('menuitem', { name: 'Move down in sidebar' })).toHaveCount(0);
		await expect(page.getByRole('menuitem', { name: 'Move up in sidebar' })).toBeVisible();
	});
});
