import type { Page } from '@playwright/test';
import { DEVICES, expect, test } from './fixtures';

/**
 * Search local history (`SearchDialog`): Ctrl/⌘F or the room header's ⋯ menu, text, and `user:` and `room:`
 * filters. On `/__preview`, which keeps nothing on the device, it searches what the page holds; history.spec.ts
 * searches what a reload kept.
 */

test.use(DEVICES.desktop);

/** The button beside its title, how far back history is kept, opens Preferences at History, where that is chosen. */
async function historyLink(page: Page): Promise<void> {
	await page.getByTestId('room-actions').first().click();
	await page.getByTestId('search-history').click();
	const search = page.getByRole('dialog', { name: 'Search Local History' });
	await search.getByRole('button', { name: '30 Days of history kept, in Preferences' }).click();
	await expect(search).toHaveCount(0);
	const preferences = page.getByRole('dialog', { name: 'Preferences' });
	await expect(preferences).toBeVisible();
	await expect(preferences.getByTestId('history-retention')).toBeVisible();
}

test('suggests people for user: and rooms for room:, narrows by room and by person, and opens a result in its room', async ({ preview, page }) => {
	await preview.open();

	await test.step('suggests people for user: and rooms for room:, as the composer does for @ and #', async () => {
		await page.keyboard.press('ControlOrMeta+f');
		const search = page.getByRole('dialog', { name: 'Search Local History' });
		const field = search.getByRole('combobox');
		const suggestions = search.getByTestId('search-suggestions');

		await field.fill('thread user:@li');
		await expect(suggestions.getByRole('option')).toHaveCount(1);
		await expect(suggestions).toContainText('Linus');
		await expect(field).toHaveAttribute('aria-controls', (await suggestions.getAttribute('id'))!);
		await field.press('Enter');
		await expect(field).toHaveValue('thread user:@linus ');
		await expect(suggestions).toHaveCount(0);
		await expect(search.getByTestId('search-results').getByRole('option')).toHaveCount(2);

		await field.pressSequentially('room:eng');
		await expect(suggestions).toContainText('engineering');
		await field.press('Tab');
		await expect(field).toHaveValue('thread user:@linus room:#engineering ');
		await expect(search.getByTestId('search-results').getByRole('option')).toHaveCount(1);

		// Escape puts the suggestions away first; then, as in any search field, it clears it, and then closes.
		await field.pressSequentially('room:');
		await expect(suggestions).toBeVisible();
		await field.press('Escape');
		await expect(suggestions).toHaveCount(0);
		await expect(field).toHaveValue('thread user:@linus room:#engineering room:');
		await field.press('Escape');
		await expect(field).toHaveValue('');
		await expect(search).toBeVisible();
		await field.press('Escape');
		await expect(search).toHaveCount(0);
	});

	await test.step('narrows by room and by person, and opens a result in its room', async () => {
		await page.getByTestId('room-actions').click();
		await page.getByTestId('search-history').click();
		const search = page.getByRole('dialog', { name: 'Search Local History' });
		await expect(search).toContainText('Messages loaded on this page.');
		const field = search.getByRole('combobox');
		const results = search.getByTestId('search-results').getByRole('option');

		// Opened from a room, it starts narrowed to that room, the caret after it.
		await expect(field).toHaveValue('room:#general ');
		await field.pressSequentially('thread');
		await expect(field).toHaveValue('room:#general thread');
		await expect(results).toHaveCount(3);
		await expect(results.locator('.ap-search-room')).toHaveText(['general', 'general', 'general']);

		await field.fill('thread');
		await expect(results).toHaveCount(4);
		await field.fill('thread user:@linus');
		await expect(results).toHaveCount(2);
		await expect(results.locator('.ap-search-who')).toHaveText(['Linus', 'Linus']);
		await field.fill('room:#engineering thread');
		await expect(results).toHaveCount(1);
		await expect(results.first()).toContainText('engineering');

		await results.first().click();
		await expect(search).toHaveCount(0);
		await expect(page.getByRole('heading', { level: 1 })).toHaveText('engineering');
		await expect(page.locator('article[data-message-id]', { hasText: 'Engineering room preview' })).toBeInViewport();
	});
});

test('Ctrl/⌘F opens no search over another dialog, the history kept opens its preferences, and opened from a thread, search starts narrowed to it', async ({ preview, page }) => {
	await preview.open();

	await test.step('Ctrl/⌘F opens no search over another dialog, and Ctrl/⌘K none at all', async () => {
		// Kept for a quick switcher.
		await page.keyboard.press('ControlOrMeta+k');
		await expect(page.getByRole('dialog', { name: 'Search Local History' })).toHaveCount(0);
		await page.getByRole('button', { name: /^Open preferences/ }).click();
		await expect(page.getByRole('dialog', { name: 'Preferences' })).toBeVisible();
		await page.keyboard.press('ControlOrMeta+f');
		await expect(page.getByRole('dialog', { name: 'Search Local History' })).toHaveCount(0);
		await page.keyboard.press('Escape');
		await expect(page.getByRole('dialog', { name: 'Preferences' })).toHaveCount(0);
		await page.keyboard.press('ControlOrMeta+f');
		await expect(page.getByRole('dialog', { name: 'Search Local History' })).toBeVisible();
	});

	await test.step('the history kept, beside the title, opens the history preferences', async () => {
		// The search Ctrl/⌘F just opened, closed: Escape clears the field, then closes it.
		const search = page.getByRole('dialog', { name: 'Search Local History' });
		await search.getByRole('combobox').press('Escape');
		await search.getByRole('combobox').press('Escape');
		await expect(search).toHaveCount(0);
		await historyLink(page);
	});

	await test.step('opened from a thread, it starts narrowed to that thread', async () => {
		await page.keyboard.press('Escape');
		await expect(page.getByRole('dialog', { name: 'Preferences' })).toHaveCount(0);
		await preview.openThread('thread_deploy');
		await page.keyboard.press('ControlOrMeta+f');
		await expect(page.getByRole('dialog', { name: 'Search Local History' }).getByRole('combobox')).toHaveValue('room:#thread_deploy ');
	});
});

test.describe('on a phone', () => {
	test.use(DEVICES.phone);

	test('the title links to the history preferences, from a room', async ({ preview, page }) => {
		await preview.open();
		await historyLink(page);
	});
});
