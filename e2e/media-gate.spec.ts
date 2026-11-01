import type { Page } from '@playwright/test';
import { DEVICES, expect, test, type Preview } from './fixtures';

/**
 * Media loads only where Preferences' Media lets it (`$lib/ui/media-gate`, `$lib/protocol/sanitize`): every kind
 * of media a server or a sender can name, all of it on a site that isn't the server's, and not one request reaches
 * it until the viewer clicks Load (that one) or Always load (its site). A component that loads media some other way
 * shows up here as a request.
 */

test.use(DEVICES.desktop);
// Requests through the service worker don't reach `page.route`: without it, every one does.
test.use({ serviceWorkers: 'block' });

const TRACKER = 'https://tracker.example';
const CATALOG = { ':tracked:': { url: `${TRACKER}/emoji.png`, static_url: `${TRACKER}/emoji-still.png` } };

test.use({
	knobs: {
		capabilities: ['ext:emoji'],
		server: { avatar: `${TRACKER}/server.png`, ext: { emoji: { catalog_url: `data:application/json,${encodeURIComponent(JSON.stringify(CATALOG))}` } } },
		people: { grace: { avatar: `${TRACKER}/grace.png` } }
	}
});

/**
 * Every request the page makes to the tracker, from now on, by its path: seen as the page makes it, whatever then
 * answers it (the preview's fixture aborts every request off the site).
 */
function watchTracker(page: Page): string[] {
	const asked: string[] = [];
	page.on('request', (request) => {
		if (request.url().startsWith(`${TRACKER}/`)) asked.push(new URL(request.url()).pathname);
	});
	return asked;
}

/** Chooses where media loads from before the page loads, as Preferences would have saved it. */
async function chooseMedia(page: Page, policy: string): Promise<void> {
	await page.addInitScript((policy) => localStorage.setItem('apron.media', JSON.stringify({ policy, origins: [] })), policy);
}

const HTML = [
	`<p>Build report</p><img src="${TRACKER}/html.png" alt="Chart" srcset="${TRACKER}/html-2x.png 2x">`,
	`<video poster="${TRACKER}/poster.jpg"><source src="${TRACKER}/clip.mp4"><track src="${TRACKER}/captions.vtt"></video>`,
	`<audio src="${TRACKER}/sound.mp3"></audio>`,
	`<table background="${TRACKER}/bg.png"><tbody><tr><td>cell</td></tr></tbody></table>`,
	`<a href="https://example.com" ping="${TRACKER}/ping">a link</a>`
].join('');

/** Messages that name media on the tracker every way a body can; resolves to the first's id. */
async function postEverything(preview: Preview): Promise<string> {
	const markdown = await preview.post('general', 'grace', `Look: ![a pixel](${TRACKER}/markdown.png) and :tracked:`);
	await preview.post('general', 'grace', { text: 'Plain :tracked:' });
	await preview.post('general', 'grace', { text: 'An embed', embeds: [{ kind: 'html', html: HTML }] });
	await preview.post('general', 'grace', { text: 'A card', embeds: [{ kind: 'link', url: 'https://news.example/story', og: { title: 'A story', image: { url: `${TRACKER}/og.png` }, video: { url: `${TRACKER}/og.mp4` } } }] });
	await preview.post('general', 'grace', { text: 'A file', embeds: [{ kind: 'upload', embed_id: 'e1', url: `${TRACKER}/file.png`, title: 'file.png', og: { image: { url: `${TRACKER}/upload.png` } } }] });
	await preview.reactAs('grace', markdown, [':tracked:']);
	return markdown;
}

/** Opens the reaction picker on a message, from its toolbar, shown on hover; resolves once the picker is ready. */
async function openPicker(preview: Preview, id: string): Promise<void> {
	const message = preview.page.locator(`article[data-message-id="${id}"]`);
	const button = message.getByRole('button', { name: 'React', exact: true });
	await expect(async () => {
		await message.hover();
		await expect(button).toBeVisible({ timeout: 1000 });
	}).toPass();
	await button.click();
	await expect(preview.page.getByRole('dialog', { name: 'Emoji picker', exact: true })).toHaveAttribute('data-state', 'ready');
}

test('by default, nothing loads from anywhere else until asked; Load loads that one, Always load its whole site', async ({ preview, page }) => {
	const asked = watchTracker(page);
	await preview.open();
	const markdown = await postEverything(preview);

	await test.step('by default, nothing loads from anywhere else until asked, whatever names it', async () => {
		await expect(page.getByText('A file')).toBeVisible();
		// The catalog has arrived: its emoji is offered, without its picture.
		await preview.composer().pressSequentially(':track');
		const suggestion = page.getByRole('listbox', { name: 'Emoji suggestions' }).getByRole('option').first();
		await expect(suggestion).toContainText(':tracked:');
		await expect(suggestion.locator('img')).toHaveCount(0);
		// What may not load waits for a click: images, video and audio in messages, embeds and cards; the emoji is its key,
		// the avatar initials.
		for (const what of ['a pixel', 'Chart', 'Video', 'Audio']) await expect(page.getByRole('button', { name: `Load ${what} from tracker.example` }).first()).toBeVisible();
		for (const card of ['A story', 'file.png']) await expect(page.locator('.ap-embed-held').filter({ hasText: card }).getByRole('button', { name: 'Load Image from tracker.example' })).toBeVisible();
		await expect(page.getByText('Plain :tracked:')).toBeVisible();
		await page.keyboard.press('Escape');
		// The picker leaves out an emoji it may not show.
		await openPicker(preview, markdown);
		const picker = page.getByRole('dialog', { name: 'Emoji picker', exact: true });
		await picker.locator('em-emoji-picker input[type="search"]').fill('tracked');
		await expect(page.getByRole('button', { name: ':tracked:', exact: true })).toHaveCount(0);
		await expect(page.locator('img[src^="https://tracker.example"]')).toHaveCount(0);
		await page.waitForTimeout(500);
		expect(asked).toEqual([]);
		await page.keyboard.press('Escape');
		await expect(picker).toHaveCount(0);
	});

	await test.step('Load loads that one, and nothing else from its site', async () => {
		await page.getByRole('button', { name: 'Load a pixel from tracker.example' }).click();
		await expect(page.locator(`img[src="${TRACKER}/markdown.png"]`)).toHaveCount(1);
		await expect(page.getByRole('button', { name: 'Load Chart from tracker.example' })).toBeVisible();
		await page.waitForTimeout(500);
		expect([...new Set(asked)]).toEqual(['/markdown.png']);
	});

	await test.step('Always load trusts the site from now on, in Preferences too', async () => {
		await page.getByRole('button', { name: 'Always load from tracker.example' }).first().click();
		await expect(page.locator(`img[src="${TRACKER}/markdown.png"]`)).toHaveCount(1);
		await expect(page.getByRole('button', { name: /^Load .* from tracker\.example$/ })).toHaveCount(0);
		// A card's and an upload's pictures load lazily: in view.
		await page.locator(`img[src="${TRACKER}/upload.png"]`).scrollIntoViewIfNeeded();
		// Avatars, images, emoji, embeds, cards and uploads. (The emoji's still copy: a headless browser prefers reduced motion.)
		await expect.poll(() => [...new Set(asked)].sort()).toEqual(expect.arrayContaining(['/grace.png', '/markdown.png', '/emoji-still.png', '/html.png', '/poster.jpg', '/sound.mp3', '/server.png', '/og.png', '/upload.png']));
		// A srcset, a background and a ping never stay.
		for (const never of ['/html-2x.png', '/bg.png', '/ping']) expect(asked).not.toContain(never);
		await page.getByRole('button', { name: /^Open preferences/ }).click();
		const preferences = page.getByRole('dialog', { name: 'Preferences' });
		await preferences.getByRole('navigation').getByRole('button', { name: 'Media' }).click();
		await expect(preferences.getByTestId('media-sites')).toHaveValue('tracker.example');
	});
});

test.describe('a catalog of custom emoji on another site', () => {
	test.use({ knobs: { capabilities: ['ext:emoji'], server: { ext: { emoji: { catalog_url: `${TRACKER}/catalog.json` } } } } });

	test('by default, is never asked for, whatever asks for it', async ({ preview, page }) => {
		const asked = watchTracker(page);
		await preview.open();
		const id = await preview.post('general', 'grace', 'Party :tracked:');
		await expect(page.getByText('Party :tracked:')).toBeVisible();
		await preview.reactAs('grace', id, [':tracked:']);
		await preview.composer().pressSequentially(':track');
		await page.keyboard.press('Escape');
		await openPicker(preview, id);
		await page.waitForTimeout(500);
		expect(asked).toEqual([]);
	});

	test('with Any site, is asked for', async ({ preview, page }) => {
		const asked = watchTracker(page);
		await chooseMedia(page, 'any');
		await preview.open();
		await preview.post('general', 'grace', 'Party :tracked:');
		await expect.poll(() => asked).toContain('/catalog.json');
	});
});

test('with Any site, everything loads from anywhere, but a srcset, a background or a ping', async ({ preview, page }) => {
	const asked = watchTracker(page);
	await chooseMedia(page, 'any');
	await preview.open();
	await postEverything(preview);
	await expect(page.getByText('A file')).toBeVisible();
	await expect(page.locator(`img[src="${TRACKER}/markdown.png"]`)).toHaveCount(1);
	await expect(page.locator('.ap-media-ask')).toHaveCount(0);
	await page.locator(`img[src="${TRACKER}/upload.png"]`).scrollIntoViewIfNeeded();
	await expect.poll(() => [...new Set(asked)].sort()).toEqual(expect.arrayContaining(['/grace.png', '/markdown.png', '/emoji-still.png', '/html.png', '/poster.jpg', '/sound.mp3', '/server.png', '/og.png', '/upload.png']));
	for (const never of ['/html-2x.png', '/bg.png', '/ping']) expect(asked).not.toContain(never);
});

test('Block hides what its site would show, whatever trusts it, and lists it in Preferences', async ({ preview, page }) => {
	const asked = watchTracker(page);
	await preview.open();
	await postEverything(preview);
	await expect(page.getByText('A file')).toBeVisible();
	await page.getByRole('button', { name: 'Block tracker.example' }).first().click();
	// Nothing from it waits for a click any more, and nothing loads.
	await expect(page.locator('.ap-media-ask')).toHaveCount(0);
	await page.getByRole('button', { name: /^Open preferences/ }).click();
	const preferences = page.getByRole('dialog', { name: 'Preferences' });
	await preferences.getByRole('navigation').getByRole('button', { name: 'Media' }).click();
	await expect(preferences.getByTestId('media-blocked')).toHaveValue('tracker.example');
	// Blocked wins over trusted, and over Any site.
	await preferences.getByTestId('media-sites').fill('tracker.example');
	await preferences.getByTestId('media-sites').blur();
	await preferences.getByTestId('media-policy').selectOption('any');
	await page.waitForTimeout(500);
	expect(asked).toEqual([]);
	// Unblocked, it loads as Any site says.
	await preferences.getByTestId('media-blocked').fill('');
	await preferences.getByTestId('media-blocked').blur();
	await expect.poll(() => asked).toContain('/markdown.png');
});
