import { writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { launch } from './browser.js';
import { compareDirs, diffDirs, summarize } from './images.js';
import { formatPerf, runPerf, selectProbes } from './perf.js';
import { writeReport } from './report.js';
import { serveDir } from './serve.js';
import { shoot } from './shoot.js';
import { loadSuite } from './suites.js';
import { qaDir, removeSnapshot, snapshotRef, snapshotWorktree, stamp } from './snapshot.js';

/**
 * The redesign workflow: build `base` and the working tree (or `head`) in their own snapshots, serve both,
 * shoot each suite on both (interleaved), diff and crop, recheck what changed or failed, optionally
 * measure perf, and write one report. Servers, the browser and temporary snapshots are always cleaned up.
 */
export async function ab(repo, o) {
	const log = o.log ?? console.log;
	const suites = await Promise.all((o.suites.length ? o.suites : ['main']).map(loadSuite));
	const runDir = o.out ?? join(qaDir(repo), 'runs', `${stamp()}-${o.base.replace(/[^\w.-]+/g, '_')}`);
	const cleanup = [];
	const done = async () => {
		while (cleanup.length) await cleanup.pop()().catch((/** @type {Error} */ e) => log(`cleanup: ${e.message}`));
	};
	const onSignal = () => {
		log('interrupted; cleaning up');
		done().finally(() => process.exit(130));
	};
	process.once('SIGINT', onSignal);
	process.once('SIGTERM', onSignal);
	try {
		const before = await snapshotRef(repo, o.base, { rebuild: o.rebuild, install: o.install, log });
		const after = o.head ? await snapshotRef(repo, o.head, { rebuild: o.rebuild, install: o.install, log }) : await snapshotWorktree(repo, { install: o.install, log });
		if (after.temporary && !o.keep) cleanup.push(async () => removeSnapshot(after));
		const [a, b] = [await serveDir(before.build), await serveDir(after.build)];
		cleanup.push(a.close, b.close);
		log(`serving before ${a.url} (${before.label}), after ${b.url} (${after.label})`);
		const browser = await launch();
		cleanup.push(() => browser.close());

		const sections = [];
		const lines = [];
		for (const suite of suites) {
			const dir = join(runDir, suite.name);
			const targets = [
				{ name: 'before', url: a.url, out: join(dir, 'before') },
				{ name: 'after', url: b.url, out: join(dir, 'after') }
			];
			log(`\n${suite.name}: shooting ${a.url} and ${b.url}`);
			const results = await shoot({ suite, targets, browser, filters: o.filters, retries: o.retries, jobs: o.jobs, log });
			let rows = compareDirs(targets[0].out, targets[1].out, join(dir, 'compare'), { filters: o.filters });
			const failures = targets.flatMap((t) => results[t.name].filter((r) => !r.ok).map((r) => ({ target: t.name, id: r.id, error: r.error ?? '' })));

			// Recheck: shoot what changed or failed again on both sides; a difference that doesn't repeat is a flake.
			const flaky = [];
			const owner = jobOwners(results);
			const suspects = new Set([
				...rows.filter((r) => r.status !== 'same').map((r) => owner.get(r.file) ?? r.file.replace(/\.png$/, '')),
				...failures.map((f) => f.id)
			]);
			if (o.recheck && suspects.size) {
				log(`${suite.name}: rechecking ${suspects.size} job(s)`);
				const again = [
					{ name: 'before', url: a.url, out: join(dir, 'recheck', 'before') },
					{ name: 'after', url: b.url, out: join(dir, 'recheck', 'after') }
				];
				const rerun = await shoot({ suite, targets: again, browser, only: suspects, retries: o.retries, jobs: o.jobs, log });
				const second = diffDirs(again[0].out, again[1].out);
				const secondByFile = new Map(second.map((r) => [r.file, r]));
				const okAgain = new Map(again.map((t) => [t.name, new Set(rerun[t.name].filter((r) => r.ok).map((r) => r.id))]));
				for (const r of rows)
					if (r.status !== 'same' && secondByFile.get(r.file)?.status === 'same') {
						flaky.push(r.file);
						r.status = 'same';
						r.flaky = true;
					}
				// A failure that passes on the recheck on that side isn't a failure.
				for (let i = failures.length - 1; i >= 0; i--) if (okAgain.get(failures[i].target)?.has(failures[i].id)) failures.splice(i, 1);
			}
			const s = summarize(rows);
			const changed = rows.filter((r) => r.status !== 'same');
			lines.push(`${suite.name}: ${s.line}${changed.length ? `, ${changed.length} differ` : ''}${failures.length ? `, ${failures.length} failed` : ''}${flaky.length ? `, ${flaky.length} flaky (identical on recheck)` : ''}`);
			for (const r of changed) lines.push(`  ${r.status.padEnd(8)} ${r.file}${r.pixels ? `  ${r.pixels}px (${r.percent.toFixed(3)}%)` : ''}`);
			for (const f of failures) lines.push(`  FAILED   ${f.id} on ${f.target}: ${f.error}`);
			sections.push({ name: suite.name, beforeDir: targets[0].out, afterDir: targets[1].out, compareDir: join(dir, 'compare'), rows, failures, flaky });
			writeFileSync(join(dir, 'summary.json'), JSON.stringify({ ...s, failures, flaky, rows }, null, 1));
		}

		let perf;
		if (o.perf) {
			log('\nperf: interleaved runs on both builds');
			// The first suite with perf probes, else main's.
			const suite = suites.find((s) => s.interactions.length) ?? (await loadSuite('main'));
			const probes = selectProbes(suite, o.only);
			perf = await runPerf({ browser, urls: [a.url, b.url], labels: ['before', 'after'], runs: o.runs, cpu: o.cpu, probes, path: suite.path, builds: [before.build, after.build], log });
			writeFileSync(join(runDir, 'perf.json'), JSON.stringify(perf, null, 1));
			lines.push('', formatPerf(perf));
		}

		const report = writeReport(join(runDir, 'index.html'), {
			title: `QA: ${before.label} → ${after.label}`,
			meta: [
				['Before', `${before.label} — ${a.url}`],
				['After', `${after.label} — ${b.url}`],
				['Suites', suites.map((s) => s.name).join(', ')],
				...(o.filters.length ? [['Filter', o.filters.join(', ')]] : []),
				['Run', new Date().toISOString()]
			],
			sections,
			perf
		});
		log(`\n${lines.join('\n')}\n\nreport: ${relative(process.cwd(), report) || report}`);
		return { runDir, report, sections, perf, failed: sections.some((s) => s.failures.length) };
	} finally {
		await done();
		process.off('SIGINT', onSignal);
		process.off('SIGTERM', onSignal);
	}
}

/** Maps every screenshot file to the job that took it (extras are `<job>--<suffix>.png`). */
function jobOwners(results) {
	const map = new Map();
	for (const list of Object.values(results)) for (const r of list) for (const f of r.files) map.set(f, r.id);
	return map;
}
