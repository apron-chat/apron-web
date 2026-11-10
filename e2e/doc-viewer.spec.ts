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
		await expect(viewer.getByRole('button', { name: 'Close' })).toBeFocused();
		await expect(viewer.locator('.ap-viewer-detail')).toContainText('Grace');
		await expect(viewer.getByRole('link', { name: 'Download rollout-plan.md' })).toHaveAttribute('href', `${FILES}/rollout-plan.md`);

		const text = viewer.getByTestId('doc-viewer-text');
		await expect(text.getByRole('heading', { level: 1 })).toHaveText('Rollout plan');
		await expect(text.getByRole('heading', { level: 2 })).toHaveText('Steps');
		await expect(text.locator('ol > li')).toHaveCount(2);
		await expect(text.locator('table td').first()).toHaveText('API');
		// Its code highlighted, once its language loads.
		await expect(text.locator('pre code.hljs')).toBeVisible();
		// A file isn't a message: names and rooms in it stay text.
		await expect(text).toContainText('Ask @grace or see #general.');
		await expect(text.locator('.ap-mention, .ap-linkchip, [data-room-id]')).toHaveCount(0);

		await test.step('the scroll keys scroll the page from Close, and only the page', async () => {
			const stage = viewer.locator('.ap-docviewer-stage');
			const scrolled = () => stage.evaluate((node) => node.scrollTop);
			expect(await stage.evaluate((node) => node.scrollHeight > node.clientHeight)).toBe(true);
			await page.keyboard.press('PageDown');
			await expect.poll(scrolled).toBeGreaterThan(0);
			await page.keyboard.press('End');
			await expect(text.getByText('The end.')).toBeInViewport();
			await expect(viewer.getByRole('button', { name: 'Close' })).toBeFocused();
			expect(await page.evaluate(() => document.scrollingElement!.scrollTop)).toBe(0);
		});

		await page.keyboard.press('Escape');
		await expect(viewer).toBeHidden();
		await expect(card).toBeFocused();

		await test.step('opens again, read anew', async () => {
			await card.click();
			await expect(viewer.getByTestId('doc-viewer-text').getByRole('heading', { level: 1 })).toHaveText('Rollout plan');
			await viewer.getByRole('button', { name: 'Close' }).click();
			await expect(viewer).toBeHidden();
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
		// Scripts as they arrive: the viewer's alone draws `ap-docviewer-stage`; the on-demand chunk alone holds `ap-room-carried`.
		const fetched: string[] = [];
		page.on('response', async (response) => {
			if (/\/_app\/immutable\/.*\.js$/.test(response.url())) fetched.push(await response.text().catch(() => ''));
		});
		const has = (pattern: RegExp) => () => fetched.some((body) => pattern.test(body));
		await preview.open();
		await serve(page, 'rollout-plan.md', README);
		await preview.post('general', 'grace', { text: 'The plan', embeds: [{ kind: 'upload', embed_id: 'doc', url: `${FILES}/rollout-plan.md`, title: 'rollout-plan.md' }] });
		// The background prefetch (`prefetchLazy`) has fetched the page's on-demand code, and not the viewer's.
		await expect.poll(has(/ap-room-carried/), { timeout: 10_000 }).toBe(true);
		expect(has(/ap-docviewer-stage/)()).toBe(false);

		await page.locator('a.ap-embed-file', { hasText: 'rollout-plan.md' }).click();
		await expect(page.getByRole('dialog', { name: 'rollout-plan.md' }).getByRole('heading', { level: 1 })).toHaveText('Rollout plan');
		expect(has(/ap-docviewer-stage/)()).toBe(true);
	});
});
