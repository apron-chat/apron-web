import type { Locator, Page } from '@playwright/test';
import { NOW } from '../scripts/qa/lib/helpers.js';
import { DEVICES, expect, test } from './fixtures';

/**
 * What shows while history loads beyond the room on screen: other rooms catching up (the room header's moving line,
 * not the "Checking…" pill), and older messages loading reading back (a pill at the top of the timeline).
 * The memory server answers each history request a while late, on the page's fake clock, which the test runs on.
 */

/** How late the memory server answers each history request. */
const HISTORY_DELAY_MS = 1_200;

test.use({ ...DEVICES.phone, knobs: { historyDelayMs: HISTORY_DELAY_MS, filler: { general: 80 } } });

/**
 * Opens the preview with the page's clock stopped once it is up: from there it moves only as the test runs it on.
 * Left running on its own, its timers fire as time passes, and the page's frames are among them
 * (`requestAnimationFrame`): one that pins the pane back to its latest could then land between a scroll and that
 * scroll's event, as a real frame never does (its callbacks come after the event), and the pane would never hear it
 * was scrolled. The date stays the preview's `NOW`.
 */
async function openStopped(page: Page, open: () => Promise<void>): Promise<void> {
	await page.clock.install();
	await open();
	await page.clock.pauseAt(NOW);
	await page.clock.setFixedTime(NOW);
}

/**
 * Scrolls the list to its top, or `fromEnd` pixels short of its end, as a reader does: after a frame has drawn what
 * the pane did last, so its own scroll's event has come (an intersection observer's first answer comes after a real
 * frame, which the stopped clock's `requestAnimationFrame` would not wait for). Returns once the pane has had this
 * scroll's event (the page's own handler runs before this one), with where it left the list.
 */
function scrollList(list: Locator, fromEnd?: number): Promise<number> {
	return list.evaluate(async (node, fromEnd) => {
		await new Promise<void>((resolve) => {
			const observer = new IntersectionObserver(() => {
				observer.disconnect();
				resolve();
			});
			observer.observe(node);
		});
		return new Promise<number>((resolve) => {
			const top = fromEnd === undefined ? 0 : node.scrollHeight - node.clientHeight - fromEnd;
			if (Math.abs(node.scrollTop - top) < 1) return resolve(node.scrollTop);
			node.addEventListener('scroll', () => resolve(node.scrollTop), { once: true });
			node.scrollTo({ top });
		});
	}, fromEnd);
}

/**
 * Runs the page's clock on a few frames at a time until the pane has done what opening it does (the rest of its
 * items drawn a chunk a frame, the latest watched), the list the same at its latest from one step to the next. Each
 * step runs every timer due in it (`runFor`), not each once (`fastForward`): a chunk is a frame, then a timer.
 */
async function settle(page: Page, list: Locator): Promise<void> {
	let last = '';
	for (let ran = 0; ; ran += 50) {
		const now = await list.evaluate((node) => `${node.querySelectorAll('[data-timeline-item]').length} ${node.scrollHeight} ${node.scrollHeight - node.scrollTop - node.clientHeight < 2}`);
		if (now === last && now.endsWith('true')) return;
		if (ran >= 2_000) throw new Error(`the pane didn't settle in 2000 ms of the page's clock: ${now}`);
		last = now;
		await page.clock.runFor(50);
	}
}

/**
 * Runs the page's clock on, `step` at a time, until `done`, for up to `within` of the page's time. A step shorter than
 * an answer's delay sees what shows only while one is awaited. Bounded by the page's clock, not the machine's: a
 * real-time limit (`expect.poll`'s 5 s) ran out on a busy machine, each step's checks taking longer there.
 */
async function runUntil(page: Page, step: number, done: () => Promise<boolean>, within = 60_000): Promise<void> {
	for (let ran = 0; !(await done()); ran += step) {
		if (ran >= within) throw new Error(`not done after ${within} ms of the page's clock`);
		await page.clock.fastForward(step);
	}
}

test('other rooms catching up run a line under the header, and older messages loading say so at the top', async ({ preview, page }) => {
	await openStopped(page, () => preview.open());
	const list = page.getByTestId('message-list');
	await expect(list.getByText('Message 80 of 80')).toBeVisible();
	// general is current; the other rooms are still loading their newest pages, one at a time.
	const updating = page.getByTestId('room-updating');
	await runUntil(page, 100, () => updating.isVisible());
	await expect(updating).toBeVisible();
	await expect(page.getByText('Checking for new messages…')).toHaveCount(0);
	await page.screenshot({ path: process.env.SHOTS ? process.env.SHOTS + '/updating.png' : undefined });
	await runUntil(page, HISTORY_DELAY_MS, async () => (await updating.count()) === 0);
	// Reading back to the top loads the page before.
	expect(await scrollList(list)).toBe(0);
	const older = page.getByRole('status').getByText('Loading earlier messages…');
	await runUntil(page, 100, () => older.isVisible());
	await expect(older).toBeVisible();
	await page.screenshot({ path: process.env.SHOTS ? process.env.SHOTS + '/older.png' : undefined });
	await runUntil(page, HISTORY_DELAY_MS, async () => (await older.count()) === 0);
});

test.describe('older messages landing after the pane moved on', () => {
	/** Long enough for the pane to move on, and be read back in, before general's older page lands. */
	const LANDS_AFTER_MS = 3_000;
	test.use({ ...DEVICES.desktop, knobs: { historyDelayMs: LANDS_AFTER_MS, filler: { general: 80, engineering: 80 } } });

	test('leave the room the pane went on to where it was read to', async ({ preview, page }) => {
		await openStopped(page, () => preview.open());
		const list = page.getByTestId('message-list');
		await expect(list.getByText('Message 80 of 80')).toBeVisible();
		await runUntil(page, LANDS_AFTER_MS, async () => (await page.getByTestId('room-updating').count()) === 0);
		// engineering read once, so it opens again at its latest, with nothing to load to reach its divider.
		await preview.openRoom('engineering');
		await runUntil(page, LANDS_AFTER_MS, () => list.getByText('Message 80 of 80').isVisible());
		await preview.openRoom('general');
		await expect(list.getByText('Message 80 of 80')).toBeVisible();
		await settle(page, list);
		// Reading back in general asks for the page before; the pane goes on to engineering, read back a little, meanwhile.
		expect(await scrollList(list)).toBe(0);
		await runUntil(page, 100, () => page.getByRole('status').getByText('Loading earlier messages…').isVisible());
		await preview.openRoom('engineering');
		await expect(list.getByText('Message 80 of 80')).toBeVisible();
		await settle(page, list);
		await scrollList(list, 400);
		const fromEnd = () => list.evaluate((node) => node.scrollHeight - node.scrollTop - node.clientHeight);
		const readTo = await fromEnd();
		expect(readTo).toBeGreaterThan(300);
		// general's page lands: engineering stays where it was read to, as far from its latest as it was.
		await page.clock.runFor(LANDS_AFTER_MS * 2);
		expect(await fromEnd()).toBe(readTo);
	});
});
