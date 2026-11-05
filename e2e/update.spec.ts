import { expect, test } from '@playwright/test';
import { NOW } from '../scripts/qa/lib/helpers.js';
import { mockServer } from './mock-server';

/**
 * A copy of the app that hasn't checked for a newer deploy in three days checks before it connects, and reloads into
 * a newer one rather than connecting (`$lib/ui/version-check`, whose rules its unit tests cover): here, through
 * `hooks.client.ts` and a real reload.
 */

const DAY = 24 * 60 * 60 * 1000;
/** A deploy built after any this suite runs. */
const NEWER = String(Date.UTC(2099, 0, 1));

// The page's own requests, all of them: no worker in between.
test.use({ serviceWorkers: 'block' });

test('not checked for three days, with a newer deploy out: reloads before it ever connects', async ({ page }) => {
	const base = process.env.E2E_URL;
	if (!base) throw new Error('E2E_URL is unset: run through `npm run e2e` (global-setup serves the build).');
	const version = ((await (await page.request.get(`${base}/_app/version.json`)).json()) as { version: string }).version;
	await page.clock.setFixedTime(NOW);
	// First: its WebSocket stand-in replaces the browser's, and the one below wraps that.
	await mockServer(page);
	// What happened, in order, across reloads (kept in session storage, which a reload keeps): `load` for each page
	// load, `ws` for each WebSocket opened, `check` for each request for `version.json`. The record of the last check,
	// four days old, is seeded on the first load only.
	await page.addInitScript(({ version, at }) => {
		const note = (what: string) => {
			const log = JSON.parse(sessionStorage.getItem('e2e.log') ?? '[]') as string[];
			sessionStorage.setItem('e2e.log', JSON.stringify([...log, what]));
		};
		if (!sessionStorage.getItem('e2e.log')) localStorage.setItem('apron.versionChecked', JSON.stringify({ version, at }));
		note('load');
		const Native = WebSocket;
		window.WebSocket = class extends Native {
			constructor(url: string | URL, protocols?: string | string[]) {
				super(url, protocols);
				note('ws');
			}
		};
		const nativeFetch = window.fetch;
		window.fetch = (input, init) => {
			if (String(input instanceof Request ? input.url : input).includes('/_app/version.json')) note('check');
			return nativeFetch(input, init);
		};
	}, { version, at: NOW.getTime() - 4 * DAY });
	await page.route('**/_app/version.json', (route) => route.fulfill({ json: { version: NEWER } }));
	await page.goto(`${base}/`);
	await expect(page.getByTestId('connection-status')).toHaveText('Connected');
	// The first load checks, and opens no connection before reloading. The page loaded again is (here) the same old
	// copy: it doesn't reload once more, but connects, and offers the reload.
	const log: string[] = await page.evaluate(() => JSON.parse(sessionStorage.getItem('e2e.log') ?? '[]'));
	expect(log.slice(0, 2)).toEqual(['load', 'check']);
	expect(log.filter((what) => what !== 'check')).toEqual(['load', 'load', 'ws']);
	await expect(page.getByText('Apron has been updated')).toBeVisible();
});
