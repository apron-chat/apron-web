import { DEVICES, expect, test } from './fixtures';

/**
 * Search messages (`SearchDialog`): Ctrl/⌘K or the room header's magnifier, words, and `user:` and `room:`
 * filters. On `/__preview`, which keeps nothing on the device, it searches what the page holds; history.spec.ts
 * searches what a reload kept.
 */

test.use(DEVICES.desktop);

test('narrows by room and by person, and opens a result in its room', async ({ preview, page }) => {
	await preview.open();
	await page.getByRole('button', { name: 'Search messages' }).click();
	const search = page.getByRole('dialog', { name: 'Search messages' });
	await expect(search).toContainText('Messages loaded on this page.');
	const field = search.getByRole('combobox');
	const results = search.getByTestId('search-results').getByRole('option');

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
