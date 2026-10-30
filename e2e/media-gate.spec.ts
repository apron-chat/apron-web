import type { Page } from '@playwright/test';
import { DEVICES, expect, test } from './fixtures';

/**
 * Media loads only where Preferences' Media lets it (`$lib/ui/media-gate`, `$lib/protocol/sanitize`): every kind
 * of media a server or a sender can name, all of it on a site that isn't the server's, and not one request reaches
 * it. A component that loads media some other way shows up here as a request.
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

/** Messages that name media on the tracker every way a body can. */
async function postEverything(preview: { post(room: string, from: string, body: string | Record<string, unknown>): Promise<string>; reactAs(from: string, id: string, emojis: string[]): Promise<void> }): Promise<void> {
	const markdown = await preview.post('general', 'grace', `Look: ![a pixel](${TRACKER}/markdown.png) and :tracked:`);
	await preview.post('general', 'grace', { text: 'Plain :tracked:' });
	await preview.post('general', 'grace', { text: 'An embed', embeds: [{ kind: 'html', html: HTML }] });
	await preview.post('general', 'grace', { text: 'A card', embeds: [{ kind: 'link', url: 'https://news.example/story', og: { title: 'A story', image: { url: `${TRACKER}/og.png` }, video: { url: `${TRACKER}/og.mp4` } } }] });
	await preview.post('general', 'grace', { text: 'A file', embeds: [{ kind: 'upload', embed_id: 'e1', url: `${TRACKER}/file.png`, title: 'file.png', og: { image: { url: `${TRACKER}/upload.png` } } }] });
	await preview.reactAs('grace', markdown, [':tracked:']);
}

test('with This server only, nothing loads from anywhere else, whatever names it', async ({ preview, page }) => {
	const asked = watchTracker(page);
	await chooseMedia(page, 'server');
	await preview.open();
	await postEverything(preview);
	await expect(page.getByText('A file')).toBeVisible();
	// What may not load shows another way: the image a link, the emoji its key, the avatar initials.
	await expect(page.getByRole('link', { name: 'a pixel' })).toHaveAttribute('href', `${TRACKER}/markdown.png`);
	await expect(page.getByText('Plain :tracked:')).toBeVisible();
	await expect(page.getByRole('link', { name: 'Chart' })).toBeVisible();
	// Suggestions for a custom emoji key, and the sidebar's server, ask too.
	await preview.composer().pressSequentially(':track');
	await expect(page.locator('img[src^="https://tracker.example"]')).toHaveCount(0);
	await page.waitForTimeout(500);
	expect(asked).toEqual([]);
});

test('with Default, avatars, images in messages and emoji load from anywhere, as before, and previews only from the server', async ({ preview, page }) => {
	const asked = watchTracker(page);
	await preview.open();
	await postEverything(preview);
	await expect(page.getByText('A file')).toBeVisible();
	await expect(page.locator(`img[src="${TRACKER}/markdown.png"]`)).toHaveCount(1);
	// An HTML embed's media too, as ever. (The emoji's still copy: a headless browser prefers reduced motion.)
	await expect.poll(() => [...new Set(asked)].sort()).toEqual(expect.arrayContaining(['/grace.png', '/markdown.png', '/emoji-still.png', '/html.png', '/poster.jpg', '/sound.mp3', '/server.png']));
	for (const preview of ['/og.png', '/og.mp4', '/upload.png']) expect(asked).not.toContain(preview);
	// A srcset, a background and a ping never stay, Default or not.
	for (const never of ['/html-2x.png', '/bg.png', '/ping']) expect(asked).not.toContain(never);
});
