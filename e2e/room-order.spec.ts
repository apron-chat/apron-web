import type { BrowserContext, Page } from '@playwright/test';
import { DRAGGED_ELEMENT_ID } from 'svelte-dnd-action';
import { DEVICES, expect, test, type Preview } from './fixtures';

/** The sidebar's top-level rooms in an order of your own: dragged by their rows, or moved with Alt+↑/↓. */

const rows = (page: Page) => page.getByTestId('room-list').locator('button[data-room]');
const row = (page: Page, room: string) => page.getByTestId('room-list').locator(`button[data-room="${room}"]`);
const order = (page: Page) => rows(page).evaluateAll((buttons) => buttons.map((button) => (button as HTMLElement).dataset.room));
/** Every room's threads fold away while one is carried: how a drag shows from outside. */
const threadLists = (page: Page) => page.getByRole('complementary', { name: 'Rooms' }).getByTestId('thread-list');
/** A thread of general in the preview's seed, by its title. */
const deployThread = (page: Page) => threadLists(page).getByText('Deploy checklist', { exact: true });
/** Lets any input the browser has queued (a click after a tap) run. */
const nextFrame = (page: Page) => page.evaluate(() => new Promise((done) => requestAnimationFrame(() => done(null))));

/**
 * Opens general and waits for its sidebar to settle: its threads you haven't joined are listed after the page shows,
 * moving the rooms below them, so where a row is is read only once they're there.
 */
async function openGeneral(preview: Preview): Promise<void> {
	await preview.open('#room=general');
	await expect(preview.page.getByTestId('other-threads')).toBeAttached();
	// And the rows they bring have grown into place: the rooms hold still from one look to the next.
	const rooms = preview.page.getByRole('complementary', { name: 'Rooms' });
	let last = '';
	await expect.poll(async () => {
		const now = JSON.stringify(await rooms.evaluate((side) => [...side.querySelectorAll('button[data-room]')].map((row) => Math.round(row.getBoundingClientRect().top))));
		const still = now === last;
		last = now;
		return still;
	}, { intervals: [150] }).toBe(true);
}

async function middle(page: Page, room: string): Promise<{ x: number; y: number; top: number }> {
	const box = (await row(page, room).boundingBox())!;
	return { x: box.x + box.width / 2, y: box.y + box.height / 2, top: box.y };
}

test.describe('room order, with a mouse', () => {
	test.use(DEVICES.desktop);

	test('a room dragged by any part of its row lands where it’s let go, every room’s threads folded away while it’s carried', async ({ preview, page }) => {
		await openGeneral(preview);
		expect(await order(page)).toEqual(['general', 'engineering']);
		await expect(threadLists(page)).toHaveCount(1);
		// From the row's very edge, not its name.
		const edge = (await row(page, 'engineering').boundingBox())!;
		await page.mouse.move(edge.x + 4, edge.y + 4);
		await page.mouse.down();
		await page.mouse.move(edge.x + 4, edge.y - 10, { steps: 4 });
		await expect(threadLists(page)).toHaveCount(0);
		const to = await middle(page, 'general');
		await page.mouse.move(to.x, to.top + 4, { steps: 10 });
		// General makes way for it before it's let go.
		await expect.poll(() => order(page)).toEqual(['engineering', 'general']);
		await page.mouse.up();
		await expect.poll(() => order(page)).toEqual(['engineering', 'general']);
		// The threads come back, and the open room stays open: a drag isn't a pick.
		await expect(threadLists(page)).toHaveCount(1);
		await expect(preview.heading()).toHaveText('general');
	});

	test('a room carried away from the list stays in its column, landing at the end it’s nearest, the keyboard back on it', async ({ preview, page }) => {
		await openGeneral(preview);
		await row(page, 'general').focus();
		const from = await middle(page, 'general');
		await page.mouse.move(from.x, from.y);
		await page.mouse.down();
		await page.mouse.move(from.x, from.y + 12, { steps: 3 });
		// Far off to the right of the sidebar and below the list: the room keeps to the list's column and its end.
		await page.mouse.move(700, 600, { steps: 10 });
		await expect.poll(async () => {
			const list = (await page.getByTestId('room-list').boundingBox())!;
			const carried = (await page.locator(`#${DRAGGED_ELEMENT_ID}`).boundingBox())!;
			return Math.abs(carried.x - list.x) <= 1 && carried.y + carried.height <= list.y + list.height + 1;
		}).toBe(true);
		await expect.poll(() => order(page)).toEqual(['engineering', 'general']);
		await page.mouse.up();
		await expect.poll(() => order(page)).toEqual(['engineering', 'general']);
		await expect(threadLists(page)).toHaveCount(1);
		await expect(row(page, 'general')).toBeFocused();
	});

	test('a room below the open room’s threads, lifted and let go where it was, stays where it was', async ({ preview, page }) => {
		await openGeneral(preview);
		const privateRooms = page.getByTestId('private-list').locator('button[data-room]');
		const before = await privateRooms.evaluateAll((buttons) => buttons.map((button) => (button as HTMLElement).dataset.room));
		const first = (await privateRooms.first().boundingBox())!;
		await page.mouse.move(first.x + first.width / 2, first.y + first.height / 2);
		await page.mouse.down();
		// The threads above it fold away as it lifts, moving the rows under a pointer that stays put.
		await page.mouse.move(first.x + first.width / 2, first.y + first.height / 2 + 12, { steps: 3 });
		await expect(threadLists(page)).toHaveCount(0);
		await page.waitForTimeout(300);
		await page.mouse.up();
		await expect(threadLists(page)).toHaveCount(1);
		expect(await privateRooms.evaluateAll((buttons) => buttons.map((button) => (button as HTMLElement).dataset.room))).toEqual(before);
	});

	test('a click still opens a room', async ({ preview, page }) => {
		await openGeneral(preview);
		await row(page, 'engineering').click();
		await expect(preview.heading()).toHaveText('engineering');
	});

	test('a press that isn’t a left-button drag never lifts a room: Ctrl+click, or one whose release went unseen', async ({ preview, page }) => {
		await openGeneral(preview);
		const from = await middle(page, 'engineering');
		// Ctrl+click, a Mac's right click, whose menu would take the release.
		await page.keyboard.down('Control');
		await page.mouse.move(from.x, from.y);
		await page.mouse.down();
		await page.keyboard.up('Control');
		await page.mouse.move(from.x, from.y - 30, { steps: 4 });
		await nextFrame(page);
		await expect(threadLists(page)).toHaveCount(1);
		await page.mouse.up();
		// A press let go somewhere the page didn't see: the next move has no button held.
		await page.mouse.move(from.x, from.y);
		await page.mouse.down();
		await page.evaluate(([x, y]) => dispatchEvent(new MouseEvent('mousemove', { clientX: x, clientY: y, buttons: 0 })), [from.x, from.y - 30]);
		await page.evaluate(([x, y]) => dispatchEvent(new MouseEvent('mousemove', { clientX: x, clientY: y, buttons: 1 })), [from.x, from.y - 40]);
		await nextFrame(page);
		await expect(threadLists(page)).toHaveCount(1);
		await page.mouse.up();
		expect(await order(page)).toEqual(['general', 'engineering']);
	});

	test('Space or Enter on a room’s block, focused by a click beside its buttons, leaves the threads as they are', async ({ preview, page }) => {
		await openGeneral(preview);
		// The block the library makes of each room (with its threads) takes focus from a click that lands off its buttons.
		await row(page, 'general').evaluate((button) => (button.closest('.ap-roomblock') as HTMLElement).focus());
		for (const key of ['Space', 'Enter']) {
			await page.keyboard.press(key);
			await nextFrame(page);
			await expect(threadLists(page)).toHaveCount(1);
		}
		expect(await order(page)).toEqual(['general', 'engineering']);
	});

	test('pressing a thread and moving doesn’t carry its room', async ({ preview, page }) => {
		await openGeneral(preview);
		const thread = (await deployThread(page).boundingBox())!;
		await page.mouse.move(thread.x + thread.width / 2, thread.y + thread.height / 2);
		await page.mouse.down();
		await page.mouse.move(thread.x + thread.width / 2, thread.y + 60, { steps: 6 });
		await expect(threadLists(page)).toHaveCount(1);
		await page.mouse.up();
		expect(await order(page)).toEqual(['general', 'engineering']);
	});

	test('Alt+↑ and Alt+↓ move the focused room, the keyboard staying on it', async ({ preview, page }) => {
		await openGeneral(preview);
		await expect(row(page, 'general')).toHaveAttribute('aria-keyshortcuts', 'Alt+ArrowUp Alt+ArrowDown');
		await row(page, 'general').focus();
		await page.keyboard.press('Alt+ArrowDown');
		await expect.poll(() => order(page)).toEqual(['engineering', 'general']);
		await expect(row(page, 'general')).toBeFocused();
		await page.keyboard.press('Alt+ArrowUp');
		await expect.poll(() => order(page)).toEqual(['general', 'engineering']);
		await expect(row(page, 'general')).toBeFocused();
	});
});

test.describe('room order, in a short window', () => {
	// The sidebar's rooms scroll here, and a drag near its edge scrolls them, by where the pointer is.
	test.use({ viewport: { width: 1280, height: 180 } });

	// While the sidebar scrolls under it, the gap the others leave can lag behind the room; where it lands doesn't.
	test('a room carried to the edge of the scrolling sidebar stays over its list, and lands at its end', async ({ preview, page }) => {
		await openGeneral(preview);
		const scroller = await page.getByTestId('room-list').evaluate((list) => {
			let node: HTMLElement | null = list;
			while (node && !/(auto|scroll)/.test(getComputedStyle(node).overflowY)) node = node.parentElement;
			return node!.getBoundingClientRect().toJSON() as DOMRect;
		});
		const from = await middle(page, 'general');
		await page.mouse.move(from.x, from.y);
		await page.mouse.down();
		await page.mouse.move(from.x, from.y + 12, { steps: 3 });
		// Held at the sidebar's bottom edge, which scrolls it, for a while.
		for (let i = 0; i < 12; i++) {
			await page.mouse.move(from.x + (i % 2), scroller.bottom - 4);
			await page.waitForTimeout(100);
		}
		await expect.poll(async () => {
			const carried = (await page.locator(`#${DRAGGED_ELEMENT_ID}`).boundingBox())!;
			const list = (await page.getByTestId('room-list').boundingBox())!;
			const middleY = carried.y + carried.height / 2;
			return middleY >= list.y && middleY <= list.y + list.height;
		}).toBe(true);
		await page.mouse.up();
		await expect.poll(() => order(page)).toEqual(['engineering', 'general']);
	});
});

test.describe('room order, in a short window, lifted without moving', () => {
	test.use({ viewport: { width: 1280, height: 180 } });

	test('a room lifted and let go where it was stays where it was, nothing scrolling under the pointer', async ({ preview, page }) => {
		await openGeneral(preview);
		const from = await middle(page, 'general');
		await page.mouse.move(from.x, from.y);
		await page.mouse.down();
		// Lifted towards the middle of the sidebar, away from its top and bottom, where a pointer would scroll it.
		await page.mouse.move(from.x, from.y - 12, { steps: 3 });
		await expect(threadLists(page)).toHaveCount(0);
		await page.waitForTimeout(300);
		await page.mouse.up();
		await expect(threadLists(page)).toHaveCount(1);
		expect(await order(page)).toEqual(['general', 'engineering']);
	});
});

test.describe('room order, in a window too short for the list', () => {
	// The list doesn't fit, so the sidebar scrolls while a room is carried; the room still lands where it's seen.
	test.use({ viewport: { width: 1280, height: 140 } });

	test('a room carried to the edge of the scrolling sidebar lands at the end it’s seen at', async ({ preview, page }) => {
		await openGeneral(preview);
		await row(page, 'general').scrollIntoViewIfNeeded();
		const scroller = await page.getByTestId('room-list').evaluate((list) => {
			let node: HTMLElement | null = list;
			while (node && !/(auto|scroll)/.test(getComputedStyle(node).overflowY)) node = node.parentElement;
			return node!.getBoundingClientRect().toJSON() as DOMRect;
		});
		const from = await middle(page, 'general');
		await page.mouse.move(from.x, from.y);
		await page.mouse.down();
		await page.mouse.move(from.x, from.y + 12, { steps: 3 });
		for (let i = 0; i < 12; i++) {
			await page.mouse.move(from.x + (i % 2), scroller.bottom - 2);
			await page.waitForTimeout(100);
		}
		await page.mouse.up();
		await expect.poll(() => order(page)).toEqual(['engineering', 'general']);
	});
});

test.describe('room order, with the window resized mid-drag', () => {
	test.use(DEVICES.desktop);

	test('the sidebar settles where it is rather than jumping each frame', async ({ preview, page }) => {
		await openGeneral(preview);
		const from = await middle(page, 'general');
		await page.mouse.move(from.x, from.y);
		await page.mouse.down();
		await page.mouse.move(from.x, from.y + 12, { steps: 3 });
		await expect(threadLists(page)).toHaveCount(0);
		await page.setViewportSize({ width: 1280, height: 140 });
		// Held in the sidebar's middle, away from its edges, where nothing should scroll.
		const side = (await page.getByRole('complementary', { name: 'Rooms' }).boundingBox())!;
		await page.mouse.move(from.x, side.y + side.height / 2, { steps: 3 });
		await page.waitForTimeout(200);
		const scrolls = await page.getByTestId('room-list').evaluate((list) => new Promise<number[]>((done) => {
			let node: HTMLElement | null = list;
			while (node && !/(auto|scroll|hidden)/.test(getComputedStyle(node).overflowY)) node = node.parentElement;
			const seen: number[] = [];
			const each = () => (seen.push(node!.scrollTop), seen.length < 8 ? requestAnimationFrame(each) : done(seen));
			requestAnimationFrame(each);
		}));
		expect(new Set(scrolls).size).toBe(1);
		await page.mouse.up();
	});
});

test.describe('room order, in a short window with motion allowed', () => {
	// The room slides into its place after it's let go: nothing more scrolls under it meanwhile.
	test.use({ viewport: { width: 1280, height: 140 }, contextOptions: { reducedMotion: 'no-preference' } });

	test('the sidebar stops scrolling as soon as a room carried to its edge is let go', async ({ preview, page }) => {
		await openGeneral(preview);
		await row(page, 'general').scrollIntoViewIfNeeded();
		const scroller = await page.getByTestId('room-list').evaluate((list) => {
			let node: HTMLElement | null = list;
			while (node && !/(auto|scroll)/.test(getComputedStyle(node).overflowY)) node = node.parentElement;
			return node!.getBoundingClientRect().toJSON() as DOMRect;
		});
		const from = await middle(page, 'general');
		await page.mouse.move(from.x, from.y);
		await page.mouse.down();
		await page.mouse.move(from.x, from.y + 12, { steps: 3 });
		await page.mouse.move(from.x, scroller.bottom - 2, { steps: 4 });
		// From the release, each frame while it slides into place (its copy still shown); once it's down the threads
		// come back, and the browser keeps what's in view where it was, which may scroll.
		await page.getByTestId('room-list').evaluate((list, id) => {
			let node: HTMLElement | null = list;
			while (node && !/(auto|scroll|hidden)/.test(getComputedStyle(node).overflowY)) node = node.parentElement;
			const seen: number[] = [];
			(window as unknown as { scrolls: Promise<number[]> }).scrolls = new Promise((done) => {
				addEventListener('mouseup', () => {
					const each = () => (document.getElementById(id) ? (seen.push(node!.scrollTop), requestAnimationFrame(each)) : done(seen));
					each();
				}, { capture: true, once: true });
			});
		}, DRAGGED_ELEMENT_ID);
		await page.mouse.up();
		const scrolls = await page.evaluate(() => (window as unknown as { scrolls: Promise<number[]> }).scrolls);
		expect(scrolls.length).toBeGreaterThan(0);
		expect(new Set(scrolls).size).toBe(1);
	});
});

test.describe('room order, with pointer moves out of step with frames', () => {
	test.use(DEVICES.desktop);

	test('a room carried away from the list lands where it’s seen, however often the pointer reports', async ({ preview, page }) => {
		await openGeneral(preview);
		const from = await middle(page, 'general');
		await page.mouse.move(from.x, from.y);
		await page.mouse.down();
		await page.mouse.move(from.x, from.y + 12, { steps: 3 });
		// Moves well off the list, more often than frames are drawn, as some browsers send them: right after each, before
		// any frame (when the library may check where it is), the room is already back in the list's column.
		const strays = await page.getByTestId('room-list').evaluate((list, id) => new Promise<number>((done) => {
			let i = 0;
			let stray = 0;
			const timer = setInterval(() => {
				dispatchEvent(new MouseEvent('mousemove', { clientX: 700 + (i++ % 30), clientY: 600, buttons: 1 }));
				const carried = document.getElementById(id)!.getBoundingClientRect();
				if (Math.abs(carried.left - list.getBoundingClientRect().left) > 1) stray++;
			}, 3);
			setTimeout(() => (clearInterval(timer), done(stray)), 1500);
		}), DRAGGED_ELEMENT_ID);
		expect(strays).toBe(0);
		// The list has made way for it where it's seen, at the end, before it's let go.
		await expect.poll(() => order(page)).toEqual(['engineering', 'general']);
		await page.mouse.up();
		await expect.poll(() => order(page)).toEqual(['engineering', 'general']);
	});
});

test.describe('folding a room, with motion allowed', () => {
	// The suite runs with reduced motion, which leaves the rooms nothing to animate: this checks they don't when they could.
	test.use({ ...DEVICES.desktop, contextOptions: { reducedMotion: 'no-preference' } });

	test('a click on the open room that drifts a little folds it, rather than lifting it, and nothing in the list animates', async ({ preview, page }) => {
		await openGeneral(preview);
		const from = await middle(page, 'general');
		await page.mouse.move(from.x, from.y);
		await page.mouse.down();
		await page.mouse.move(from.x + 5, from.y + 1, { steps: 2 });
		await page.mouse.up();
		await expect(page.getByRole('button', { name: 'Show all threads in general' })).toBeVisible();
		await expect(threadLists(page)).toHaveCount(0);
		expect(await order(page)).toEqual(['general', 'engineering']);
		// The rooms below close up at once: no animation in the list as it folds.
		const moving = await page.getByTestId('room-list').evaluate((list) => document.getAnimations().filter((animation) => {
			const target = (animation.effect as KeyframeEffect | null)?.target;
			return target instanceof Element && list.contains(target);
		}).length);
		expect(moving).toBe(0);
	});
});

test.describe('room order, by touch', () => {
	test.use({ ...DEVICES.tablet, hasTouch: true });

	/**
	 * Touches through the browser's own input (CDP), as a finger's: Playwright can tap, but can't hold and move one.
	 * `tap` is down for a moment, well short of the hold that lifts a room.
	 */
	async function finger(context: BrowserContext, page: Page) {
		const cdp = await context.newCDPSession(page);
		const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', x = 0, y = 0) =>
			cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
		const tap = async (x: number, y: number) => {
			await touch('touchStart', x, y);
			await page.waitForTimeout(60);
			await touch('touchEnd');
			await nextFrame(page);
		};
		return { touch, tap };
	}

	test('a room held lifts, and can then be dragged to another place', async ({ preview, page, context }) => {
		await openGeneral(preview);
		const { touch } = await finger(context, page);
		const from = await middle(page, 'engineering');
		await touch('touchStart', from.x, from.y);
		await expect(threadLists(page)).toHaveCount(0);
		const to = await middle(page, 'general');
		for (let i = 1; i <= 12; i++) await touch('touchMove', from.x, from.y + (to.top + 4 - from.y) * (i / 12));
		await expect.poll(() => order(page)).toEqual(['engineering', 'general']);
		await touch('touchEnd');
		await expect.poll(() => order(page)).toEqual(['engineering', 'general']);
		await expect(threadLists(page)).toHaveCount(1);
		await expect(preview.heading()).toHaveText('general');
	});

	test('a swipe across the rooms doesn’t carry one', async ({ preview, page, context }) => {
		await openGeneral(preview);
		const { touch } = await finger(context, page);
		const from = await middle(page, 'engineering');
		await touch('touchStart', from.x, from.y);
		for (let i = 1; i <= 6; i++) await touch('touchMove', from.x, from.y - i * 10);
		await touch('touchEnd');
		// Held past the time a hold takes, nothing lifts: the swipe let it go.
		await page.waitForTimeout(500);
		await expect(threadLists(page)).toHaveCount(1);
		expect(await order(page)).toEqual(['general', 'engineering']);
	});

	test('a tap opens a room', async ({ preview, page, context }) => {
		await openGeneral(preview);
		const { tap } = await finger(context, page);
		const room = await middle(page, 'engineering');
		await tap(room.x, room.y);
		await expect(preview.heading()).toHaveText('engineering');
	});

	test('a tap on a thread opens the thread', async ({ preview, page, context }) => {
		await openGeneral(preview);
		const { tap } = await finger(context, page);
		const thread = (await deployThread(page).boundingBox())!;
		await tap(thread.x + thread.width / 2, thread.y + thread.height / 2);
		await expect(preview.heading()).toHaveText('general › Deploy checklist');
	});
});

test.describe('folding a room on a phone', () => {
	test.use(DEVICES.phone);

	// A tap is one pick: were it two (svelte-dnd-action clicks after a tap, as the browser does), this fold would undo itself.
	test('tapping the open room folds its threads in the rooms list, which stays, its › going back to the room', async ({ preview, page }) => {
		await preview.open('#room=general');
		await preview.roomsPane();
		await expect(threadLists(page)).toHaveCount(1);
		await preview.press(row(page, 'general'));
		await expect(page.getByTestId('room-list')).toBeVisible();
		await expect(page.getByRole('button', { name: 'Show all threads in general' })).toBeVisible();
		await expect(threadLists(page)).toHaveCount(0);
		await preview.press(row(page, 'general'));
		await expect(threadLists(page)).toHaveCount(1);
		await preview.press(page.getByRole('button', { name: 'Back to general' }));
		await expect(page.getByTestId('room-list')).toBeHidden();
		await expect(preview.heading()).toHaveText('general');
	});
});
