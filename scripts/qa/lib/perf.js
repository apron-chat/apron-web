import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { cpus, loadavg } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const DESKTOP = { width: 1280, height: 800 };
const READY = '[data-testid=message-list] .ap-msg';

/**
 * Page load and interaction metrics for several URLs, strictly interleaved: every (run, probe) unit measures
 * each URL once, rotating which goes first (AB, BA, AB… for two), so drift in machine load hits all sides
 * alike. Each measurement is a fresh context with the cache disabled and the CPU throttled.
 *
 * A probe is `{ name, viewport?, knobs?, setup?(page), action?(page), settle?, budget? }`: one without an `action`
 * measures the load, as the built-in `load` probe does. `knobs` set the preview's memory server
 * (`PreviewKnobs`), e.g. many rooms or long histories; `budget: false` leaves a probe whose counts follow
 * the machine's speed out of `qa budget`. Suites export theirs as `interactions`;
 * `selectProbes` picks them. `calls` adds each probe's JS function calls (see `measure`), named by chunk from
 * `chunkBuilds` (the served builds' directories).
 */
export async function runPerf({ browser, urls, labels = urls, runs = 5, cpu = 4, reducedMotion, probes, path = '/__preview', builds = [], chunkBuilds = builds, calls = false, log = console.log }) {
	const all = probes;
	const chunkNames = urls.map((_, i) => chunkNamesOf(chunkBuilds[i]));
	const start = loadavg();
	if (start[0] > cpus().length * 0.75)
		log(`qa perf: load average ${start[0].toFixed(1)} on ${cpus().length} CPUs; the machine is busy, so read the spread before the medians.`);
	/** @type {Record<string, Record<string, any[]>>} */
	const samples = Object.fromEntries(all.map((p) => [p.name, Object.fromEntries(labels.map((l) => [l, []]))]));
	let unit = 0;
	for (let run = 0; run < runs; run++) {
		for (const probe of all) {
			const order = urls.map((_, i) => (i + unit) % urls.length);
			unit++;
			for (const i of order) samples[probe.name][labels[i]].push(await measure(browser, urls[i], probe, { cpu, path, reducedMotion, calls, chunkNames: chunkNames[i] }));
		}
		log(`perf run ${run + 1}/${runs} done`);
	}
	const result = {
		runs,
		cpu,
		calls,
		labels,
		urls,
		loadavg: { start, end: loadavg() },
		probes: Object.fromEntries(
			all.map((p) => [p.name, Object.fromEntries(labels.map((l) => [l, { stats: stats(samples[p.name][l]), samples: samples[p.name][l] }]))])
		),
		/** @type {Record<string, any>} */
		bundle: {}
	};
	builds.forEach((dir, i) => {
		if (dir && labels[i]) result.bundle[labels[i]] = bundleSize(dir);
	});
	return result;
}

/** The `load` probe plus a suite's interactions, narrowed to `only` (probe names) when given. */
export function selectProbes(suite, only = []) {
	const all = [{ name: 'load' }, ...suite.interactions.filter((/** @type {any} */ p) => p.name !== 'load')];
	const unknown = only.filter((n) => !all.some((p) => p.name === n));
	if (unknown.length) throw new Error(`unknown perf probe ${unknown.join(', ')}; ${suite.name} has ${all.map((p) => p.name).join(', ')}`);
	return only.length ? all.filter((p) => only.includes(p.name)) : all;
}

/**
 * Opens a throttled page on `url` and measures one probe. With `calls`, also counts the JS functions the
 * page's own scripts call in the window (`calls`, and `chunks`: the same by chunk), from V8's precise coverage:
 * a count that follows only what the code does, not how fast the machine does it.
 */
async function measure(browser, url, probe, { cpu, path, reducedMotion, calls, chunkNames }) {
	const context = await browser.newContext({ viewport: probe.viewport ?? DESKTOP, colorScheme: 'dark', deviceScaleFactor: 1, reducedMotion });
	try {
		const page = await context.newPage();
		const cdp = await context.newCDPSession(page);
		await cdp.send('Performance.enable');
		await cdp.send('Network.enable');
		await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
		await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });
		await page.addInitScript(() => {
			const w = /** @type {any} */ (window);
			w.__lcp = 0;
			w.__cls = 0;
			w.__longtasks = [];
			new PerformanceObserver((l) => l.getEntries().forEach((e) => (w.__lcp = e.startTime))).observe({ type: 'largest-contentful-paint', buffered: true });
			new PerformanceObserver((l) => l.getEntries().forEach((e) => !(/** @type {any} */ (e).hadRecentInput) && (w.__cls += /** @type {any} */ (e).value))).observe({ type: 'layout-shift', buffered: true });
			new PerformanceObserver((l) => l.getEntries().forEach((e) => w.__longtasks.push(e.duration))).observe({ type: 'longtask', buffered: true });
		});
		if (probe.knobs) await page.addInitScript((knobs) => ((/** @type {any} */ (window)).__APRON_PREVIEW__ = knobs), probe.knobs);
		const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
		// After a full collection: what the page keeps. Before it, the heap reads whatever garbage the last
		// collection left, which follows when V8 ran it (a change that allocates less can read 80% higher).
		const retainedHeapMB = async () => {
			await cdp.send('HeapProfiler.collectGarbage');
			return (await metrics()).JSHeapUsedSize / 1048576;
		};
		// Started before the navigation, it counts from the page's first script: the renderer that loads the page
		// is the one the blank page had, so the coverage carries over.
		if (calls) {
			await cdp.send('Profiler.enable');
			await cdp.send('Profiler.startPreciseCoverage', { callCount: true, detailed: false });
		}
		const origin = new URL(url).origin;
		const t0 = Date.now();
		await page.goto(new URL(path, url.endsWith('/') ? url : `${url}/`).href);
		await page.waitForSelector(READY, { timeout: 30000 });
		const ready = Date.now() - t0;
		await page.waitForTimeout(1200);
		if (!probe.action) {
			const m = await metrics();
			const counted = calls ? await callCounts(cdp, origin, chunkNames) : {};
			const nav = await page.evaluate(() => {
				const w = /** @type {any} */ (window);
				const n = /** @type {PerformanceNavigationTiming} */ (performance.getEntriesByType('navigation')[0]);
				return {
					fcp: performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? NaN,
					lcp: w.__lcp,
					dcl: n.domContentLoadedEventEnd,
					cls: w.__cls,
					longTasks: w.__longtasks.length,
					longTaskMs: w.__longtasks.reduce((a, b) => a + b, 0),
					requests: performance.getEntriesByType('resource').length,
					// Uncompressed, as the code the browser parses at startup; `bundle` has the gzipped totals.
					startupJsKB: /** @type {PerformanceResourceTiming[]} */ (performance.getEntriesByType('resource')).filter((r) => new URL(r.name).pathname.endsWith('.js')).reduce((n, r) => n + r.decodedBodySize, 0) / 1024,
					domNodes: document.getElementsByTagName('*').length
				};
			});
			return {
				ready,
				...nav,
				scriptMs: m.ScriptDuration * 1000,
				taskMs: m.TaskDuration * 1000,
				layoutMs: m.LayoutDuration * 1000,
				styleMs: m.RecalcStyleDuration * 1000,
				layouts: m.LayoutCount,
				styleRecalcs: m.RecalcStyleCount,
				...counted,
				heapMB: await retainedHeapMB()
			};
		}
		if (probe.setup) await probe.setup(page);
		await page.waitForTimeout(300);
		await page.evaluate(() => {
			const w = /** @type {any} */ (window);
			w.__frames = [];
			let last = performance.now();
			const tick = (/** @type {number} */ t) => {
				w.__frames.push(t - last);
				last = t;
				if (w.__frames.length < 2000) w.__raf = requestAnimationFrame(tick);
			};
			w.__raf = requestAnimationFrame(tick);
		});
		// Taking the coverage resets its counters, so what the next take returns is the action's alone.
		if (calls) await cdp.send('Profiler.takePreciseCoverage');
		const before = await metrics();
		await probe.action(page);
		await page.waitForTimeout(probe.settle ?? 600);
		const after = await metrics();
		const counted = calls ? await callCounts(cdp, origin, chunkNames) : {};
		const frames = await page.evaluate(() => {
			const w = /** @type {any} */ (window);
			cancelAnimationFrame(w.__raf);
			return /** @type {number[]} */ (w.__frames.slice(1));
		});
		const sorted = [...frames].sort((a, b) => a - b);
		return {
			frames: frames.length,
			maxFrameMs: sorted.at(-1) ?? NaN,
			p95FrameMs: sorted[Math.floor(sorted.length * 0.95)] ?? NaN,
			jankFrames: frames.filter((f) => f > 34).length,
			scriptMs: (after.ScriptDuration - before.ScriptDuration) * 1000,
			layoutMs: (after.LayoutDuration - before.LayoutDuration) * 1000,
			styleMs: (after.RecalcStyleDuration - before.RecalcStyleDuration) * 1000,
			layouts: after.LayoutCount - before.LayoutCount,
			styleRecalcs: after.RecalcStyleCount - before.RecalcStyleCount,
			...counted
		};
	} finally {
		await context.close().catch(() => {});
	}
}

/**
 * Function calls since the last take, summed over the scripts the page's origin served (Playwright's own
 * injected scripts have no URL and don't count), in all and by chunk. A function counts once per call; one
 * that never ran counts 0.
 */
async function callCounts(cdp, origin, chunkNames = new Map()) {
	const { result } = await cdp.send('Profiler.takePreciseCoverage');
	/** @type {Record<string, number>} */
	const chunks = {};
	let total = 0;
	for (const script of result) {
		if (!script.url.startsWith(`${origin}/`)) continue;
		const file = new URL(script.url).pathname.slice(1);
		const name = file.endsWith('.js') ? (chunkNames.get(file) ?? file.split('/').pop()) : 'inline';
		const n = script.functions.reduce((sum, f) => sum + f.ranges[0].count, 0);
		total += n;
		chunks[name] = (chunks[name] ?? 0) + n;
	}
	if (!total) throw new Error('precise coverage counted no calls in the page: did the navigation move it to another renderer?');
	return { calls: total, chunks };
}

/**
 * Stable names for a build's JS chunks, from the Vite manifest SvelteKit leaves in `.svelte-kit` (`index-client`,
 * `on-demand`, `nodes/2`…), where file names change with every hash. Used only when the manifest's files are
 * the ones `buildDir` holds; otherwise chunks go by file name.
 */
export function chunkNamesOf(buildDir) {
	/** @type {Map<string, string>} */
	const names = new Map();
	const manifest = join(repoRootOf(buildDir), '.svelte-kit/output/client/.vite/manifest.json');
	if (!buildDir || !existsSync(manifest)) return names;
	for (const [key, entry] of Object.entries(JSON.parse(readFileSync(manifest, 'utf8')))) {
		if (!entry.file?.endsWith('.js') || !existsSync(join(buildDir, entry.file))) continue;
		const vendor = key.startsWith('node_modules/') ? `${key.split('/')[1].startsWith('@') ? key.split('/').slice(1, 3).join('/') : key.split('/')[1]}:` : '';
		names.set(entry.file, `${vendor}${entry.name ?? entry.file}`);
	}
	return names;
}

/** The checkout a build directory belongs to: its parent, where `vite build` writes `build/` beside `.svelte-kit/`. */
const repoRootOf = (buildDir) => join(buildDir ?? '.', '..');

const median = (xs) => {
	const s = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
	if (!s.length) return NaN;
	const m = Math.floor(s.length / 2);
	return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Median, min and max of each metric. */
function stats(rows) {
	if (!rows.length) return {};
	return Object.fromEntries(
		Object.keys(rows[0]).filter((k) => typeof rows[0][k] === 'number').map((k) => {
			const xs = rows.map((r) => r[k]).filter((x) => Number.isFinite(x));
			return [k, { median: median(xs), min: Math.min(...xs), max: Math.max(...xs), n: xs.length }];
		})
	);
}

/** Bytes of JS and CSS under a build's `_app`, raw and gzipped. */
export function bundleSize(buildDir) {
	const root = join(buildDir, '_app');
	if (!existsSync(root)) return null;
	const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
	const files = walk(root);
	const size = (ext) => {
		const fs = files.filter((f) => f.endsWith(ext));
		return { files: fs.length, kb: fs.reduce((s, f) => s + statSync(f).size, 0) / 1024, gzipKb: fs.reduce((s, f) => s + gzipSync(readFileSync(f)).length, 0) / 1024 };
	};
	return { js: size('.js'), css: size('.css') };
}

const fmt = (x) => (!Number.isFinite(x) ? '–' : Number.isInteger(x) ? String(x) : Math.abs(x) >= 100 ? x.toFixed(0) : Math.abs(x) >= 10 ? x.toFixed(1) : x.toFixed(2));

/**
 * Table rows for a perf result: per probe and metric, each label's `median [min–max]`, and for every label
 * after the first its Δ against the first, marked as noise (`~`) when the two ranges overlap.
 */
export function perfRows(result) {
	const rows = [];
	for (const [probe, byLabel] of Object.entries(result.probes)) {
		const first = byLabel[result.labels[0]].stats;
		for (const metric of Object.keys(first)) {
			const base = first[metric];
			rows.push({
				probe,
				metric,
				cells: result.labels.map((label, i) => {
					const s = byLabel[label].stats[metric];
					if (!s) return { text: '–' };
					const text = `${fmt(s.median)} [${fmt(s.min)}–${fmt(s.max)}]`;
					if (!i) return { text };
					const noise = s.min <= base.max && base.min <= s.max;
					const d = base.median ? `${s.median >= base.median ? '+' : ''}${(((s.median - base.median) / base.median) * 100).toFixed(0)}%` : `${s.median - base.median >= 0 ? '+' : ''}${fmt(s.median - base.median)}`;
					return { text, delta: `${noise ? '~' : ''}${d}`, noise };
				})
			});
		}
	}
	const bundles = result.labels.map((l) => result.bundle?.[l]);
	if (bundles.some(Boolean))
		for (const [kind, key, label] of [['js', 'gzipKb', 'js gzip KB'], ['js', 'kb', 'js KB'], ['css', 'gzipKb', 'css gzip KB'], ['css', 'kb', 'css KB']]) {
			const base = bundles[0]?.[kind][key];
			rows.push({
				probe: 'bundle',
				metric: label,
				cells: bundles.map((b, i) => {
					const v = b?.[kind][key];
					if (v === undefined) return { text: '–' };
					return { text: fmt(v), delta: i && base ? `${v >= base ? '+' : ''}${(((v - base) / base) * 100).toFixed(1)}%` : undefined };
				})
			});
		}
	return rows;
}

/** The perf result as a plain-text table. */
export function formatPerf(result) {
	const rows = perfRows(result);
	const head = ['probe', 'metric', ...result.labels];
	const body = rows.map((r) => [r.probe, r.metric, ...r.cells.map((c) => (c.delta ? `${c.text} ${c.delta}` : c.text))]);
	const widths = head.map((_, i) => Math.max(...[head, ...body].map((r) => String(r[i]).length)));
	const line = (r) => r.map((c, i) => String(c).padEnd(widths[i])).join('  ').trimEnd();
	return [
		`${result.runs} interleaved runs, ${result.cpu}x CPU throttle; median [min-max], Δ vs ${result.labels[0]} (~ = within the spread)`,
		`load average ${result.loadavg.start.map((n) => n.toFixed(1)).join(' ')} -> ${result.loadavg.end.map((n) => n.toFixed(1)).join(' ')}`,
		line(head),
		...body.map(line)
	].join('\n');
}

/**
 * CPU-profiles page load on each URL (interleaved, `runs` each) and aggregates self time by function name
 * (chunk hashes differ between builds, so names, not files, line up).
 */
export async function runProfile({ browser, urls, runs = 6, cpu = 4, path = '/__preview', log = console.log }) {
	const totals = urls.map(() => new Map());
	for (let run = 0; run < runs; run++) {
		const order = urls.map((_, i) => (i + run) % urls.length);
		for (const i of order) {
			const context = await browser.newContext({ viewport: DESKTOP, colorScheme: 'dark' });
			try {
				const page = await context.newPage();
				const cdp = await context.newCDPSession(page);
				await cdp.send('Network.enable');
				await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
				await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });
				await cdp.send('Profiler.enable');
				await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
				await cdp.send('Profiler.start');
				await page.goto(new URL(path, urls[i].endsWith('/') ? urls[i] : `${urls[i]}/`).href);
				await page.waitForSelector(READY, { timeout: 30000 });
				await page.waitForTimeout(1200);
				const { profile } = await cdp.send('Profiler.stop');
				const byId = new Map(profile.nodes.map((n) => [n.id, n]));
				profile.samples.forEach((id, k) => {
					const name = byId.get(id).callFrame.functionName || '(anonymous)';
					totals[i].set(name, (totals[i].get(name) ?? 0) + (profile.timeDeltas[k] ?? 0) / 1000 / runs);
				});
			} finally {
				await context.close().catch(() => {});
			}
		}
		log(`profile run ${run + 1}/${runs} done`);
	}
	return totals;
}

/** The biggest per-function changes between the first URL's profile and each other's. */
export function formatProfile(urls, totals, top = 18) {
	const sum = (m) => [...m.values()].reduce((s, v) => s + v, 0);
	const out = [`sampled ms per load: ${urls.map((u, i) => `${u} ${sum(totals[i]).toFixed(0)}`).join(', ')}`];
	for (let i = 1; i < urls.length; i++) {
		const keys = new Set([...totals[0].keys(), ...totals[i].keys()]);
		const rows = [...keys].map((k) => [k, totals[0].get(k) ?? 0, totals[i].get(k) ?? 0]).map(([k, a, b]) => [k, a, b, b - a]).sort((p, q) => q[3] - p[3]);
		const line = (r) => `${String(r[0]).slice(0, 48).padEnd(48)} ${r[1].toFixed(1).padStart(8)} ${r[2].toFixed(1).padStart(8)} ${((r[3] >= 0 ? '+' : '') + r[3].toFixed(1)).padStart(8)}`;
		out.push(`\n${urls[0]} -> ${urls[i]}`, 'top increases (ms self time):', ...rows.slice(0, top).map(line), 'top decreases:', ...rows.slice(-Math.ceil(top / 3)).reverse().map(line));
	}
	return out.join('\n');
}
