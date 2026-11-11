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

test.describe('the image viewer, closed with Escape', () => {
	test.use({ ...DEVICES.desktop });

	test('leaves no entry for Back to find, and opens again at once', async ({ preview, page }) => {
		await preview.open();
		const link = page.locator('a.ap-embed-imagelink').first();
		await link.click();
		const viewer = page.getByRole('dialog', { name: DUSK });
		await expect(viewer).toBeVisible();
		await page.keyboard.press('Escape');
		await expect(viewer).toBeHidden();
		await expect(link).toBeFocused();
		// Opened again straight away, before the Back that closing went has landed: it stays open.
		await page.keyboard.press('Enter');
		await expect(viewer).toBeVisible();
		await expect.poll(() => page.evaluate(() => JSON.stringify(history.state ?? {}))).toContain('"media"');
		await expect(viewer).toBeVisible();
		await viewer.getByRole('button', { name: 'Close' }).click();
		await expect(viewer).toBeHidden();
		await expect.poll(() => page.evaluate(() => JSON.stringify(history.state ?? {}))).not.toContain('"media"');
	});
});
