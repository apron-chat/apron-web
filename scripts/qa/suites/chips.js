// Chips, pills and inline icons, whose labels are centered on their capitals (apron.css: Centered on the capitals):
// mentions, room and link chips, a heading, a quote, a link card, reactions and role badges, read from an archive
// (scenes/chips.jsonl, opened at /archive, as scene.apron.chat serves one); and from the preview's own server, what
// only a signed-in app draws: unread counts, a thread's tag for mentions elsewhere, the composer's Command tag and a
// pick chip. Each in the system face and in DejaVu Sans, whose room above its capitals differs most from it.
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { VIEWPORTS, fontsReady, openPreview, openRoom, parkPointer, press, pressButton, timeline, typeInComposer, wait } from '../lib/helpers.js';

const SCENE = join(dirname(fileURLToPath(import.meta.url)), '..', 'scenes', 'chips.jsonl');

/** Opens the archive the way a reader does: /archive, its file chosen, read-only and offline. */
async function openArchive(page, baseUrl) {
	await page.goto(new URL('archive', baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`).href);
	await page.getByTestId('archive-file').setInputFiles(SCENE);
	await page.waitForSelector('[data-testid=message-list] .ap-msg', { timeout: 10000 });
	await fontsReady(page);
	await wait(page, 500);
}

/**
 * Before the app loads: its system face (`family`, as a machine whose system-ui is it; the theme's --font-sans, set on
 * the root's style, reads it), and, for the
 * preview, empty knobs, so the preview's server is reachable to post to (`window.__apronPreview`).
 */
const prepare = (family) => (context) =>
	context.addInitScript((family) => {
		/** @type {any} */ (window).__APRON_PREVIEW__ = {};
		if (!family) return;
		const style = () => document.head.append(Object.assign(document.createElement('style'), { textContent: `:root { --font-sans-system: ${family}; }` }));
		if (document.head) style();
		else document.addEventListener('DOMContentLoaded', style, { once: true });
	}, family);

/** Mentions of you in another room, and messages in general, so the room list shows counts and a thread its tag. */
async function unread(p) {
	await p.evaluate(() => {
		const server = /** @type {any} */ (window).__apronPreview;
		server.post('engineering', 'ada', { text: '@preview_guest the deploy is yours.', mentions: ['preview_guest'] });
		server.post('engineering', 'grace', { text: 'And @preview_guest, the review too.', mentions: ['preview_guest'] });
		for (let n = 1; n <= 12; n++) server.post('engineering', 'linus', `Build ${n} of 12 passed.`);
	});
	await wait(p, 400);
	// The first mention offers notifications, over the room list: answered, so the counts show.
	const later = p.getByRole('button', { name: 'Not now' });
	if (await later.isVisible()) await press(later);
	await wait(p, 200);
}

const archived = [
	{ name: 'archive-general', steps: (p) => timeline(p).locator('.ap-msg').last().scrollIntoViewIfNeeded() },
	{ name: 'archive-top', steps: async (p) => timeline(p).locator('.ap-msg').first().scrollIntoViewIfNeeded() },
	{ name: 'archive-thread', steps: (p) => openRoom(p, 'Release 0.9') }
	// Launch plans, a private room, shows its lock in the room list in each of these.
];

const live = [
	{ name: 'app-unread', steps: unread },
	{
		name: 'app-thread-tag',
		viewports: ['phone'],
		steps: async (p) => {
			await openRoom(p, 'Deploy checklist');
			await unread(p);
		}
	},
	{
		name: 'app-command',
		steps: async (p) => {
			await typeInComposer(p, '/me waves');
			await wait(p, 300);
		}
	},
	{
		name: 'app-pick',
		viewports: ['desktop'],
		steps: async (p) => {
			await pressButton(p, 'Add member');
			await wait(p, 300);
			// Someone the preview doesn't know, offered by @user_id: picked, a chip.
			await p.keyboard.type('Hazel');
			await wait(p, 300);
			await press(p.getByRole('option').first());
			await wait(p, 300);
		}
	}
];

const FACES = { system: undefined, dejavu: "'DejaVu Sans'" };

export default {
	description: 'Chips, pills and inline icons (labels centered on their capitals), from an archive scene and the preview, in two faces.',
	viewports: { desktop: VIEWPORTS.desktop, phone: VIEWPORTS.phone, zoom200: VIEWPORTS.zoom200 },
	themes: ['light', 'dark'],
	timeout: 8000,
	beforeShot: (p) => parkPointer(p),
	open: (page, url, t) => (t.id.startsWith('archive-') ? openArchive(page, url) : openPreview(page, url)),
	scenes: Object.entries(FACES).flatMap(([name, family]) =>
		[...archived, ...live].map((scene) => ({ ...scene, name: `${scene.name}-${name}`, context: prepare(family) }))
	)
};
