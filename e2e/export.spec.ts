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
	// The note under the row (the dialog's live region says it too): private rooms go only when asked for.
	await expect(preferences.locator('.ap-pref-note', { hasText: /^Saved / })).toHaveText(/^Saved apron-.*\.jsonl: \d+ messages in \d+ rooms; 2 private rooms left out\.$/);
	const text = await readFile((await download.path())!, 'utf8');
	// The thread was never opened here, and is exported with its messages all the same.
	expect(text).toContain('"room_id":"thread_deploy","from"');
	expect(text).not.toContain('private_');
	expect(text).not.toContain('Announcement goes out Thursday');
	await preferences.getByRole('checkbox', { name: 'Include private rooms' }).check();
	const [withPrivate] = await Promise.all([page.waitForEvent('download'), preferences.getByTestId('export-chats').click()]);
	await expect(preferences.locator('.ap-pref-note', { hasText: /^Saved / })).toHaveText(/^Saved apron-.*\.jsonl: \d+ messages in \d+ rooms\.$/);
	expect(await readFile((await withPrivate.path())!, 'utf8')).toContain('"room_id":"private_1710000000060"');

	await page.goto(`${process.env.E2E_URL}/archive`);
	await page.getByTestId('archive-file').setInputFiles({ name: download.suggestedFilename(), mimeType: 'application/jsonl', buffer: Buffer.from(text) });
	// Its images load from the sites it names only when asked to.
	await expect(page.getByTestId('archive-hosts')).toContainText('apron-preview.invalid');
	await page.getByRole('button', { name: 'Open without images' }).click();
	await expect(page.getByText(/^An export from apron-preview\.invalid, saved .+\. It’s read-only\.$/)).toBeVisible();
	// It offers only guests' sign-in, so nothing lifts read-only, and nothing offers to.
	await expect(page.locator('.ap-composer-readonly').getByRole('button', { name: 'Sign in' })).toHaveCount(0);
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

/** An export whose avatar, image and preview are on other sites: one it names for its media, and one it doesn't. */
const elsewhere = [
	{ apron_archive: 1, server: 'wss://chat.example/', exported_at: '2026-10-27T12:00:00.000Z', you: { user_id: 'ada', name: 'Ada' }, media: ['https://media.example'] },
	{ joined: [{ room_id: 'general', log_id: '1', title: 'General', latest_log_id: '3', history_log_id: '2', members: [{ user_id: 'ada' }, { user_id: 'bob' }] }], not_joined: [], users: [{ user_id: 'ada', name: 'Ada' }, { user_id: 'bob', name: 'Bob', avatar: 'https://tracker.example/bob.png' }] },
	{ messages: [{ message_id: '2', log_id: '2', room_id: 'general', from: { user_id: 'bob', name: 'Bob' }, body: { text: 'Look: ![a pixel](https://tracker.example/pixel.png)', format: 'markdown' } }] },
	{ messages: [{ message_id: '3', log_id: '3', room_id: 'general', from: { user_id: 'bob', name: 'Bob' }, body: { text: 'And a card', embeds: [{ kind: 'link', url: 'https://news.example/story', og: { title: 'A story', image: { url: 'https://media.example/story.png' } } }] } }] }
].map((line) => JSON.stringify(line)).join('\n');

test('an export opened without images loads nothing from anywhere else', async ({ page }) => {
	const asked: string[] = [];
	await page.route(/^https:\/\/(tracker|media|news)\.example\//, (route) => {
		asked.push(route.request().url());
		return route.fulfill({ status: 404 });
	});
	await page.goto(`${process.env.E2E_URL}/archive`);
	await page.getByTestId('archive-file').setInputFiles({ name: 'elsewhere.jsonl', mimeType: 'application/jsonl', buffer: Buffer.from(elsewhere) });
	await expect(page.getByTestId('archive-hosts')).toContainText('media.example');
	await page.getByRole('button', { name: 'Open without images' }).click();
	await page.locator('[data-room="general"]').first().click();
	// The image waits for a click, the avatar is initials, the card without its picture.
	await expect(page.getByRole('button', { name: 'Load a pixel from tracker.example' })).toBeVisible();
	await expect(page.getByText('A story')).toBeVisible();
	await expect(page.locator('img[src^="https://"]')).toHaveCount(0);
	expect(asked).toEqual([]);
});

test('an export opened with its images loads them from the sites it names, and nowhere else unless chosen', async ({ page }) => {
	const asked = new Set<string>();
	await page.route(/^https:\/\/(tracker|media|news)\.example\//, (route) => {
		asked.add(new URL(route.request().url()).host);
		return route.fulfill({ status: 404 });
	});
	await page.goto(`${process.env.E2E_URL}/archive`);
	await page.getByTestId('archive-file').setInputFiles({ name: 'elsewhere.jsonl', mimeType: 'application/jsonl', buffer: Buffer.from(elsewhere) });
	await page.getByRole('button', { name: 'Load images' }).click();
	await page.locator('[data-room="general"]').first().click();
	await expect(page.locator('img[src="https://media.example/story.png"]')).toHaveCount(1);
	await expect(page.getByRole('button', { name: 'Load a pixel from tracker.example' })).toBeVisible();
	expect([...asked]).toEqual(['media.example']);

	// Preferences, Media: any site, and the image and avatar on the other one load too.
	await page.getByRole('button', { name: /^Open preferences/ }).click();
	const preferences = page.getByRole('dialog', { name: 'Preferences' });
	await preferences.getByRole('navigation').getByRole('button', { name: 'Media' }).click();
	// Held to the sites it was agreed to load from, whatever Media said, which it names.
	await expect(preferences.getByTestId('media-policy')).toHaveValue('trusted');
	await expect(preferences.getByTestId('media-note')).toHaveText('From this server and the trusted origins below. Other images wait for a click.');
	await expect(preferences.getByTestId('media-server-origins')).toHaveText('Includes origins trusted by the server: media.example');
	await preferences.getByTestId('media-policy').selectOption('any');
	await expect(preferences.getByTestId('media-note')).toHaveText('Everything, from any site.');
	await page.keyboard.press('Escape');
	await expect(page.locator('img[src="https://tracker.example/pixel.png"]')).toHaveCount(1);
	await expect.poll(() => asked.has('tracker.example')).toBe(true);
});

test('Preferences, Media: the server, and the origins the viewer trusts, kept as hosts', async ({ preview, page }) => {
	await preview.open();
	await page.getByRole('button', { name: /^Open preferences/ }).click();
	const preferences = page.getByRole('dialog', { name: 'Preferences' });
	await preferences.getByRole('navigation').getByRole('button', { name: 'Media' }).click();
	await expect(preferences.getByTestId('media-policy')).toHaveValue('trusted');
	await expect(preferences.getByTestId('media-note')).toHaveText('From this server and the trusted origins below. Other images wait for a click.');
	const sites = preferences.getByTestId('media-sites');
	await sites.fill('cdn.example\nhttps://img.example/a.png\nhttp://plain.example');
	await sites.blur();
	// Kept as hosts, https only; and kept under Any site, for when it's chosen again.
	await expect(sites).toHaveValue('cdn.example\nimg.example');
	await preferences.getByTestId('media-policy').selectOption('any');
	await expect(preferences.getByTestId('media-note')).toHaveText('Everything, from any site.');
	await expect(sites).toHaveValue('cdn.example\nimg.example');
});
