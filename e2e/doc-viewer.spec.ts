import type { Page, Route } from '@playwright/test';
import { DEVICES, expect, test } from './fixtures';

/** Where the preview's uploads are, as the memory server's own say. */
const FILES = 'https://apron-preview.invalid/files';

/** A README long enough to scroll, with what a document has: headings, a list, code, a table, and names that aren't mentions. */
const README = [
	'# Rollout plan',
	'',
	'Canary first, then the fleet in **two waves**. Ask @grace or see #general.',
	'',
	'Jump to [the end](#the-end), or see [setup](./setup.md).',
	'',
	'## Steps',
	'',
	'1. Deploy to the canary pool',
	'2. Watch p99 latency',
	'',
	'```ts',
	'const waves = [1, 2];',
	'```',
	'',
	'| Area | Owner |',
	'| ---- | ----- |',
	'| API  | Ada   |',
	'',
	...Array.from({ length: 80 }, (_, n) => `Paragraph ${n + 1} of the appendix, so the page is longer than the screen.\n`),
	'## The end',
	'',
	'The end.'
].join('\n');

/** Serves `name` from the preview's file host, with CORS, as a server that lets web clients read its files does. */
async function serve(page: Page, name: string, body: string): Promise<void> {
	await page.route(`${FILES}/${name}`, (route: Route) => route.fulfill({
		status: 200,
		contentType: 'text/markdown; charset=utf-8',
		headers: { 'access-control-allow-origin': '*' },
		body
	}));
}

test.describe('an uploaded Markdown file', () => {
	test.use({ ...DEVICES.desktop, knobs: { capabilities: ['embed:upload'] } });

	test('opens rendered on a plain click, scrolls inside the viewer, and closes back to its card, Back included', async ({ preview, page }) => {
		const errors: string[] = [];
		page.on('pageerror', (error) => errors.push(error.message));
		await preview.open();
		await serve(page, 'rollout-plan.md', README);
		await preview.post('general', 'grace', { text: 'The plan', embeds: [{ kind: 'upload', embed_id: 'doc', url: `${FILES}/rollout-plan.md`, title: 'rollout-plan.md' }, { kind: 'upload', embed_id: 'zip', url: `${FILES}/logs.zip`, title: 'logs.zip' }] });

		const card = page.locator('a.ap-embed-file', { hasText: 'rollout-plan.md' });
		await expect(card).toHaveAttribute('aria-haspopup', 'dialog');
		// Any other file is a plain link, as before.
		await expect(page.locator('a.ap-embed-file', { hasText: 'logs.zip' })).not.toHaveAttribute('aria-haspopup');

		await card.click();
		const viewer = page.getByRole('dialog', { name: 'rollout-plan.md' });
		await expect(viewer).toBeVisible();
		// The document has focus, to scroll it by keys.
		await expect(viewer.getByRole('region', { name: 'Document' })).toBeFocused();
		await expect(viewer.locator('.ap-viewer-detail')).toContainText('Grace');
		await expect(viewer.getByRole('link', { name: 'Download rollout-plan.md' })).toHaveAttribute('href', `${FILES}/rollout-plan.md`);

		const text = viewer.getByTestId('doc-viewer-text');
		await expect(text.getByRole('heading', { level: 1 })).toHaveText('Rollout plan');
		await expect(text.getByRole('heading', { level: 2 }).first()).toHaveText('Steps');
		await expect(text.locator('ol > li')).toHaveCount(2);
		await expect(text.locator('table td').first()).toHaveText('API');
		// Its code highlighted, once its language loads.
		await expect(text.locator('pre code.hljs')).toBeVisible();
		// A file isn't a message: names and rooms in it stay text.
		await expect(text).toContainText('Ask @grace or see #general.');
		await expect(text.locator('.ap-mention, .ap-linkchip, [data-room-id]')).toHaveCount(0);

		await test.step('the keys that scroll a page scroll the document, Space included, and only it; Tab reaches the bar', async () => {
			const stage = viewer.locator('.ap-docviewer-stage');
			const scrolled = () => stage.evaluate((node) => node.scrollTop);
			expect(await stage.evaluate((node) => node.scrollHeight > node.clientHeight)).toBe(true);
			/** Where the page is once it has stopped moving (a key's scroll may be animated). */
			const settled = async (): Promise<number> => {
				let last = -1;
				await expect.poll(async () => last === (last = await scrolled())).toBe(true);
				return last;
			};
			await page.keyboard.press('Space');
			await expect.poll(scrolled).toBeGreaterThan(0);
			const afterSpace = await settled();
			await page.keyboard.press('PageDown');
			await expect.poll(scrolled).toBeGreaterThan(afterSpace);
			await page.keyboard.press('End');
			await expect(text.getByText('The end.')).toBeInViewport();
			await expect(viewer).toBeVisible();
			expect(await page.evaluate(() => document.scrollingElement!.scrollTop)).toBe(0);
			// Shift+Tab goes back to the bar, and Tab returns to the document.
			await page.keyboard.press('Shift+Tab');
			await expect(viewer.getByRole('button', { name: 'Close' })).toBeFocused();
			await page.keyboard.press('Tab');
			await expect(stage).toBeFocused();
		});

		await test.step('a link to a heading scrolls there, in the viewer; one relative to the file is its text', async () => {
			const stage = viewer.locator('.ap-docviewer-stage');
			await stage.evaluate((node) => node.scrollTo({ top: 0 }));
			await expect(text.getByRole('link', { name: 'setup' })).toHaveCount(0);
			await expect(text).toContainText('or see setup.');
			const url = page.url();
			await text.getByRole('link', { name: 'the end' }).click();
			await expect(text.getByRole('heading', { name: 'The end' })).toBeInViewport();
			// Neither a new tab nor the app's own address with that fragment.
			expect([page.url(), page.context().pages().length]).toEqual([url, 1]);
			await expect(viewer).toBeVisible();
		});

		await page.keyboard.press('Escape');
		await expect(viewer).toBeHidden();
		await expect(card).toBeFocused();

		await test.step('opens again, read anew, and a click beside the page closes it, not one on it or a drag', async () => {
			await card.click();
			const text = viewer.getByTestId('doc-viewer-text');
			await expect(text.getByRole('heading', { level: 1 })).toHaveText('Rollout plan');
			const stage = viewer.getByRole('region', { name: 'Document' });
			const box = (await stage.boundingBox())!;
			const pageBox = (await viewer.locator('article.ap-docviewer-page').boundingBox())!;
			const beside = { x: (box.x + pageBox.x) / 2, y: box.y + box.height / 2 };
			await text.getByRole('heading', { level: 1 }).click();
			// Selecting text from beside the page.
			await page.mouse.move(beside.x, beside.y);
			await page.mouse.down();
			await page.mouse.move(pageBox.x + 80, beside.y, { steps: 5 });
			await page.mouse.up();
			await expect(viewer).toBeVisible();
			await page.mouse.click(beside.x, beside.y);
			await expect(viewer).toBeHidden();
			await expect(card).toBeFocused();
		});

		await test.step('Back closes it, back to its card, and closing it otherwise leaves no entry for Back to find', async () => {
			// Closed above with Close and Escape: Back now leaves the room as it would have, not into a viewer.
			await expect.poll(() => page.evaluate(() => JSON.stringify(history.state ?? {}))).not.toContain('"doc"');
			await card.click();
			await expect(viewer.getByTestId('doc-viewer-text').getByRole('heading', { level: 1 })).toHaveText('Rollout plan');
			await page.goBack();
			await expect(viewer).toBeHidden();
			await expect(card).toBeFocused();
			await expect(page.locator('article[data-message-id]').last()).toContainText('The plan');
		});
		expect(errors).toEqual([]);
	});

	test('where the server doesn\'t let it be read, says so and offers Download', async ({ preview, page }) => {
		await preview.open();
		// A server that doesn't let other origins read its files: the browser refuses the read, which reaches `fetch` as a
		// network error. (A fulfilled route isn't checked for CORS, so the refusal is played as the error it becomes.)
		await page.route(`${FILES}/private.md`, (route) => route.abort('accessdenied'));
		await preview.post('general', 'grace', { text: 'Notes', embeds: [{ kind: 'upload', embed_id: 'doc', url: `${FILES}/private.md`, title: 'private.md' }] });
		await page.locator('a.ap-embed-file', { hasText: 'private.md' }).click();
		const viewer = page.getByRole('dialog', { name: 'private.md' });
		await expect(viewer.getByRole('status')).toHaveText('This file can’t be previewed here.');
		await expect(viewer.locator('.ap-docviewer-status').getByRole('link', { name: 'Download' })).toHaveAttribute('href', `${FILES}/private.md`);
		await expect(viewer.getByTestId('doc-viewer-text')).toHaveCount(0);
	});
});

test.describe('an uploaded Markdown file on a phone', () => {
	test.use({ ...DEVICES.phone, knobs: { capabilities: ['embed:upload'] } });

	test('fills the screen\'s width, with nothing wider than it, and Back closes it', async ({ preview, page }) => {
		await preview.open();
		await serve(page, 'rollout-plan.md', README);
		await preview.post('general', 'grace', { text: 'The plan', embeds: [{ kind: 'upload', embed_id: 'doc', url: `${FILES}/rollout-plan.md`, title: 'rollout-plan.md' }] });
		await preview.press(page.locator('a.ap-embed-file', { hasText: 'rollout-plan.md' }));
		const viewer = page.getByRole('dialog', { name: 'rollout-plan.md' });
		const article = viewer.locator('article.ap-docviewer-page');
		await expect(article.getByRole('heading', { level: 1 })).toHaveText('Rollout plan');
		const width = page.viewportSize()!.width;
		expect((await article.boundingBox())!.width).toBeCloseTo(width, 0);
		expect(await viewer.locator('.ap-docviewer-stage').evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);

		// The phone's Back closes it, and the room is still there under it.
		await page.goBack();
		await expect(viewer).toBeHidden();
		await expect(page.locator('a.ap-embed-file', { hasText: 'rollout-plan.md' })).toBeVisible();
	});
});

test.describe('the viewer\'s code', () => {
	test.use({ ...DEVICES.desktop, serviceWorkers: 'block', knobs: { capabilities: ['embed:upload'] } });

	test('isn\'t fetched with the page\'s other on-demand code, only once a Markdown file is first opened', async ({ preview, page }) => {
		// Every script the page asks for, read before the page gets it: the viewer's alone draws `ap-docviewer-stage`,
		// the on-demand chunk alone holds `ap-room-carried`. `pending` counts those still being read.
		const bodies: string[] = [];
		let pending = 0;
		await page.route('**/_app/immutable/**/*.js', async (route) => {
			pending += 1;
			try {
				const response = await route.fetch();
				const body = await response.text();
				bodies.push(body);
				await route.fulfill({ response, body });
			} finally {
				pending -= 1;
			}
		});
		const fetched = (pattern: RegExp) => bodies.some((body) => pattern.test(body));
		await preview.open();
		await serve(page, 'rollout-plan.md', README);
		await preview.post('general', 'grace', { text: 'The plan', embeds: [{ kind: 'upload', embed_id: 'doc', url: `${FILES}/rollout-plan.md`, title: 'rollout-plan.md' }] });
		// The background prefetch (`prefetchLazy`) asks for everything it fetches at once: once the on-demand chunk has
		// come and nothing is still on its way, whatever it fetched is here.
		await expect.poll(() => fetched(/ap-room-carried/) && pending === 0, { timeout: 10_000 }).toBe(true);
		expect(fetched(/ap-docviewer-stage/)).toBe(false);

		await page.locator('a.ap-embed-file', { hasText: 'rollout-plan.md' }).click();
		await expect(page.getByRole('dialog', { name: 'rollout-plan.md' }).getByRole('heading', { level: 1 })).toHaveText('Rollout plan');
		expect(fetched(/ap-docviewer-stage/)).toBe(true);
	});
});
