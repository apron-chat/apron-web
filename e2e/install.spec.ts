import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

/** The offer to add Apron to the Home Screen (`InstallPrompt`): a phone's, a while after its session is up. */

const IPHONE_SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1';
const ANDROID_CHROME = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36';

/** Opens the preview on a fake clock, then runs it on until the offer shows, which it doesn't at first. */
async function offered(page: Page, open: () => Promise<void>, loaded?: () => Promise<void>) {
	await page.clock.install();
	await open();
	await expect(page.getByTestId('message-list')).toBeVisible();
	await loaded?.();
	// Two slots hold it, the one beside the rooms list and the one above the composer: a phone shows the second.
	const prompt = page.getByTestId('install-prompt').locator('visible=true');
	await page.clock.fastForward(10_000);
	await expect(prompt).toHaveCount(0);
	// The clock is fake: poll at once, rather than backing off in real time between its steps.
	await expect.poll(async () => {
		await page.clock.fastForward(2_000);
		return prompt.count();
	}, { timeout: 15_000, intervals: [0] }).toBe(1);
	return prompt;
}

test.describe('iPhone Safari', () => {
	test.use({ userAgent: IPHONE_SAFARI, viewport: { width: 390, height: 760 }, isMobile: true, hasTouch: true });

	test('shows how to add Apron from the Share sheet, then goes on Got it', async ({ preview, page }) => {
		const prompt = await offered(page, () => preview.open());
		await expect(prompt).toContainText('Add Apron to your Home Screen?');
		await prompt.getByRole('button', { name: 'Show me how' }).click();
		await expect(prompt.getByTestId('install-steps').locator('li')).toHaveText([/^Tap Share/, /^Choose Add to Home Screen/, 'Tap Add']);
		await prompt.getByRole('button', { name: 'Got it' }).click();
		await expect(prompt).toHaveCount(0);
	});
});

test.describe('Android Chrome', () => {
	test.use({ userAgent: ANDROID_CHROME, viewport: { width: 390, height: 760 }, isMobile: true, hasTouch: true });

	test('asks the browser to install where it offers to', async ({ preview, page }) => {
		// Chromium's offer, as it makes it once the page qualifies.
		const offer = () => page.evaluate(() => {
			const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
				prompt: async () => void ((window as any).installPrompted = true),
				userChoice: Promise.resolve({ outcome: 'accepted' })
			});
			dispatchEvent(event);
		});
		const prompt = await offered(page, () => preview.open(), offer);
		await expect(prompt.getByRole('button', { name: 'Show me how' })).toHaveCount(0);
		await prompt.getByRole('button', { name: 'Install' }).click();
		await expect(prompt).toHaveCount(0);
		expect(await page.evaluate(() => (window as any).installPrompted)).toBe(true);
	});
});

test('a computer isn’t offered it', async ({ preview, page }) => {
	await page.clock.install();
	await preview.open();
	await expect(page.getByTestId('message-list')).toBeVisible();
	await page.clock.fastForward(60_000);
	await expect(page.getByTestId('install-prompt')).toHaveCount(0);
});
