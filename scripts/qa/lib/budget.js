import { existsSync, readFileSync, writeFileSync } from 'node:fs';

/**
 * The perf budget: what loading the app and each probe costs in counts rather than time (layouts, style
 * recalcs, DOM nodes, requests, bytes), against a committed baseline. Counts barely move between runs or
 * machines, where timings swing by tens of percent, so a check on them can fail CI without flaking: a change
 * that doubles the layouts a room list costs shows on any runner. Timings stay with `qa perf` and `qa ab --perf`.
 */

/** The counted metrics, by kind of probe. A load probe has no `action`. */
const LOAD = ['requests', 'startupJsKB', 'domNodes', 'layouts', 'styleRecalcs', 'calls', 'heapMB'];
const INTERACTION = ['layouts', 'styleRecalcs', 'calls'];

/**
 * How far over its baseline a metric may go before the check fails. On the fake clock bytes, requests and DOM
 * nodes don't move, and an interaction's layouts and style recalcs barely do. The load's layouts and style
 * recalcs follow the frames the browser draws in real time, so move by a couple; JS calls move by a few from
 * events Playwright sends in real time (mouse moves), and on the load by about 0.6% when an observer callback
 * renders the jump-to-new dock or doesn't.
 */
const SLACK = {
	requests: { abs: 0, rel: 0 },
	startupJsKB: { abs: 1, rel: 0.01 },
	jsGzipKB: { abs: 1, rel: 0.01 },
	cssGzipKB: { abs: 0.5, rel: 0.01 },
	domNodes: { abs: 2, rel: 0.01 },
	layouts: { abs: 3, rel: 0.15 },
	styleRecalcs: { abs: 3, rel: 0.15 },
	calls: { abs: 20, rel: 0.01 },
	heapMB: { abs: 0.2, rel: 0.05 }
};
/** An interaction's, where they differ from the load's. */
const INTERACTION_SLACK = { layouts: { abs: 1, rel: 0 }, styleRecalcs: { abs: 1, rel: 0 }, calls: { abs: 20, rel: 0.005 } };

/** The highest value `metric` may reach against a baseline of `base`, on the load or an interaction. */
export const limitOf = (metric, base, interaction = false) => {
	const slack = (interaction && INTERACTION_SLACK[metric]) || SLACK[metric];
	return base + Math.max(slack.abs, base * slack.rel);
};

/**
 * Shard `index` of `count` (from 1) of the probes, for checking the budget on several machines at once: each
 * probe on one, the busy ones (`knobs`, a slow load) spread out first. The same split on every machine.
 */
export function shardOf(probes, index, count) {
	const cost = (p) => (p.knobs ? 3 : 1);
	const load = Array(count).fill(0);
	const shard = new Map();
	for (const p of [...probes].sort((a, b) => cost(b) - cost(a))) {
		const lightest = load.indexOf(Math.min(...load));
		load[lightest] += cost(p);
		shard.set(p, lightest + 1);
	}
	return probes.filter((p) => shard.get(p) === index);
}

/** A perf result (one URL) reduced to the budget's shape: each probe's counted metrics (medians), and bundle sizes. */
export function countsOf(result, probes) {
	const label = result.labels[0];
	const counts = { probes: {}, bundle: {} };
	for (const probe of probes) {
		const stats = result.probes[probe.name][label].stats;
		counts.probes[probe.name] = Object.fromEntries((probe.action ? INTERACTION : LOAD).map((m) => [m, round(stats[m].median)]));
	}
	const bundle = result.bundle?.[label];
	if (bundle) counts.bundle = { jsGzipKB: round(bundle.js.gzipKb), cssGzipKB: round(bundle.css.gzipKb) };
	return counts;
}

const round = (x) => Math.round(x * 10) / 10;

/**
 * Every run's counts per probe, with their medians and spread, to diff between machines (`qa budget --out`):
 * the budget's metrics, plus `calls` and `chunks` (calls by chunk) when they were counted. Timings are left out.
 */
export function samplesOf(result, probes) {
	const label = result.labels[0];
	const probesOut = {};
	for (const probe of probes) {
		const { samples, stats } = result.probes[probe.name][label];
		const metrics = (probe.action ? INTERACTION : LOAD).filter((m) => m in samples[0]);
		probesOut[probe.name] = Object.fromEntries(metrics.map((m) => [m, { median: round(stats[m].median), min: round(stats[m].min), max: round(stats[m].max), runs: samples.map((s) => round(s[m])) }]));
		if (samples[0].chunks) {
			const names = [...new Set(samples.flatMap((s) => Object.keys(s.chunks)))].sort();
			probesOut[probe.name].chunks = Object.fromEntries(names.map((n) => [n, samples.map((s) => s.chunks[n] ?? 0)]));
		}
	}
	return probesOut;
}

/**
 * Two `qa budget --out` files side by side (say, this machine's and a CI runner's): per probe and metric each
 * side's `median [min–max]`, and whether every run on both sides counted the same. Chunks whose calls differ are
 * listed under their probe. Only the probes both measured are compared (a shard holds a third of them).
 */
export function diffSamples(a, b) {
	const cell = (s) => (s ? `${s.median}${s.min === s.max ? '' : ` [${s.min}–${s.max}]`}` : '–');
	const rows = [];
	let same = 0;
	const shared = Object.keys(a.probes).filter((p) => p in b.probes);
	for (const probe of shared) {
		const pa = a.probes[probe] ?? {};
		const pb = b.probes[probe] ?? {};
		for (const metric of [...new Set([...Object.keys(pa), ...Object.keys(pb)])].filter((m) => m !== 'chunks')) {
			const runs = [...(pa[metric]?.runs ?? []), ...(pb[metric]?.runs ?? [])];
			const identical = !!pa[metric] && !!pb[metric] && new Set(runs).size === 1;
			if (identical) same++;
			rows.push([probe, metric, cell(pa[metric]), cell(pb[metric]), identical ? '' : pa[metric] && pb[metric] ? `${round(pb[metric].median - pa[metric].median)}` : 'missing']);
		}
		for (const chunk of [...new Set([...Object.keys(pa.chunks ?? {}), ...Object.keys(pb.chunks ?? {})])]) {
			const ca = pa.chunks?.[chunk] ?? [0];
			const cb = pb.chunks?.[chunk] ?? [0];
			if (new Set([...ca, ...cb]).size > 1) rows.push([probe, `  calls in ${chunk}`, ca.join(' '), cb.join(' '), '']);
		}
	}
	const head = ['probe', 'metric', 'a', 'b', 'b − a'];
	const widths = head.map((_, i) => Math.max(...[head, ...rows].map((r) => r[i].length)));
	const line = (r) => r.map((c, i) => c.padEnd(widths[i])).join('  ').trimEnd();
	const counted = rows.filter((r) => !r[1].startsWith(' ')).length;
	const unshared = [...Object.keys(a.probes), ...Object.keys(b.probes)].filter((p) => !shared.includes(p));
	const summary = `${same}/${counted} counts the same in every run on both sides${unshared.length ? `; not in both: ${[...new Set(unshared)].join(', ')}` : ''}`;
	return { same, total: counted, text: [line(head), ...rows.map(line), '', summary].join('\n') };
}

/** Per probe and metric, `median [min–max]` over the runs, marking with `*` any metric that varied between them. */
export function formatSamples(probes) {
	const metrics = [...new Set(Object.values(probes).flatMap((p) => Object.keys(p).filter((k) => k !== 'chunks')))];
	const cell = (s) => (s ? `${s.median}${s.min === s.max ? '' : ` [${s.min}–${s.max}]*`}` : '');
	const body = Object.entries(probes).map(([name, p]) => [name, ...metrics.map((m) => cell(p[m]))]);
	const head = ['probe', ...metrics];
	const widths = head.map((_, i) => Math.max(...[head, ...body].map((r) => r[i].length)));
	const line = (r) => r.map((c, i) => c.padEnd(widths[i])).join('  ').trimEnd();
	return [line(head), ...body.map(line)].join('\n');
}

/**
 * Each metric of `counts` against `budget`: `over` past its slack, `under` well below it (worth locking in
 * with `--update`), else `ok`. Metrics missing from the baseline are `new`.
 */
export function compareBudget(counts, budget) {
	const rows = [];
	const add = (probe, metric, value, base, interaction = false) => {
		if (base === undefined) return rows.push({ probe, metric, value, status: 'new' });
		const limit = limitOf(metric, base, interaction);
		const status = value > limit ? 'over' : value < base - (limit - base) ? 'under' : 'ok';
		rows.push({ probe, metric, value, base, limit, status });
	};
	for (const [probe, metrics] of Object.entries(counts.probes))
		for (const [metric, value] of Object.entries(metrics)) add(probe, metric, value, budget.probes?.[probe]?.[metric], Object.keys(metrics).every((m) => INTERACTION.includes(m)));
	for (const [metric, value] of Object.entries(counts.bundle)) add('bundle', metric, value, budget.bundle?.[metric]);
	return rows;
}

/** The comparison as a plain-text table, worst first. */
export function formatBudget(rows) {
	const order = { over: 0, new: 1, under: 2, ok: 3 };
	const sorted = [...rows].sort((a, b) => order[a.status] - order[b.status]);
	const body = sorted.map((r) => [r.probe, r.metric, String(r.value), r.base === undefined ? '–' : String(r.base), r.limit === undefined ? '–' : String(round(r.limit)), r.status === 'ok' ? '' : r.status.toUpperCase()]);
	const head = ['probe', 'metric', 'now', 'baseline', 'limit', ''];
	const widths = head.map((_, i) => Math.max(...[head, ...body].map((r) => r[i].length)));
	const line = (r) => r.map((c, i) => c.padEnd(widths[i])).join('  ').trimEnd();
	return [line(head), ...body.map(line)].join('\n');
}

export function readBudget(path) {
	return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : { probes: {}, bundle: {} };
}

export function writeBudget(path, counts, { runs, cpu, chromium }) {
	const budget = {
		$comment: 'Perf budget: medians of counts, not timings. `npm run qa -- budget` checks a build against it; `--update` rewrites it. See scripts/qa/README.md.',
		runs,
		cpu,
		chromium,
		...counts
	};
	writeFileSync(path, `${JSON.stringify(budget, null, '\t')}\n`);
}
