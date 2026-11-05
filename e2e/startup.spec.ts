import type { Page, Route } from '@playwright/test';
import { DEVICES, expect, test } from './fixtures';

/**
 * Startup, as users meet it: what the first frame draws, and what the page does while code it loads on demand is
 * still on its way. Run it when changing what startup draws or what loads on demand (see AGENTS.md).
 *
 * The on-demand chunk (`src/lib/components/on-demand.ts`) and the layout's overlays (`overlays.ts`) come about
 * 2 s after the page settles (`prefetchLazy`), or when first asked for: here they are held until the test lets
 * them go, as a slow network, or a click in those first seconds, has them. Without the service worker, whose
 * fetches the page's routes don't see.
 */

/**
 * Strings only the held chunks hold: the carried room's copy's id (`room-drag.ts`, on-demand), the emoji picker's
 * mount (overlays). Not a class the layout's own code shares (the terminal viewer draws the image viewer's bar).
 */
const HELD = /ap-room-carried|ap-emojipop-mount/;

/** Holds the code that loads on demand until `release`; every other script goes through. */
async function holdOnDemand(page: Page): Promise<{ release: () => Promise<void>; held: () => number }> {
	const waiting: Array<() => Promise<void>> = [];
	let holding = true;
	await page.route('**/_app/immutable/**/*.js', async (route: Route) => {
		const response = await route.fetch();
		const body = await response.text();
		const go = () => route.fulfill({ response, body });
		if (holding && HELD.test(body)) waiting.push(go);
		else await go();
	});
	return {
		held: () => waiting.length,
		release: async () => {
			holding = false;
			await Promise.all(waiting.splice(0).map((go) => go()));
		}
	};
}

test.describe('startup, with the code that loads on demand held back', { tag: '@full' }, () => {
	test.use({ ...DEVICES.desktop, serviceWorkers: 'block' });

	test('Enter sends while the mention picker’s code is on its way, as nothing on screen says otherwise; once it comes, the picker shows', async ({ preview, page }) => {
		const chunks = await holdOnDemand(page);
		await preview.open();
		await preview.composer().click();
		await page.keyboard.type('hi @ad');
		// The picker asked for its code: held, so nothing shows, and Enter is the field's.
		await expect.poll(chunks.held).toBeGreaterThan(0);
		await expect(page.getByTestId('mention-picker')).toHaveCount(0);
		await page.keyboard.press('Enter');
		const sent = await preview.waitForSent('message', (p) => p.body?.text === 'hi @ad');
		expect(sent.body.mentions ?? []).toEqual([]);

		await chunks.release();
		await page.keyboard.type('@ad');
		await expect(page.getByTestId('mention-picker').getByRole('option').first()).toHaveText(/Ada Lovelace/);
	});

	test('a profile card asked for before its code comes lets go on Escape, and doesn’t open late; one left alone opens as the code lands', async ({ preview, page }) => {
		const chunks = await holdOnDemand(page);
		await preview.open();
		const list = await preview.showMembers();
		await preview.memberProfile(list, 'ada');
		await expect.poll(chunks.held).toBeGreaterThan(0);
		await expect(page.getByTestId('profile-card')).toHaveCount(0);
		await page.keyboard.press('Escape');
		await chunks.release();
		// The code has come (the room lists, from the same chunk, take their drag code) and mounted the host: the card
		// it was asked for, let go, stays shut.
		await expect(page.locator('.ap-roomlist[data-reorderable]').first()).toBeAttached();
		await page.waitForTimeout(300);
		await expect(page.getByTestId('profile-card')).toHaveCount(0);

		// Asked again, now that the code is here: it opens at once.
		await preview.memberProfile(list, 'ada');
		await expect(page.getByTestId('profile-card')).toBeVisible();
	});

	test('a second press on the member’s row while the card’s code is on its way takes the ask back, as it closes the card once shown', async ({ preview, page }) => {
		const chunks = await holdOnDemand(page);
		await preview.open();
		const list = await preview.showMembers();
		await preview.memberProfile(list, 'ada');
		await expect.poll(chunks.held).toBeGreaterThan(0);
		await preview.memberProfile(list, 'ada');
		await chunks.release();
		await expect(page.locator('.ap-roomlist[data-reorderable]').first()).toBeAttached();
		await page.waitForTimeout(300);
		await expect(page.getByTestId('profile-card')).toHaveCount(0);
	});

	test('a profile card asked for before its code comes, and left alone, opens once it lands', async ({ preview, page }) => {
		const chunks = await holdOnDemand(page);
		await preview.open();
		const list = await preview.showMembers();
		await preview.memberProfile(list, 'ada');
		await expect.poll(chunks.held).toBeGreaterThan(0);
		await expect(page.getByTestId('profile-card')).toHaveCount(0);
		await chunks.release();
		await expect(page.getByTestId('profile-card')).toBeVisible();
	});

	test('rooms can be dragged once their code comes, and not before; the rest of the room list works meanwhile', async ({ preview, page }) => {
		const chunks = await holdOnDemand(page);
		await preview.open('#room=general');
		const rooms = page.getByRole('complementary', { name: 'Rooms' });
		// A pointer over the list asks for the drag code: held.
		await rooms.locator('button[data-room]').first().hover();
		await expect.poll(chunks.held).toBeGreaterThan(0);
		await expect(rooms.locator('.ap-roomlist[data-reorderable]')).toHaveCount(0);
		// A click still opens a room.
		await rooms.locator('button[data-room="engineering"]').click();
		await expect(preview.heading()).toHaveText('engineering');

		await chunks.release();
		await expect(rooms.locator('.ap-roomlist[data-reorderable]').first()).toBeAttached();
		await expect(rooms.locator('.ap-roomlist:not([data-reorderable])')).toHaveCount(0);
	});
});

/**
 * The first painted frame's messages: which show in the message list, where, and how far from its latest the list
 * is scrolled. Read in the frame that first draws a message, after its animation-frame callbacks and layout and
 * before its paint, by an observer set before the page loads.
 */
async function watchFirstFrame(page: Page): Promise<void> {
	await page.addInitScript(() => {
		const snapshot = (list: Element) => {
			const box = list.getBoundingClientRect();
			const shown = [...list.querySelectorAll<HTMLElement>('article[data-message-id]')]
				.map((row) => ({ id: row.dataset.messageId!, top: Math.round(row.getBoundingClientRect().top - box.top), bottom: Math.round(row.getBoundingClientRect().bottom - box.top) }))
				.filter((row) => row.bottom > 0 && row.top < box.height);
			return { shown, fromLatest: Math.round(list.scrollHeight - list.clientHeight - list.scrollTop) };
		};
		const w = window as unknown as { __firstFrame: Promise<unknown>; __snapshot: () => unknown };
		w.__snapshot = () => snapshot(document.querySelector('[data-testid="message-list"]')!);
		w.__firstFrame = new Promise((resolve) => {
			const seen = () => {
				const list = document.querySelector('[data-testid="message-list"]');
				if (!list?.querySelector('article[data-message-id]')) return false;
				// In the frame that draws it, after its animation-frame callbacks (the page's own keep it at the latest,
				// scheduled after this one) and its layout, before its paint: a resize observer made then hears of it
				// there. A task after the paint would see the first of the rest already revealed.
				requestAnimationFrame(() => {
					const painted = new ResizeObserver(() => {
						painted.disconnect();
						resolve(snapshot(list));
					});
					painted.observe(list);
				});
				return true;
			};
			const observer = new MutationObserver(() => {
				if (seen()) observer.disconnect();
			});
			observer.observe(document, { childList: true, subtree: true });
		});
	});
}

type Frame = { shown: Array<{ id: string; top: number; bottom: number }>; fromLatest: number };

for (const [device, use] of [['desktop', DEVICES.desktop], ['phone', DEVICES.phone]] as const)
	for (const busy of [false, true])
		test.describe(`the first frame, on a ${device}${busy ? ', a busy account' : ''}`, { tag: '@full' }, () => {
			// A server a round trip away (`rttMs`), as a real one is: the room's history arrives after the room is shown,
			// which is when the page fills it newest first. Answered at once, it's there as the room first renders.
			// The newest messages are plain ones (`filler`): the demo's own newest, with its embeds, grows as they load
			// after the first paint, which moves what's shown however the first frame was drawn.
			test.use({ ...use, knobs: { rttMs: 150, ...(busy ? { manyRooms: 40, filler: { general: 1500 } } : { filler: { general: 30 } }) } });

			test('shows the newest messages at the latest, as they stay once the rest of the room has come', async ({ preview, page }) => {
				await watchFirstFrame(page);
				await preview.open();
				const first = (await page.evaluate(() => (window as unknown as { __firstFrame: Promise<unknown> }).__firstFrame)) as Frame;
				expect(first.shown.length, 'the first frame draws messages').toBeGreaterThan(0);
				expect(Math.abs(first.fromLatest), 'at the latest').toBeLessThanOrEqual(2);
				// The room's older messages come after the first frame, above it: once they have, nothing shown moved.
				let last: Frame | undefined;
				await expect.poll(async () => {
					const now = (await page.evaluate(() => (window as unknown as { __snapshot: () => unknown }).__snapshot())) as Frame;
					const still = JSON.stringify(now) === JSON.stringify(last);
					last = now;
					return still;
				}, { intervals: [300] }).toBe(true);
				// The same messages, each where it was (to a pixel: layout rounds).
				expect(last!.shown.map((row) => row.id)).toEqual(first.shown.map((row) => row.id));
				for (const [index, row] of last!.shown.entries()) {
					expect(Math.abs(row.top - first.shown[index].top), `${row.id}'s top`).toBeLessThanOrEqual(1);
					expect(Math.abs(row.bottom - first.shown[index].bottom), `${row.id}'s bottom`).toBeLessThanOrEqual(1);
				}
				expect(Math.abs(last!.fromLatest)).toBeLessThanOrEqual(2);
			});
		});
