import { loadavg } from 'node:os';

const READY = '[data-testid=message-list] .ap-msg';

/** Networks to emulate: Chrome DevTools' presets' latency and download rate (Mbit/s). */
export const NETWORKS = {
	none: undefined,
	'4g': { latency: 150, down: 9 },
	'3g': { latency: 562.5, down: 1.44 }
};

/** Screens to load on: a laptop, and a phone (which hides the member list and, with a room open, the sidebar). */
export const DEVICES = {
	desktop: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 },
	phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true }
};

/** The preview's busy account, as the `-busy` perf probes load it (scripts/qa/suites/main.js). */
export const BUSY = { manyRooms: 40, filler: { general: 1500 } };

/**
 * How long the preview takes to show its first messages, for several URLs, strictly interleaved (AB, BA, …), with
 * the CPU and network throttled: in wall time, so read the spread, and compare builds rather than trust one number.
 *
 * `visit`: `repeat` loads the page once unthrottled so its service worker installs and caches the app, then
 * measures a second load in the same profile, as most visits to an installed app are (nothing but the server's
 * data crosses the network); `first` blocks the service worker and starts from an empty cache.
 * `rttMs` plays a server round trip in the preview's in-memory socket (`PreviewKnobs.rttMs`), so the load's waits on
 * the server count; without it the server answers at once, which no real one does.
 *
 * Reports `ready` (the first message in the DOM: the `apron:first-messages` mark), first contentful paint, each
 * `apron:*` startup mark (`$lib/startup-marks`), long-task time, and the main thread's script and task time.
 * `--build` serves brotli as a CDN does, but over HTTP/1.1, where a first visit's parallel requests queue six at a
 * time: first-visit times are pessimistic next to a CDN's HTTP/2.
 */
export async function runStartup({ browser, urls, labels = urls, runs = 7, cpu = 4, net = 'none', visit = 'repeat', device = 'phone', rttMs = 0, busy = false, path = '/__preview', log = console.log }) {
	if (!(net in NETWORKS)) throw new Error(`--net is one of ${Object.keys(NETWORKS).join(', ')}`);
	if (!DEVICES[device]) throw new Error(`--device is one of ${Object.keys(DEVICES).join(', ')}`);
	if (visit !== 'repeat' && visit !== 'first') throw new Error('--visit is repeat or first');
	const network = NETWORKS[net];
	const knobs = { ...(busy ? BUSY : {}), ...(rttMs ? { rttMs } : {}) };
	const samples = Object.fromEntries(labels.map((l) => [l, []]));
	const start = loadavg();
	for (let run = 0; run < runs; run++) {
		const order = urls.map((_, i) => (i + run) % urls.length);
		for (const i of order) samples[labels[i]].push(await measure(browser, new URL(path, urls[i]).href, { cpu, network, visit, device, knobs }));
		log(`startup run ${run + 1}/${runs} done`);
	}
	const name = `${visit}-${device}${net === 'none' ? '' : `-${net}`}${rttMs ? `-rtt${rttMs}` : ''}${busy ? '-busy' : ''}`;
	const probes = { [name]: Object.fromEntries(labels.map((l) => [l, { stats: stats(samples[l]), samples: samples[l] }])) };
	return { labels, runs, cpu, net, visit, device, rttMs, busy, loadavg: { start, end: loadavg() }, probes };
}

async function measure(browser, url, { cpu, network, visit, device, knobs }) {
	const context = await browser.newContext({ ...DEVICES[device], colorScheme: 'dark', serviceWorkers: visit === 'first' ? 'block' : 'allow' });
	try {
		await context.addInitScript((knobs) => {
			const w = /** @type {any} */ (window);
			if (Object.keys(knobs).length) w.__APRON_PREVIEW__ = knobs;
			w.__longtasks = [];
			new PerformanceObserver((l) => l.getEntries().forEach((e) => w.__longtasks.push({ start: e.startTime, duration: e.duration }))).observe({ type: 'longtask', buffered: true });
		}, knobs);
		if (visit === 'repeat') {
			// The first visit installs the service worker, which caches every file of the build before it activates.
			const first = await context.newPage();
			await first.goto(url);
			await first.waitForSelector(READY, { timeout: 30000 });
			await first.evaluate(async () => {
				await navigator.serviceWorker?.ready;
			});
			await first.close();
		}
		const page = await context.newPage();
		const cdp = await context.newCDPSession(page);
		await cdp.send('Performance.enable');
		await cdp.send('Network.enable');
		if (network) await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: network.latency, downloadThroughput: (network.down * 1024 * 1024) / 8 * 0.9, uploadThroughput: (0.675 * 1024 * 1024) / 8 * 0.9 });
		if (visit === 'first') await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
		await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });
		await page.goto(url, { waitUntil: 'commit' });
		await page.waitForSelector(READY, { timeout: 60000 });
		// The marks after the first messages (a paint) land a frame later.
		await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => setTimeout(done, 0))));
		const m = await page.evaluate(() => {
			const w = /** @type {any} */ (window);
			const marks = Object.fromEntries(performance.getEntriesByType('mark').filter((e) => e.name.startsWith('apron:')).map((e) => [e.name.slice(6), e.startTime]));
			const ready = marks['first-messages'];
			return {
				ready,
				fcp: performance.getEntriesByName('first-contentful-paint')[0]?.startTime,
				marks,
				longTaskMs: w.__longtasks.filter((t) => ready === undefined || t.start < ready).reduce((n, t) => n + t.duration, 0),
				fromCache: performance.getEntriesByType('resource').filter((r) => r.name.endsWith('.js')).every((r) => r.transferSize === 0),
				sw: Boolean(navigator.serviceWorker?.controller)
			};
		});
		if (visit === 'repeat' && !m.sw) throw new Error('repeat visit: no service worker controls the page (is it a preview build with its service worker?)');
		const perf = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((x) => [x.name, x.value]));
		return {
			ready: m.ready,
			fcp: m.fcp,
			...Object.fromEntries(Object.entries(m.marks).filter(([k]) => k !== 'first-messages').map(([k, v]) => [`mark:${k}`, v])),
			longTaskMs: m.longTaskMs,
			scriptMs: perf.ScriptDuration * 1000,
			taskMs: perf.TaskDuration * 1000
		};
	} finally {
		await context.close();
	}
}

/** `median [min–max]` of each metric across samples, in the shape `formatPerf` reads. */
function stats(samples) {
	const keys = [...new Set(samples.flatMap((s) => Object.keys(s)))];
	return Object.fromEntries(keys.map((k) => {
		const v = samples.map((s) => s[k]).filter((x) => typeof x === 'number').sort((a, b) => a - b);
		return [k, v.length ? { median: v[Math.floor(v.length / 2)], min: v[0], max: v[v.length - 1] } : undefined];
	}).filter(([, s]) => s));
}
