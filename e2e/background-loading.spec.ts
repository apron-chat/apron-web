import type { Page } from '@playwright/test';
import { DEVICES, expect, test } from './fixtures';

/**
 * What shows while history loads beyond the room on screen: other rooms catching up (the room header's moving line,
 * not the "Checking…" pill), and older messages loading reading back (a pill at the top of the timeline).
 * The memory server answers each history request a while late, on the page's fake clock, which the test runs on.
 */

/** How late the memory server answers each history request. */
const HISTORY_DELAY_MS = 1_200;

test.use({ ...DEVICES.phone, knobs: { historyDelayMs: HISTORY_DELAY_MS, filler: { general: 80 } } });

/**
 * Runs the page's clock on, `step` at a time, until `done`; polled at once, since the clock is fake. A step shorter
 * than an answer's delay sees what shows only while one is awaited.
 */
async function runUntil(page: Page, step: number, done: () => Promise<boolean>): Promise<void> {
	await expect.poll(async () => {
		if (await done()) return true;
		await page.clock.fastForward(step);
		return done();
	}, { intervals: [0] }).toBe(true);
}

test('other rooms catching up run a line under the header, and older messages loading say so at the top', async ({ preview, page }) => {
	await page.clock.install();
	await preview.open();
	const list = page.getByTestId('message-list');
	await expect(list.getByText('Message 80 of 80')).toBeVisible();
	// general is current; the other rooms are still loading their newest pages, one at a time.
	const updating = page.getByTestId('room-updating');
	await runUntil(page, 100, () => updating.isVisible());
	await expect(updating).toBeVisible();
	await expect(page.getByText('Checking for new messages…')).toHaveCount(0);
	await page.screenshot({ path: process.env.SHOTS ? process.env.SHOTS + '/updating.png' : undefined });
	await runUntil(page, HISTORY_DELAY_MS, async () => (await updating.count()) === 0);
	// Reading back to the top loads the page before.
	await list.evaluate((node) => node.scrollTo({ top: 0 }));
	const older = page.getByRole('status').getByText('Loading earlier messages…');
	await runUntil(page, 100, () => older.isVisible());
	await expect(older).toBeVisible();
	await page.screenshot({ path: process.env.SHOTS ? process.env.SHOTS + '/older.png' : undefined });
	await runUntil(page, HISTORY_DELAY_MS, async () => (await older.count()) === 0);
});
