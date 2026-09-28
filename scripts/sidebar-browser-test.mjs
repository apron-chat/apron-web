import { execFileSync, spawn } from 'node:child_process';
import { chromium } from 'playwright';

const port = process.env.SIDEBAR_TEST_PORT ?? '0';
const server = spawn('npm', ['run', 'dev', '--', '--host', '127.0.0.1', '--port', port, '--strictPort'], {
	stdio: ['ignore', 'pipe', 'pipe'],
	env: { ...process.env, BROWSER: 'none' }
});
let serverOutput = '';
let serverExited = false;
let serverExitStatus;
const serverExit = new Promise((resolve) => {
	server.once('exit', (code, signal) => {
		serverExited = true;
		serverExitStatus = { code, signal };
		resolve();
	});
});
server.stdout.on('data', (chunk) => { serverOutput += chunk; });
server.stderr.on('data', (chunk) => { serverOutput += chunk; });

let browser;
try {
	const baseUrl = await waitForServer();
	browser = await launchBrowser();
	const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
	const page = await context.newPage();
	await page.addInitScript(() => {
		localStorage.setItem('apron.sidebar', JSON.stringify({ width: 248, collapsed: true }));
	});
	await page.goto(`${baseUrl}/__preview`, { waitUntil: 'networkidle' });
	await page.waitForFunction(() => {
		const app = document.querySelector('.app');
		return app?.classList.contains('side-collapsed') && app.querySelector('button.toggle') !== null;
	});

	assertPhonePane(await inspectPane(page), {
		pane: 'main',
		sideDisplay: 'none',
		mainDisplay: 'flex'
	});

	await page.locator('button[aria-label="Back to rooms"]').click();
	await page.waitForFunction(() => document.querySelector('.app')?.getAttribute('data-pane') === 'rooms');
	assertPhonePane(await inspectPane(page), {
		pane: 'rooms',
		sideDisplay: 'flex',
		mainDisplay: 'none'
	});

	console.log('Sidebar browser test passed at 390px for main and rooms panes.');
} catch (error) {
	console.error(error instanceof Error ? error.message : error);
	if (serverOutput) console.error(serverOutput);
	process.exitCode = 1;
} finally {
	await browser?.close();
	if (!serverExited) server.kill('SIGTERM');
	await serverExit;
}

async function waitForServer() {
	const deadline = Date.now() + 20_000;
	while (Date.now() < deadline) {
		if (serverExited) {
			throw new Error(`Vite exited before becoming ready (${JSON.stringify(serverExitStatus)})`);
		}
		const baseUrl = localServerUrl();
		if (baseUrl) {
			try {
				const response = await fetch(`${baseUrl}/__preview`);
				if (response.ok && !serverExited) return baseUrl;
			} catch {
				// The dev server is still starting.
			}
		}
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	throw new Error('Timed out waiting for the spawned Vite server');
}

function localServerUrl() {
	const match = serverOutput.match(/Local:\s+http:\/\/127\.0\.0\.1:(\d+)/);
	return match ? `http://127.0.0.1:${match[1]}` : undefined;
}

async function launchBrowser() {
	const executablePath = process.env.CHROMIUM_PATH ?? findChromium();
	try {
		return await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
	} catch (error) {
		if (executablePath) throw error;
		console.warn('Chromium is not installed; installing the Playwright browser once for this test.');
		execFileSync('npx', ['playwright', 'install', 'chromium'], { stdio: 'inherit' });
		return chromium.launch({ headless: true });
	}
}

function findChromium() {
	try {
		return execFileSync('which', ['chromium'], { encoding: 'utf8' }).trim() || undefined;
	} catch {
		return undefined;
	}
}

async function inspectPane(page) {
	return page.evaluate(() => {
		const app = document.querySelector('.app');
		const side = app?.querySelector('.ap-shell-side');
		const main = app?.querySelector('.ap-shell-main');
		const header = app?.querySelector('.ap-roomhead');
		const toggle = app?.querySelector('button.toggle');
		const rootStyle = getComputedStyle(document.documentElement);
		return {
			pane: app?.dataset.pane,
			collapsed: app?.classList.contains('side-collapsed'),
			sideDisplay: side ? getComputedStyle(side).display : undefined,
			sideVisibility: side ? getComputedStyle(side).visibility : undefined,
			sideOpacity: side ? getComputedStyle(side).opacity : undefined,
			mainDisplay: main ? getComputedStyle(main).display : undefined,
			mainVisibility: main ? getComputedStyle(main).visibility : undefined,
			mainOpacity: main ? getComputedStyle(main).opacity : undefined,
			toggleDisplay: toggle ? getComputedStyle(toggle).display : undefined,
			headerPaddingLeft: header ? getComputedStyle(header).paddingLeft : undefined,
			space4: rootStyle.getPropertyValue('--space-4').trim()
		};
	});
}

function assertPhonePane(actual, expected) {
	const checks = {
		pane: actual.pane === expected.pane,
		collapsed: actual.collapsed === true,
		sideDisplay: actual.sideDisplay === expected.sideDisplay,
		sideVisible: (actual.sideDisplay !== 'none' && actual.sideVisibility === 'visible' && actual.sideOpacity !== '0') === (expected.sideDisplay !== 'none'),
		mainDisplay: actual.mainDisplay === expected.mainDisplay,
		mainVisible: (actual.mainDisplay !== 'none' && actual.mainVisibility === 'visible' && actual.mainOpacity !== '0') === (expected.mainDisplay !== 'none'),
		toggleHidden: actual.toggleDisplay === 'none',
		headerUsesNormalPadding: actual.headerPaddingLeft === actual.space4
	};
	const failed = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name);
	if (failed.length) throw new Error(`Phone pane ${expected.pane} failed: ${failed.join(', ')}\n${JSON.stringify(actual)}`);
}
