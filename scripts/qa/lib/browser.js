import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const CANDIDATES = [
	'chrome-linux/chrome',
	'chrome-linux64/chrome',
	'chrome-mac/Chromium.app/Contents/MacOS/Chromium',
	'chrome-mac-arm64/Chromium.app/Contents/MacOS/Chromium',
	'chrome-win/chrome.exe',
	'chrome-win64/chrome.exe'
];

/**
 * The Chromium to drive: `QA_CHROMIUM` if set, else the build playwright-core expects (under
 * `PLAYWRIGHT_BROWSERS_PATH` or Playwright's default cache), else any `chromium-*` build in
 * `PLAYWRIGHT_BROWSERS_PATH`. Both sides of a comparison always run in the same browser.
 */
export function chromiumPath() {
	const override = process.env.QA_CHROMIUM;
	if (override) {
		if (!existsSync(override)) throw new Error(`QA_CHROMIUM=${override} does not exist.`);
		return override;
	}
	try {
		const expected = chromium.executablePath();
		if (expected && existsSync(expected)) return expected;
	} catch {
		// Fall through to the scan.
	}
	const root = process.env.PLAYWRIGHT_BROWSERS_PATH;
	if (root && existsSync(root)) {
		const builds = readdirSync(root)
			.filter((d) => /^chromium-\d+$/.test(d))
			.sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]));
		for (const build of builds) {
			for (const rel of CANDIDATES) {
				const path = join(root, build, rel);
				if (existsSync(path)) {
					console.warn(`qa: using ${path}; playwright-core expects ${safeExpected()}`);
					return path;
				}
			}
		}
	}
	throw new Error(
		[
			'No Chromium found for the QA scripts.',
			`  playwright-core looks for: ${safeExpected()}`,
			`  PLAYWRIGHT_BROWSERS_PATH: ${root ?? '(unset)'}`,
			'Set QA_CHROMIUM to a Chrome/Chromium executable, point PLAYWRIGHT_BROWSERS_PATH at a',
			'Playwright browsers directory, or install the matching build with',
			'`npx playwright-core install chromium`.'
		].join('\n')
	);
}

function safeExpected() {
	try {
		return chromium.executablePath();
	} catch {
		return '(unknown)';
	}
}

/** Launches headless Chromium. */
export function launch() {
	return chromium.launch({ executablePath: chromiumPath() });
}
