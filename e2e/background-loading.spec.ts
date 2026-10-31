import { DEVICES, expect, test } from './fixtures';

/**
 * What shows while history loads beyond the room on screen: other rooms catching up (the room header's moving line,
 * not the "Checking…" pill), and older messages loading reading back (a pill at the top of the timeline).
 */

test.use({ ...DEVICES.phone, knobs: { historyDelayMs: 1_200, filler: { general: 80 } } });

test('other rooms catching up run a line under the header, and older messages loading say so at the top', async ({ preview, page }) => {
	test.setTimeout(60_000);
	await preview.open();
	const list = page.getByTestId('message-list');
	await expect(list.getByText('Message 80 of 80')).toBeVisible();
	// general is current; the other rooms are still loading their newest pages, one at a time.
	const updating = page.getByTestId('room-updating');
	await expect(updating).toBeVisible();
	await expect(page.getByText('Checking for new messages…')).toHaveCount(0);
	await page.screenshot({ path: process.env.SHOTS ? process.env.SHOTS + '/updating.png' : undefined });
	await expect(updating).toHaveCount(0, { timeout: 30_000 });
	// Reading back to the top loads the page before.
	await list.evaluate((node) => node.scrollTo({ top: 0 }));
	const older = page.getByRole('status').getByText('Loading earlier messages…');
	await expect(older).toBeVisible();
	await page.screenshot({ path: process.env.SHOTS ? process.env.SHOTS + '/older.png' : undefined });
	await expect(older).toHaveCount(0, { timeout: 10_000 });
});
