import { DEVICES, expect, test, type Preview } from './fixtures';

/**
 * The design system's layout rules (§D3 of the test strategy), as geometry in real layout rather than CSS strings:
 * role badges are never sliced, a name gives way only down to `--ap-name-min`, a message header stays one line,
 * nothing scrolls sideways on a phone, and under 960px the member list overlays the conversation. The `rich`
 * seed gives the general room people with long names and four roles each.
 */

test.use({ knobs: { seed: 'rich' } });

/** The viewports, in groups a window can be resized across: a context's touch and mobile settings stay as it opened. */
const VIEWPORTS = [['desktop', 'tablet'], ['phone', 'phone360', 'phone320']] as const;

/** Every broken rule in the open timeline and member list, as readable lines (none: `[]`). Runs in the page. */
function layoutViolations(): string[] {
	const out: string[] = [];
	const px = (n: number) => Math.round(n * 10) / 10;
	const TOLERANCE = 0.5;
	const visible = (el: Element) => {
		const style = getComputedStyle(el);
		const rect = el.getBoundingClientRect();
		return style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity) > 0 && rect.width > 0 && rect.height > 0;
	};
	const label = (el: Element) => {
		const article = el.closest('article[data-message-id]');
		const member = el.closest('li');
		const who = el.closest('article, li')?.querySelector('.ap-msg-sender, .ap-member-text')?.textContent?.trim();
		return article ? `message ${article.getAttribute('data-message-id')} (${who})` : member ? `member (${who})` : el.className;
	};

	// The page never scrolls sideways, nor does the timeline.
	const doc = document.documentElement;
	if (doc.scrollWidth > innerWidth + TOLERANCE) out.push(`page scrolls sideways: ${doc.scrollWidth} > ${innerWidth}`);
	const timeline = document.querySelector('[data-testid=message-list]');
	if (timeline && timeline.scrollWidth > timeline.clientWidth + TOLERANCE) out.push(`timeline scrolls sideways: ${timeline.scrollWidth} > ${timeline.clientWidth}`);

	for (const row of document.querySelectorAll('.ap-roles')) {
		if (!visible(row) || !row.closest('[data-testid=message-list], [data-testid=room-member-list]')) continue;
		const rowRect = row.getBoundingClientRect();
		// The row clips (overflow: hidden): a showing badge that sticks out of it is sliced. (Not the row's scrollWidth:
		// stacked badges sit out of the flow behind the last one, invisible, and count towards it.)
		for (const badge of row.querySelectorAll('.ap-role')) {
			if (!visible(badge)) continue;
			const r = badge.getBoundingClientRect();
			const text = badge.textContent?.trim();
			if (r.left < rowRect.left - TOLERANCE || r.right > rowRect.right + TOLERANCE || r.top < rowRect.top - TOLERANCE || r.bottom > rowRect.bottom + TOLERANCE)
				out.push(`${label(badge)}: badge "${text}" sliced: [${px(r.left)}, ${px(r.right)}] outside its row [${px(rowRect.left)}, ${px(rowRect.right)}]`);
			const container = badge.closest('article, li');
			const c = container?.getBoundingClientRect();
			if (c && (r.right > c.right + TOLERANCE || r.left < c.left - TOLERANCE)) out.push(`${label(badge)}: badge "${text}" sticks out of its ${container!.tagName.toLowerCase()}`);
		}
	}

	for (const head of document.querySelectorAll('[data-testid=message-list] .ap-msg-head')) {
		if (!visible(head)) continue;
		const sender = head.querySelector('.ap-msg-sender');
		const meta = head.querySelector('.ap-msg-meta');
		const h = head.getBoundingClientRect();
		// One line: as tall as its tallest part's line, and every part on it.
		const line = Math.max(...[...head.children].filter(visible).map((child) => parseFloat(getComputedStyle(child).lineHeight) || child.getBoundingClientRect().height));
		if (h.height > line * 1.5) out.push(`${label(head)}: header is ${px(h.height)}px tall, more than one ${px(line)}px line`);
		if (head.scrollWidth > head.clientWidth + TOLERANCE) out.push(`${label(head)}: header overflows, ${head.scrollWidth} > ${head.clientWidth}`);
		if (meta && visible(meta)) {
			const m = meta.getBoundingClientRect();
			if (m.right > h.right + TOLERANCE) out.push(`${label(head)}: the time is pushed out of the header`);
			if (meta.scrollWidth > meta.clientWidth + TOLERANCE) out.push(`${label(head)}: the time is cut short`);
		}
		// The name gives way first, but while any badge shows, not below --ap-name-min (or all of a shorter name).
		const badges = [...head.querySelectorAll('.ap-role')].filter(visible);
		if (sender && badges.length) {
			const em = parseFloat(getComputedStyle(sender).fontSize);
			const least = Math.min(parseFloat(getComputedStyle(head).getPropertyValue('--ap-name-min')) * em, sender.scrollWidth, h.width);
			const width = sender.getBoundingClientRect().width;
			if (width < least - 1) out.push(`${label(head)}: name squeezed to ${px(width)}px while badges show; least is ${px(least)}px`);
		}
	}

	const members = document.querySelector('[data-testid=room-member-list]');
	if (members && visible(members)) {
		for (const scroller of members.querySelectorAll('*')) {
			const style = getComputedStyle(scroller);
			if ((style.overflowX === 'auto' || style.overflowX === 'scroll') && scroller.scrollWidth > scroller.clientWidth + TOLERANCE)
				out.push(`member list scrolls sideways: ${scroller.className} ${scroller.scrollWidth} > ${scroller.clientWidth}`);
		}
	}
	return out;
}

/** Waits until fonts are in and RoleBadges has measured, then checks the rules. */
async function expectNoViolations(preview: Preview, where: string): Promise<void> {
	await preview.page.evaluate(() => document.fonts.ready.then(() => undefined));
	await expect.poll(() => preview.page.evaluate(layoutViolations), { message: `layout rules broken ${where}` }).toEqual([]);
}

async function showMembers(preview: Preview): Promise<void> {
	const { page } = preview;
	const list = page.getByTestId('room-member-list');
	if (!(await list.isVisible())) await preview.press(page.getByRole('button', { name: /member list/i }).first());
	await expect(list).toBeVisible();
	await expect(list.locator('li').first()).toBeVisible();
}

/** Shuts the member list where it overlays the conversation, as a window that narrow opens with it. */
async function hideMembers(preview: Preview): Promise<void> {
	const { page } = preview;
	const list = page.getByTestId('room-member-list');
	if (await list.isVisible()) await preview.press(page.getByRole('button', { name: 'Hide member list', exact: true }));
	await expect(list).toBeHidden();
}

/** Resizes the window to a device's viewport, its member list shut as a window that narrow opens with it. */
async function resizeTo(preview: Preview, device: keyof typeof DEVICES): Promise<void> {
	await preview.page.setViewportSize(DEVICES[device].viewport);
	await hideMembers(preview);
}

// One theme: the light theme overrides only colors (tokens.css), and apron.css has no theme-specific rules, so
// the geometry is the same in both.
for (const viewports of VIEWPORTS) {
	test.describe(viewports.join(', '), () => {
		test.use(DEVICES[viewports[0]]);

		test('long names and four roles keep every message header whole, and the member list fits them', async ({ preview }) => {
			await preview.open();
			for (const viewport of viewports) {
				await test.step(viewport, async () => {
					if (viewport !== viewports[0]) await resizeTo(preview, viewport);
					await expect(preview.message('Long names and four roles')).toBeVisible();
					// Scrolled to each long-named message in turn, so each one is laid out on screen.
					for (const text of ['Long names and four roles', 'with an even longer name', 'no spaces to break at', 'the handle tells us apart']) {
						await preview.message(text).scrollIntoViewIfNeeded();
						await expectNoViolations(preview, `at ${text} (${viewport})`);
					}
					await showMembers(preview);
					await expect(preview.page.getByTestId('room-member-list').getByText('Wilhelmina Featherstonehaugh-Cholmondeley')).toBeVisible();
					await expectNoViolations(preview, `with the member list open (${viewport})`);
				});
			}
		});
	});
}

test.describe('the member list under 960px', () => {
	/** Opens the member list, shut as the window opened: it overlays the conversation, inside the screen, rather than squeezing it. */
	async function overlays(preview: Preview): Promise<void> {
		const { page } = preview;
		const main = page.getByRole('main', { name: 'Conversation' });
		const before = (await main.boundingBox())!;
		await showMembers(preview);
		const list = page.getByTestId('room-member-list');
		const width = page.viewportSize()!.width;
		// Once it has slid in.
		await expect.poll(async () => Math.round((await list.boundingBox())!.x + (await list.boundingBox())!.width), { message: 'the list ends at the right edge' }).toBe(width);
		const box = (await list.boundingBox())!;
		const after = (await main.boundingBox())!;
		expect(after.width, 'the conversation keeps its width').toBeCloseTo(before.width, 0);
		expect(box.x, 'the list leaves the conversation showing at its left').toBeGreaterThanOrEqual(Math.min(24, width - box.width) - 0.5);
		expect(box.x).toBeGreaterThan(after.x);
	}

	test.describe('phone, phone320', () => {
		test.use(DEVICES.phone);

		test('overlays the conversation, inside the screen, rather than squeezing it', async ({ preview }) => {
			await preview.open();
			await test.step('phone', () => overlays(preview));
			await test.step('phone320', async () => {
				await resizeTo(preview, 'phone320');
				await overlays(preview);
			});
		});
	});

	test.describe('tablet, and at 960px and wider', () => {
		test.use(DEVICES.tablet);

		test('overlays the conversation on a tablet, and takes a column of its own beside it from 960px', async ({ preview, page }) => {
			await preview.open();
			await test.step('tablet: overlays the conversation, inside the screen, rather than squeezing it', () => overlays(preview));
			await test.step('at 960px and wider: takes a column of its own beside the conversation', async () => {
				await page.setViewportSize({ width: 960, height: 800 });
				await showMembers(preview);
				const main = (await page.getByRole('main', { name: 'Conversation' }).boundingBox())!;
				const list = (await page.getByTestId('room-member-list').boundingBox())!;
				expect(list.x, 'the list starts where the conversation ends').toBeGreaterThanOrEqual(main.x + main.width - 1);
				expect(list.x + list.width).toBeLessThanOrEqual(960 + 0.5);
			});
		});
	});
});

/**
 * Each panel's toggle sits at its inner edge, the edge facing the conversation: the rooms list's after the server in
 * its header, the member list's before Members; shut, each at the room header's end nearest the edge its panel went to.
 * Under `dir="rtl"` the panels and their inner edges mirror. Measured along the line, from its start.
 */
test.describe('the panel toggles', () => {
	test.use(DEVICES.desktop);

	test('sit at their panels\' inner edges, and at the room header\'s ends once shut, in either direction', async ({ preview, page }) => {
		await preview.open();
		for (const dir of ['ltr', 'rtl'] as const) await test.step(`sit at their panels' inner edges, and at the room header's ends once shut (${dir})`, async () => {
			if (dir === 'rtl') {
				// Shown again, as the window opened.
				await preview.press(page.getByRole('button', { name: 'Show rooms', exact: true }));
				await expect(page.getByRole('button', { name: 'Hide rooms', exact: true })).toBeVisible();
				await page.evaluate(() => document.documentElement.setAttribute('dir', 'rtl'));
			}
			await showMembers(preview);
			const width = page.viewportSize()!.width;
			/** A box's start and end along the line: from the left, or from the right under rtl. */
			const span = (box: { x: number; width: number }) =>
				dir === 'ltr' ? { start: box.x, end: box.x + box.width } : { start: width - box.x - box.width, end: width - box.x };
			const at = async (locator: ReturnType<typeof page.locator>) => span((await locator.boundingBox())!);
			const near = (actual: number, expected: number, what: string) => expect(Math.abs(actual - expected), `${what}: ${actual} ≈ ${expected}`).toBeLessThan(1.5);
			const button = (name: string) => page.getByRole('button', { name, exact: true });

			const side = await at(page.locator('.ap-shell-side'));
			const server = await at(page.locator('.ap-shell-sidehead-server'));
			// Its avatar, inside the button's pill, which is inset as the profile bar's is.
			const serverAvatar = await at(page.locator('.ap-shell-sidehead-avatar'));
			const hideRooms = await at(button('Hide rooms'));
			near(hideRooms.end, side.end - 12, 'the rooms toggle ends a --space-3 inside the list');
			expect(server.end, 'the server stops before the toggle').toBeLessThanOrEqual(hideRooms.start);
			near(serverAvatar.start, side.start + 16, 'the server starts at the list\'s outer edge');

			const list = page.getByRole('complementary', { name: 'Room member list', exact: true });
			const members = await at(list);
			const heading = await at(list.getByRole('heading', { name: 'Members', exact: true }));
			const hideMembers = await at(button('Hide member list'));
			near(hideMembers.start, members.start + 12, 'the member list toggle starts a --space-3 inside the list');
			expect(hideMembers.end, 'Members follows the toggle').toBeLessThanOrEqual(heading.start);

			await preview.press(button('Hide rooms'));
			await preview.press(button('Hide member list'));
			await expect(list).toBeHidden();
			const showRooms = await at(button('Show rooms'));
			const showMembersToggle = await at(button('Show member list'));
			near(showRooms.start, 12, 'shut, the rooms toggle starts the room header');
			near(showMembersToggle.end, width - 12, 'shut, the member list toggle ends the room header');
			// The header's own contents keep clear of both.
			const header = await page.locator('.ap-roomhead > *').evaluateAll((children) =>
				children.map((child) => child.getBoundingClientRect()).filter((rect) => rect.width > 0).map((rect) => ({ x: rect.x, width: rect.width })));
			expect(header.length).toBeGreaterThan(0);
			for (const box of header.map(span)) {
				expect(box.start).toBeGreaterThanOrEqual(showRooms.end);
				expect(box.end).toBeLessThanOrEqual(showMembersToggle.start);
			}
		});
	});
});

/**
 * Each panel's border handle sits on its inner border, the one facing the conversation, in either direction: the rooms
 * list's straddling its end, the member list's just inside its start. A drag toward the conversation widens the panel
 * and one away narrows it, so under `dir="rtl"`, where the panels mirror, the pointer moves the other way.
 */
test.describe('the panel handles', () => {
	test.use(DEVICES.desktop);

	test('sit on their panels\' inner borders, and a drag toward the conversation widens the panel, in either direction', async ({ preview, page }) => {
		await preview.open();
		for (const dir of ['ltr', 'rtl'] as const) await test.step(`sit on their panels' inner borders, and a drag toward the conversation widens the panel (${dir})`, async () => {
			if (dir === 'rtl') await page.evaluate(() => document.documentElement.setAttribute('dir', 'rtl'));
			await showMembers(preview);
			const width = page.viewportSize()!.width;
			/** A box's start and end along the line: from the left, or from the right under rtl. */
			const span = (box: { x: number; width: number }) =>
				dir === 'ltr' ? { start: box.x, end: box.x + box.width } : { start: width - box.x - box.width, end: width - box.x };
			const at = async (locator: ReturnType<typeof page.locator>) => span((await locator.boundingBox())!);
			const near = (actual: number, expected: number, what: string) => expect(Math.abs(actual - expected), `${what}: ${actual} ≈ ${expected}`).toBeLessThan(1.5);
			/** Toward the conversation, along the screen's x axis, from a panel at the line's start (rooms) or end (members). */
			const inward = (panel: 'rooms' | 'members') => ((panel === 'rooms') === (dir === 'ltr') ? 1 : -1);

			const side = page.locator('.ap-shell-side');
			const list = page.getByRole('complementary', { name: 'Room member list', exact: true });
			const roomsHandle = page.getByRole('button', { name: 'Collapse sidebar', exact: true });
			const membersHandle = page.getByRole('button', { name: 'Collapse member list', exact: true });

			const rooms = await at(side);
			const roomsBorder = await at(roomsHandle);
			near(roomsBorder.start, rooms.end - 4, 'the rooms handle straddles the list\'s inner border');
			expect(roomsBorder.end, 'it reaches past the border into the conversation').toBeGreaterThan(rooms.end);
			const members = await at(list);
			const membersBorder = await at(membersHandle);
			near(membersBorder.start, members.start, 'the member list handle starts at its inner border');
			expect(membersBorder.end, 'inside the list').toBeLessThanOrEqual(members.start + 9 + 0.5);

			/** Drags a handle from its middle by `dx` px along the screen's x axis, in steps as a hand would. */
			const dragBy = async (handle: typeof roomsHandle, dx: number) => {
				const box = (await handle.boundingBox())!;
				const x = box.x + box.width / 2;
				const y = box.y + box.height / 2;
				await page.mouse.move(x, y);
				await page.mouse.down();
				await page.mouse.move(x + dx, y, { steps: 6 });
				await page.mouse.up();
			};
			const widthOf = async (locator: typeof side) => (await locator.boundingBox())!.width;

			for (const [panel, locator, handle] of [['rooms', side, roomsHandle], ['members', list, membersHandle]] as const) {
				const before = await widthOf(locator);
				await dragBy(handle, 60 * inward(panel));
				await expect.poll(() => widthOf(locator), { message: `${panel}: dragged toward the conversation, wider` }).toBeCloseTo(before + 60, 0);
				await dragBy(handle, -40 * inward(panel));
				await expect.poll(() => widthOf(locator), { message: `${panel}: dragged away from it, narrower` }).toBeCloseTo(before + 20, 0);
				// The handle stays on the border it moved.
				const after = await at(locator);
				const border = await at(handle);
				if (panel === 'rooms') near(border.start, after.end - 4, 'the rooms handle follows its border');
				else near(border.start, after.start, 'the member list handle follows its border');
			}

			// From the keyboard, the arrow pointing toward the conversation widens.
			const toward = (panel: 'rooms' | 'members') => (inward(panel) === 1 ? 'ArrowRight' : 'ArrowLeft');
			for (const [panel, locator, handle] of [['rooms', side, roomsHandle], ['members', list, membersHandle]] as const) {
				const before = await widthOf(locator);
				await handle.focus();
				await page.keyboard.press(toward(panel));
				await expect.poll(() => widthOf(locator), { message: `${panel}: ${toward(panel)} widens` }).toBeCloseTo(before + 16, 0);
			}
		});
	});
});

/**
 * Under `dir="rtl"` the rest of the layout mirrors too, and left to right nothing moves: each case runs in both
 * directions and measures the same distances along the line, from its start (the left, or the right under rtl).
 */
test.describe('right to left', () => {
	test.describe('desktop', () => {
		// With presence, so the member list has sections (Online, Offline) to fold.
		test.use({ ...DEVICES.desktop, knobs: { seed: 'rich', capabilities: ['status'] } });

		test('a message header and the member list measure the same along the line, left to right and right to left', async ({ preview, page }) => {
			await preview.open();
			for (const dir of ['ltr', 'rtl'] as const) {
				if (dir === 'rtl') await page.evaluate(() => document.documentElement.setAttribute('dir', 'rtl'));
				await test.step(`a message header keeps its name and time apart, the time reads as written, and the toolbar sits at the end (${dir})`, async () => {
					await page.evaluate(() => document.fonts.ready.then(() => undefined));
					// The first header with just a name and a time (no badges or handle between them).
					const head = await page.evaluate(() => {
						for (const head of document.querySelectorAll('[data-testid=message-list] .ap-msg-head')) {
							const name = head.querySelector('.ap-msg-sender');
							const time = head.querySelector('.ap-msg-meta time');
							if (head.children.length !== 2 || !name || !time?.firstChild || !name.getBoundingClientRect().width) continue;
							const text = time.textContent ?? '';
							/** Where a character of the time is drawn, from the left. */
							const at = (index: number) => {
								const range = document.createRange();
								range.setStart(time.firstChild!, index);
								range.setEnd(time.firstChild!, index + 1);
								return range.getBoundingClientRect().left;
							};
							const box = (el: Element) => ({ left: el.getBoundingClientRect().left, right: el.getBoundingClientRect().right });
							return { id: head.closest('article')!.getAttribute('data-message-id')!, text, name: box(name), time: box(time), digit: at(text.search(/\d/)), letter: at(text.search(/[AP]M/)) };
						}
						return undefined;
					});
					expect(head, 'a header with a name and a time').toBeDefined();
					expect(head!.text).toMatch(/^\d{1,2}:\d{2}\s?[AP]M$/);
					// The time follows the name a --space-2 along the line: to its right, or to its left under rtl.
					const gap = dir === 'ltr' ? head!.time.left - head!.name.right : head!.name.left - head!.time.right;
					expect(gap, 'a --space-2 between the name and the time').toBeCloseTo(8, 0);
					// "3:42 PM" reads as the locale writes it in either direction, not "PM 3:42".
					expect(head!.digit, 'the hour before the AM/PM').toBeLessThan(head!.letter);

					// Hovered, its toolbar floats over the message's end, a --space-2 in.
					const article = page.locator(`article[data-message-id="${head!.id}"]`);
					await article.hover();
					const actions = article.locator('.ap-msg-actions');
					await expect(actions).toBeVisible();
					const a = (await actions.boundingBox())!;
					const m = (await article.boundingBox())!;
					if (dir === 'ltr') expect(m.x + m.width - (a.x + a.width)).toBeCloseTo(8, 0);
					else expect(a.x - m.x).toBeCloseTo(8, 0);
				});
				await test.step(`the member list keeps "(you)" apart from your name, and a folded section's … sits at its heading's end (${dir})`, async () => {
					await showMembers(preview);
					const list = page.getByTestId('room-member-list');
					const you = list.locator('.ap-member-name small', { hasText: '(you)' });
					await expect(you).toBeVisible();
					const name = (await you.locator('xpath=preceding-sibling::*[contains(@class, "ap-member-text")]').boundingBox())!;
					const mark = (await you.boundingBox())!;
					const gap = dir === 'ltr' ? mark.x - (name.x + name.width) : name.x - (mark.x + mark.width);
					expect(gap, '4px between the name and "(you)"').toBeCloseTo(4, 0);

					// Folded, the heading's … sits at its inline end, past its words: on their right, or their left under rtl.
					const head = list.locator('.ap-memberlist-sectionhead').first();
					const toggle = head.locator('.ap-sect-toggle');
					await preview.press(toggle);
					await expect(toggle).toHaveAttribute('aria-expanded', 'false');
					const pill = head.locator('.ap-foldpill');
					const t = (await toggle.boundingBox())!;
					const p = (await pill.boundingBox())!;
					const h = (await head.boundingBox())!;
					if (dir === 'ltr') expect(p.x).toBeGreaterThan(t.x + t.width);
					else expect(p.x + p.width).toBeLessThan(t.x);
					expect(dir === 'ltr' ? h.x + h.width - (p.x + p.width) : p.x - h.x, 'at the end, inside its padding').toBeLessThanOrEqual(8);
					await preview.press(pill);
					await expect(toggle).toHaveAttribute('aria-expanded', 'true');
					await expect(toggle).toBeFocused();
				});
			}
		});
	});

	test.describe('under 960px', () => {
		test.use(DEVICES.tablet);

		test('the member list overlays from the window\'s inline end, below its toggle, its border on its inner edge, left to right and right to left', async ({ preview, page }) => {
			await preview.open();
			for (const dir of ['ltr', 'rtl'] as const) {
				await test.step(`the member list overlays from the window's inline end, below its toggle, its border on its inner edge (${dir})`, async () => {
					if (dir === 'rtl') {
						// Shut again, as the window opened.
						await hideMembers(preview);
						await page.evaluate(() => document.documentElement.setAttribute('dir', 'rtl'));
					}
					const width = page.viewportSize()!.width;
					// The panel itself: shut, it is hidden from everyone, so not found by role unless asked.
					const list = page.getByRole('complementary', { name: 'Room member list', exact: true, includeHidden: true });
					const rect = () => list.evaluate((el) => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right }; });
					// Shut, it waits past that edge, and the page doesn't scroll sideways for it.
					const shut = await rect();
					if (dir === 'ltr') expect(shut.left).toBeGreaterThanOrEqual(width);
					else expect(shut.right).toBeLessThanOrEqual(0);
					expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);

					const toggle = page.getByRole('button', { name: /member list/i }).first();
					const button = (await toggle.boundingBox())!;
					await showMembers(preview);
					await expect.poll(async () => Math.round(dir === 'ltr' ? (await rect()).right : (await rect()).left), { message: 'it ends at the inline end' }).toBe(dir === 'ltr' ? width : 0);
					const open = await rect();
					expect(open.right - open.left).toBeLessThan(width);
					// Below the button that opened it, at the same end of the room's header.
					const middle = button.x + button.width / 2;
					expect(middle).toBeGreaterThan(open.left);
					expect(middle).toBeLessThan(open.right);
					// Its border faces the conversation: its left one, or its right under rtl.
					const borders = await list.evaluate((el) => ({ left: getComputedStyle(el).borderLeftWidth, right: getComputedStyle(el).borderRightWidth }));
					expect(borders).toEqual(dir === 'ltr' ? { left: '1px', right: '0px' } : { left: '0px', right: '1px' });
					expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
				});
			}
		});
	});
});
