import type { Page } from '@playwright/test';
import { DEVICES, expect, test } from './fixtures';

/**
 * Search local history (`SearchDialog`): Ctrl/⌘K or the room header's ⋯ menu, words, and `user:` and `room:`
 * filters. On `/__preview`, which keeps nothing on the device, it searches what the page holds; history.spec.ts
 * searches what a reload kept.
 */

test.use(DEVICES.desktop);

test('narrows by room and by person, and opens a result in its room', async ({ preview, page }) => {
	await preview.open();
	await page.getByTestId('room-actions').click();
	await page.getByTestId('search-history').click();
	const search = page.getByRole('dialog', { name: 'Search local history' });
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

test('suggests people for user: and rooms for room:, as the composer does for @ and #', async ({ preview, page }) => {
	await preview.open();
	await page.keyboard.press('ControlOrMeta+k');
	const search = page.getByRole('dialog', { name: 'Search local history' });
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

test('opened from a thread, it starts narrowed to that thread', async ({ preview, page }) => {
	await preview.open();
	await preview.openThread('thread_deploy');
	await page.keyboard.press('ControlOrMeta+k');
	await expect(page.getByRole('dialog', { name: 'Search local history' }).getByRole('combobox')).toHaveValue('room:#thread_deploy ');
});

/** Its title's "history" opens Preferences at History, where what this device keeps is chosen. */
async function historyLink(page: Page): Promise<void> {
	await page.getByTestId('room-actions').first().click();
	await page.getByTestId('search-history').click();
	const search = page.getByRole('dialog', { name: 'Search local history' });
	await search.getByRole('button', { name: 'history', exact: true }).click();
	await expect(search).toHaveCount(0);
	const preferences = page.getByRole('dialog', { name: 'Preferences' });
	await expect(preferences).toBeVisible();
	await expect(preferences.getByTestId('history-retention')).toBeVisible();
}

test('the title links to the history preferences', async ({ preview, page }) => {
	await preview.open();
	await historyLink(page);
});

test.describe('on a phone', () => {
	test.use(DEVICES.phone);

	test('the title links to the history preferences, from a room', async ({ preview, page }) => {
		await preview.open();
		await historyLink(page);
	});
});
