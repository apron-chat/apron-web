import { defineConfig } from '@playwright/test';
// The QA scripts' browser lookup: QA_CHROMIUM, else playwright-core's build under PLAYWRIGHT_BROWSERS_PATH.
import { chromiumPath } from '../scripts/qa/lib/browser.js';

/**
 * The browser suite: the built app's `/__preview` route (the full client on the in-memory protocol server),
 * driven by Playwright. `npm run e2e` builds and runs it; see scripts/qa/README.md. It runs locally, not in CI.
 *
 * `E2E_URL` tests a build served elsewhere; `E2E_BUILD` serves another build directory (default `build/`).
 */
export default defineConfig({
	testDir: '.',
	testMatch: '*.spec.ts',
	outputDir: '../.qa/e2e/results',
	globalSetup: './global-setup.ts',
	fullyParallel: true,
	forbidOnly: true,
	// No retries: a flaky test is a finding, not something to paper over. `--retries 1` while investigating.
	retries: 0,
	timeout: 20_000,
	expect: { timeout: 5_000 },
	reporter: [['list'], ['html', { outputFolder: '../.qa/e2e/report', open: 'never' }]],
	projects: [
		{ name: 'app', testIgnore: /contract/ },
		// The interop contract: the scenes record what they show, then the check reads the records.
		{ name: 'contract-scenes', testMatch: 'contract-scenes.spec.ts', timeout: 60_000 },
		{ name: 'contract', testMatch: 'contract.spec.ts', dependencies: ['contract-scenes'] }
	],
	use: {
		browserName: 'chromium',
		launchOptions: { executablePath: chromiumPath() },
		locale: 'en-US',
		timezoneId: 'UTC',
		contextOptions: { reducedMotion: 'reduce' },
		viewport: { width: 1280, height: 800 },
		trace: 'retain-on-failure',
		screenshot: 'only-on-failure'
	}
});
