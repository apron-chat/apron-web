import { DEVICES, expect, test } from './fixtures';

/** The demo's two photos from the ridge, in `general`, oldest first. */
const DUSK = 'dusk-over-the-ridge.jpg';
const DAWN = 'first-light.jpg';

test.describe('the image viewer', () => {
	test.use({ ...DEVICES.phone });

	test('opens on a tap, pages to the next, and the phone\'s Back closes it, back on the image last shown', async ({ preview, page }) => {
		await preview.open();
		const links = page.locator('a.ap-embed-imagelink');
		await preview.press(links.first());
		const viewer = page.getByRole('dialog', { name: DUSK });
		await expect(viewer).toBeVisible();
		await expect(viewer.locator('.ap-viewer-count')).toHaveText('1 of 2');
		await preview.press(viewer.getByRole('button', { name: 'Next image' }));
		await expect(page.getByRole('dialog', { name: DAWN })).toBeVisible();

		await page.goBack();
		await expect(page.locator('dialog[open]')).toHaveCount(0);
		await expect(links.nth(1)).toBeFocused();
		await expect(page.locator('article[data-message-id]').first()).toBeVisible();
	});
});

test.describe('the image viewer, closed with Escape and opened again at once', () => {
	test.use({ ...DEVICES.desktop });

	test('before its close event has come, stays open, and closed, leaves no entry for Back to find', async ({ preview, page }) => {
		await preview.open();
		const links = page.locator('a.ap-embed-imagelink');
		await links.first().click();
		await expect(page.getByRole('dialog', { name: DUSK })).toBeVisible();
		// Escape, then a click on the other image once the dialog has closed but before its `close` event (a task later).
		const between = await page.evaluate(async () => {
			const dialog = document.querySelector('dialog[open]')!;
			dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
			await new Promise<void>((settle) => queueMicrotask(settle));
			const closed = !dialog.open;
			document.querySelectorAll<HTMLElement>('a.ap-embed-imagelink')[1].click();
			return closed;
		});
		expect(between).toBe(true);
		const viewer = page.getByRole('dialog', { name: DAWN });
		await expect(viewer).toBeVisible();
		// Still open once the late close event, and any Back, have come and gone; and on its history entry.
		await page.waitForTimeout(300);
		await expect(viewer).toBeVisible();
		expect(await page.evaluate(() => JSON.stringify(history.state ?? {}))).toContain('"media"');
		await viewer.getByRole('button', { name: 'Close' }).click();
		await expect(viewer).toBeHidden();
		await expect.poll(() => page.evaluate(() => JSON.stringify(history.state ?? {}))).not.toContain('"media"');
	});
});
