import { existsSync, readFileSync, writeFileSync } from 'node:fs';

/**
 * The perf budget: what loading the app and each probe costs in counts rather than time (layouts, style
 * recalcs, DOM nodes, requests, bytes), against a committed baseline. Counts barely move between runs or
 * machines, where timings swing by tens of percent, so a check on them can fail CI without flaking: a change
 * that doubles the layouts a room list costs shows on any runner. Timings stay with `qa perf` and `qa ab --perf`.
 */

/** The counted metrics, by kind of probe. A load probe has no `action`. */
const LOAD = ['requests', 'startupJsKB', 'domNodes', 'layouts', 'styleRecalcs', 'heapMB'];
const INTERACTION = ['layouts', 'styleRecalcs'];

/**
 * How far over its baseline a metric may go before the check fails: bytes and requests hardly move, counts
 * of layouts and style recalcs move by a few with timing, and the heap by a little.
 */
const SLACK = {
	requests: { abs: 0, rel: 0 },
	startupJsKB: { abs: 1, rel: 0.01 },
	jsGzipKB: { abs: 1, rel: 0.01 },
	cssGzipKB: { abs: 0.5, rel: 0.01 },
	domNodes: { abs: 2, rel: 0.01 },
	layouts: { abs: 3, rel: 0.15 },
	styleRecalcs: { abs: 3, rel: 0.15 },
	heapMB: { abs: 0.2, rel: 0.05 }
};

/** The highest value `metric` may reach against a baseline of `base`. */
export const limitOf = (metric, base) => base + Math.max(SLACK[metric].abs, base * SLACK[metric].rel);

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
 * Each metric of `counts` against `budget`: `over` past its slack, `under` well below it (worth locking in
 * with `--update`), else `ok`. Metrics missing from the baseline are `new`.
 */
export function compareBudget(counts, budget) {
	const rows = [];
	const add = (probe, metric, value, base) => {
		if (base === undefined) return rows.push({ probe, metric, value, status: 'new' });
		const limit = limitOf(metric, base);
		const status = value > limit ? 'over' : value < base - (limit - base) ? 'under' : 'ok';
		rows.push({ probe, metric, value, base, limit, status });
	};
	for (const [probe, metrics] of Object.entries(counts.probes))
		for (const [metric, value] of Object.entries(metrics)) add(probe, metric, value, budget.probes?.[probe]?.[metric]);
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

export function writeBudget(path, counts, { runs, cpu }) {
	const budget = {
		$comment: 'Perf budget: medians of counts, not timings. `npm run qa -- budget` checks a build against it; `--update` rewrites it. See scripts/qa/README.md.',
		runs,
		cpu,
		...counts
	};
	writeFileSync(path, `${JSON.stringify(budget, null, '\t')}\n`);
}
