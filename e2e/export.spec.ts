import { readFile } from 'node:fs/promises';
import { DEVICES, expect, test } from './fixtures';

/**
 * Preferences' Export saves what the page has loaded as a `.jsonl` file, and `/archive` reads one back in the
 * same app, read-only, against a server in the page that serves only that file.
 */

test.use(DEVICES.desktop);

test('an export opens on /archive as it was, read-only', async ({ preview, page }) => {
	await preview.open();
	await page.getByRole('button', { name: /^Open preferences/ }).click();
	const preferences = page.getByRole('dialog', { name: 'Preferences' });
	await preferences.getByRole('navigation').getByRole('button', { name: 'History' }).click();
	const [download] = await Promise.all([page.waitForEvent('download'), preferences.getByTestId('export-chats').click()]);
	expect(download.suggestedFilename()).toMatch(/^apron-apron-preview\.invalid-\d{4}-\d{2}-\d{2}\.jsonl$/);
	// The note under the row (the dialog's live region says it too).
	await expect(preferences.locator('.ap-pref-note', { hasText: /^Saved / })).toHaveText(/^Saved apron-.*\.jsonl: \d+ messages in \d+ rooms\.$/);
	const text = await readFile((await download.path())!, 'utf8');
	// The thread was never opened here, and is exported with its messages all the same.
	expect(text).toContain('"room_id":"thread_deploy","from"');

	await page.goto(`${process.env.E2E_URL}/archive`);
	await page.getByTestId('archive-file').setInputFiles({ name: download.suggestedFilename(), mimeType: 'application/jsonl', buffer: Buffer.from(text) });
	// Its images load from the sites it names only when asked to.
	await expect(page.getByTestId('archive-hosts')).toContainText('apron-preview.invalid');
	await page.getByRole('button', { name: 'Open without images' }).click();
	await expect(page.getByText(/^An export from apron-preview\.invalid, saved .+\. It’s read-only\.$/)).toBeVisible();
	await page.locator('[data-room="general"]').first().click();
	await expect(page.getByText('Welcome to Apron!', { exact: false })).toBeVisible();
	await expect(page.getByRole('textbox', { name: /^Message/ })).toHaveCount(0);

	await page.getByText('Deploy checklist').first().click();
	await expect(page.getByText('Thread replies are ordinary messages in a child room.')).toBeVisible();
});

test('a file that isn’t an export says so', async ({ page }) => {
	await page.goto(`${process.env.E2E_URL}/archive`);
	await page.getByTestId('archive-file').setInputFiles({ name: 'notes.jsonl', mimeType: 'application/jsonl', buffer: Buffer.from('{"hello":1}\n') });
	await expect(page.getByRole('alert')).toHaveText('This file isn’t an Apron export.');
});
