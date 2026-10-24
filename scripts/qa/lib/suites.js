import { readdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const SUITES_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'suites');

/** Suite names: the files in scripts/qa/suites. */
export function suiteNames() {
	return readdirSync(SUITES_DIR)
		.filter((f) => f.endsWith('.js'))
		.map((f) => basename(f, '.js'))
		.sort();
}

/**
 * Loads a suite by name (a file in scripts/qa/suites) or by path, and fills in its defaults.
 *
 * @returns {Promise<Suite>}
 */
export async function loadSuite(nameOrPath) {
	const isPath = /[/\\]|\.m?js$/.test(nameOrPath);
	const file = isPath ? nameOrPath : join(SUITES_DIR, `${nameOrPath}.js`);
	let mod;
	try {
		mod = await import(pathToFileURL(file).href);
	} catch (e) {
		if (/** @type {any} */ (e).code === 'ERR_MODULE_NOT_FOUND' && !isPath)
			throw new Error(`no suite "${nameOrPath}"; suites: ${suiteNames().join(', ')}`);
		throw e;
	}
	const suite = mod.default ?? mod;
	const name = isPath ? basename(file).replace(/\.m?js$/, '') : nameOrPath;
	if (!suite.viewports || !Object.keys(suite.viewports).length) throw new Error(`suite ${name}: no viewports`);
	if (!Array.isArray(suite.scenes)) throw new Error(`suite ${name}: no scenes`);
	const seen = new Set();
	for (const scene of suite.scenes) {
		if (!scene.name || /--|[/\\\s]/.test(scene.name)) throw new Error(`suite ${name}: bad scene name "${scene.name}"`);
		if (seen.has(scene.name)) throw new Error(`suite ${name}: duplicate scene "${scene.name}"`);
		seen.add(scene.name);
		for (const vp of scene.viewports ?? [])
			if (!suite.viewports[vp]) throw new Error(`suite ${name}: scene ${scene.name} names unknown viewport ${vp}`);
	}
	return { themes: ['light'], path: '/__preview', timeout: 5000, settle: 500, interactions: [], ...suite, name };
}

/**
 * Expands a suite into shot jobs, `<scene>--<viewport>--<theme>`, in a stable order (viewport, theme,
 * scene), keeping those whose id contains any of the filters.
 */
export function expand(suite, filters = []) {
	const jobs = [];
	for (const viewport of Object.keys(suite.viewports))
		for (const theme of suite.themes)
			for (const scene of suite.scenes) {
				if (scene.viewports && !scene.viewports.includes(viewport)) continue;
				if (scene.themes && !scene.themes.includes(theme)) continue;
				const id = `${scene.name}--${viewport}--${theme}`;
				if (filters.length && !filters.some((f) => id.includes(f))) continue;
				jobs.push({ id, scene, viewport, theme });
			}
	return jobs;
}

/**
 * @typedef {object} Scene
 * @property {string} name
 * @property {string[]} [viewports] Subset of the suite's viewports (default: all).
 * @property {string[]} [themes] Subset of the suite's themes (default: all).
 * @property {(page: any, t: ShotContext) => Promise<void>} [steps] Brings the app into the state to shoot.
 * @property {(page: any, t: ShotContext) => Promise<void>} [extra] Runs after the main shot; call `t.shot(suffix)`.
 * @property {(context: any, t: ShotContext) => Promise<void>} [context] Prepares the browser context (routes, storage).
 * @property {number} [timeout]
 *
 * @typedef {object} Suite
 * @property {string} name
 * @property {string} [description]
 * @property {Record<string, object>} viewports
 * @property {string[]} themes
 * @property {Scene[]} scenes
 * @property {string} path
 * @property {number} timeout
 * @property {number} settle
 * @property {any[]} interactions
 *
 * @typedef {{ id: string, viewport: string, theme: string, touch: boolean, narrow: boolean, shot: (suffix?: string) => Promise<void> }} ShotContext
 */
