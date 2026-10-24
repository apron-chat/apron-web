import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expand } from './suites.js';
import { NARROW_MAX, NOW, checkRewrites, fontsReady, openPreview, setDevice } from './helpers.js';

/**
 * Shoots a suite against one or more targets (`{ name, url, out }`). Each job runs on every target back to
 * back, alternating which goes first, so load on a busy machine falls on both sides alike. A failing job is
 * retried (fixed waits flake under load) before it counts as failed.
 *
 * @param {object} o
 * @param {import('./suites.js').Suite} o.suite
 * @param {{ name: string, url: string, out: string }[]} o.targets
 * @param {any} o.browser
 * @param {string[]} [o.filters]
 * @param {Set<string>} [o.only] Job ids to run (for rechecks).
 * @param {number} [o.retries]
 * @param {number} [o.jobs] Jobs in flight at once.
 * @param {(line: string) => void} [o.log]
 * @returns {Promise<Record<string, ShotResult[]>>} Results per target name.
 */
export async function shoot({ suite, targets, browser, filters = [], only, retries = 1, jobs = 1, log = console.log }) {
	const all = expand(suite, filters).filter((j) => !only || only.has(j.id));
	for (const t of targets) mkdirSync(t.out, { recursive: true });
	/** @type {Record<string, ShotResult[]>} */
	const results = Object.fromEntries(targets.map((t) => [t.name, []]));
	let next = 0;
	let done = 0;
	const width = String(all.length).length;
	async function worker() {
		while (next < all.length) {
			const index = next++;
			const job = all[index];
			const order = index % 2 ? [...targets].reverse() : targets;
			const notes = [];
			for (const target of order) {
				let result;
				for (let attempt = 0; attempt <= retries; attempt++) {
					result = await runJob(browser, suite, job, target);
					result.attempts = attempt + 1;
					if (result.ok) break;
				}
				results[target.name].push(/** @type {ShotResult} */ (result));
				const r = /** @type {ShotResult} */ (result);
				notes.push(
					r.ok
						? `${target.name} ${(r.ms / 1000).toFixed(1)}s${r.attempts > 1 ? ` (retried ${r.attempts - 1})` : ''}${r.errors.length ? ` [${r.errors.length} console errors]` : ''}`
						: `${target.name} FAILED: ${r.error}`
				);
			}
			done++;
			log(`[${String(done).padStart(width)}/${all.length}] ${job.id}  ${notes.join(', ')}`);
		}
	}
	await Promise.all(Array.from({ length: Math.max(1, Math.min(jobs, all.length)) }, worker));
	for (const t of targets) {
		results[t.name].sort((a, b) => all.findIndex((j) => j.id === a.id) - all.findIndex((j) => j.id === b.id));
		writeFileSync(join(t.out, 'results.json'), JSON.stringify({ suite: suite.name, url: t.url, results: results[t.name] }, null, 1));
	}
	return results;
}

/**
 * @typedef {{ id: string, ok: boolean, files: string[], errors: string[], error?: string, ms: number, attempts: number }} ShotResult
 */

/** Runs one job against one target in a fresh, deterministic browser context. */
async function runJob(browser, suite, job, target) {
	const { id, scene, viewport, theme } = job;
	const vp = suite.viewports[viewport];
	const started = Date.now();
	/** @type {string[]} */
	const files = [];
	/** @type {string[]} */
	const errors = [];
	const context = await browser.newContext({
		viewport: { width: vp.width, height: vp.height },
		deviceScaleFactor: vp.deviceScaleFactor ?? 1,
		isMobile: !!vp.isMobile,
		hasTouch: !!vp.hasTouch,
		colorScheme: theme === 'dark' ? 'dark' : 'light',
		reducedMotion: 'reduce',
		...suite.contextOptions
	});
	/** @type {any} */
	let page;
	const device = { viewport, theme, touch: !!vp.hasTouch, narrow: vp.width < NARROW_MAX };
	const t = {
		id,
		...device,
		url: target.url,
		/** Takes the scene's screenshot, or an extra one named `<id>--<suffix>`. */
		shot: async (/** @type {string | undefined} */ suffix) => {
			const name = `${suffix ? `${id}--${suffix}` : id}.png`;
			await fontsReady(page);
			await page.screenshot({ path: join(target.out, name), animations: 'disabled', caret: 'hide' });
			files.push(name);
		}
	};
	try {
		await context.clock.setFixedTime(suite.now ?? NOW);
		if (suite.context) await suite.context(context, t);
		if (scene.context) await scene.context(context, t);
		page = await context.newPage();
		setDevice(page, device);
		page.setDefaultTimeout(scene.timeout ?? suite.timeout);
		page.on('pageerror', (/** @type {Error} */ e) => errors.push(String(e)));
		page.on('console', (/** @type {any} */ m) => m.type() === 'error' && errors.push(m.text()));
		if (suite.open) await suite.open(page, target.url, t);
		else await openPreview(page, target.url, { path: suite.path, settle: suite.settle });
		if (scene.steps) await scene.steps(page, t);
		if (suite.beforeShot) await suite.beforeShot(page, t);
		await t.shot();
		const extra = scene.extra === undefined ? suite.extra : scene.extra;
		if (extra) await extra(page, t);
		checkRewrites(context);
		removeFailed(target.out, id);
		return { id, ok: true, files, errors, ms: Date.now() - started, attempts: 1 };
	} catch (e) {
		for (const f of files) rmSync(join(target.out, f), { force: true });
		try {
			await page?.screenshot({ path: join(target.out, `${id}.FAILED.png`) });
		} catch {
			// The page may be gone.
		}
		return { id, ok: false, files: [], errors, error: String(e).split('\n')[0], ms: Date.now() - started, attempts: 1 };
	} finally {
		await context.close().catch(() => {});
	}
}

function removeFailed(dir, id) {
	rmSync(join(dir, `${id}.FAILED.png`), { force: true });
}

/** Removes the screenshots (and results) in a directory before a fresh run. */
export function cleanShots(dir) {
	try {
		for (const f of readdirSync(dir)) if (f.endsWith('.png') || f === 'results.json') rmSync(join(dir, f));
	} catch {
		// Nothing there yet.
	}
}
