import { DEVICES, expect, test, type Preview } from './fixtures';

/**
 * The design system's layout rules (§D3 of the test strategy), as geometry in real layout rather than CSS strings:
 * role badges are never sliced, a name gives way only down to `--ap-name-min`, a message header stays one line,
 * nothing scrolls sideways on a phone, and under 960px the member list overlays the conversation. The `rich`
 * seed gives the general room people with long names and four roles each.
 */

test.use({ knobs: { seed: 'rich' } });

const VIEWPORTS = ['desktop', 'tablet', 'phone', 'phone360', 'phone320'] as const;

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

// One theme: the light theme overrides only colors (tokens.css), and apron.css has no theme-specific rules, so
// the geometry is the same in both.
for (const viewport of VIEWPORTS) {
	test.describe(viewport, () => {
		test.use(DEVICES[viewport]);

		test('long names and four roles keep every message header whole, and the member list fits them', async ({ preview }) => {
			await preview.open();
			await expect(preview.message('Long names and four roles')).toBeVisible();
			// Scrolled to each long-named message in turn, so each one is laid out on screen.
			for (const text of ['Long names and four roles', 'with an even longer name', 'no spaces to break at', 'the handle tells us apart']) {
				await preview.message(text).scrollIntoViewIfNeeded();
				await expectNoViolations(preview, `at ${text}`);
			}
			await showMembers(preview);
			await expect(preview.page.getByTestId('room-member-list').getByText('Wilhelmina Featherstonehaugh-Cholmondeley')).toBeVisible();
			await expectNoViolations(preview, 'with the member list open');
		});
	});
}

test.describe('the member list under 960px', () => {
	for (const viewport of ['tablet', 'phone', 'phone320'] as const) {
		test.describe(viewport, () => {
			test.use(DEVICES[viewport]);

			test('overlays the conversation, inside the screen, rather than squeezing it', async ({ preview, page }) => {
				await preview.open();
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
			});
		});
	}

	test.describe('at 960px and wider', () => {
		test.use({ viewport: { width: 960, height: 800 } });

		test('takes a column of its own beside the conversation', async ({ preview, page }) => {
			await preview.open();
			await showMembers(preview);
			const main = (await page.getByRole('main', { name: 'Conversation' }).boundingBox())!;
			const list = (await page.getByTestId('room-member-list').boundingBox())!;
			expect(list.x, 'the list starts where the conversation ends').toBeGreaterThanOrEqual(main.x + main.width - 1);
			expect(list.x + list.width).toBeLessThanOrEqual(960 + 0.5);
		});
	});
});
