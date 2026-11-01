#!/usr/bin/env node
/**
 * Visual and performance QA against the in-memory /__preview route. `npm run qa -- help` lists the
 * commands; scripts/qa/README.md explains the workflow and how to add a suite.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { ab } from './lib/ab.js';
import { int, list, parseArgs } from './lib/args.js';
import { compareBudget, countsOf, formatBudget, formatSamples, readBudget, samplesOf, shardOf, writeBudget } from './lib/budget.js';
import { launch } from './lib/browser.js';
import { compareDirs, diffDirs, formatDiff, summarize } from './lib/images.js';
import { extractInteropContract, interopDir } from './lib/interop-contract.js';
import { formatPerf, formatProfile, runPerf, runProfile, selectProbes } from './lib/perf.js';
import { writeReport } from './lib/report.js';
import { serveDir } from './lib/serve.js';
import { renderSheet } from './lib/sheet.js';
import { cleanShots, shoot } from './lib/shoot.js';
import { qaDir, repoRoot, stamp } from './lib/snapshot.js';
import { expand, loadSuite, suiteNames } from './lib/suites.js';

const HELP = `npm run qa -- <command> [options]

  ab --base <ref>        Build <ref> and the working tree (or --head <ref>) in snapshots under .qa/snap,
                         serve both, shoot the suites on both, diff, crop, recheck changes, and write
                         .qa/runs/<time>/index.html.
                         [--suite main,stress,edge] [--filter s] [--perf [--runs 5] [--cpu 4] [--only p]]
                         [--jobs 2] [--retries 1] [--no-recheck] [--rebuild] [--install] [--keep] [--out dir]
  shoot --url <url>      Screenshot suites against a served build.
                         [--suite main] [--out .qa/shots] [--filter s] [--jobs 2] [--retries 1] [--clean]
  diff <before> <after>  Pixel-diff two shot directories; writes diff PNGs; exits 1 on any difference.
                         [--out <after>-diff] [--filter s]
  compare <before> <after> --out <dir>
                         Diff, plus before|after crops of each changed shot and <dir>/index.html.
  perf --url A --url B   Load and interaction metrics, strictly interleaved; medians and spread.
                         [--label a --label b] [--runs 5] [--cpu 4] [--suite main] [--only load,type-composer]
                         [--build dirA --build dirB] [--out file.json]
  budget --build <dir>   Check a preview build's counts (layouts, style recalcs, DOM nodes, requests,
                         bytes) per perf probe against scripts/qa/perf-budget.json; exits 1 when one is
                         over. --update rewrites the baseline. [--runs 3] [--cpu 4] [--only p] [--shard i/n]
                         [--out file.json]: every run's counts, to diff between machines.
                         Prototype: --calls also counts JS function calls per probe (V8 precise coverage);
                         --clock virtual times the windows in Chromium's virtual time (no throttle: --cpu 1);
                         --clock fake in Playwright's fake clock, stepped, settling after each step.
                         Either prints the counts and their spread instead of checking them.
  prof --url A --url B   CPU-profile page load; biggest per-function changes. [--runs 6] [--cpu 4]
  sheet <spec.json>      Render hand-picked before/after panels (title, note, crop box, scale) to a PNG.
                         [--out <spec>.png]
  serve <build dir>      Serve a build on a port (default: a free one). [--port n]
  contract               Read what apron-server-go's interop suite relies on (test ids, accessible names,
                         selectors) from its specs into e2e/interop-contract.json, for e2e/contract.spec.ts.
                         [--from <apron-server-go>/tests/interop, or APRON_INTEROP_DIR] [--check]
  suites                 List suites, their scenes and job counts (a job shoots one or more PNGs).
  clean                  Remove .qa/snap (cached builds); --all removes all of .qa.

Filters match any part of a shot id, <scene>--<viewport>--<theme>; commas give several.
Chromium: QA_CHROMIUM, else playwright-core's build under PLAYWRIGHT_BROWSERS_PATH.`;

const BOOLEAN = ['perf', 'recheck', 'rebuild', 'install', 'keep', 'clean', 'all', 'help', 'check', 'update', 'calls'];
const MULTI = ['url', 'label', 'build', 'suite', 'filter', 'only'];

async function main() {
	const [command, ...rest] = process.argv.slice(2);
	const o = parseArgs(rest, { boolean: BOOLEAN, multi: MULTI });
	const repo = repoRoot();
	const filters = list(o.filter);
	switch (command) {
		case 'ab': {
			if (!o.base) throw new Error('ab needs --base <git ref>');
			const r = await ab(repo, {
				base: o.base,
				head: o.head,
				suites: list(o.suite),
				filters,
				perf: !!o.perf,
				runs: int(o.runs, 5),
				cpu: int(o.cpu, 4),
				only: list(o.only),
				jobs: int(o.jobs, 2),
				retries: int(o.retries, 1),
				recheck: o.recheck !== false,
				rebuild: !!o.rebuild,
				install: !!o.install,
				keep: !!o.keep,
				out: o.out && resolve(o.out)
			});
			return r.failed ? 1 : 0;
		}
		case 'shoot': {
			if (!o.url?.length) throw new Error('shoot needs --url <served build>');
			const names = list(o.suite).length ? list(o.suite) : ['main'];
			const root = resolve(o.out ?? join(qaDir(repo), 'shots'));
			const browser = await launch();
			let failed = 0;
			try {
				for (const name of names) {
					const suite = await loadSuite(name);
					const out = o.out && names.length === 1 ? root : join(root, suite.name);
					if (o.clean) cleanShots(out);
					console.log(`${suite.name} → ${relative(process.cwd(), out) || '.'}`);
					const results = await shoot({ suite, targets: [{ name: 'shot', url: o.url[0], out }], browser, filters, jobs: int(o.jobs, 2), retries: int(o.retries, 1) });
					const bad = results.shot.filter((r) => !r.ok);
					failed += bad.length;
					console.log(`${suite.name}: ${results.shot.length - bad.length}/${results.shot.length} jobs ok`);
					for (const r of bad) console.log(`  FAIL ${r.id}: ${r.error}`);
					for (const r of results.shot.filter((r) => r.errors.length)) console.log(`  console errors in ${r.id}: ${r.errors.slice(0, 2).join(' / ')}`);
				}
			} finally {
				await browser.close();
			}
			return failed ? 1 : 0;
		}
		case 'diff': {
			const [before, after] = o._;
			if (!before || !after) throw new Error('diff needs <before dir> <after dir>');
			const rows = diffDirs(before, after, { diffDir: o.out ?? `${after.replace(/[/\\]+$/, '')}-diff`, filters });
			console.log(formatDiff(rows));
			return summarize(rows).same === rows.length ? 0 : 1;
		}
		case 'compare': {
			const [before, after] = o._;
			if (!before || !after || !o.out) throw new Error('compare needs <before dir> <after dir> --out <dir>');
			const out = resolve(o.out);
			const rows = compareDirs(resolve(before), resolve(after), out, { filters });
			const report = writeReport(join(out, 'index.html'), {
				title: o.title ?? `QA compare: ${before} → ${after}`,
				meta: [['Before', resolve(before)], ['After', resolve(after)], ...(filters.length ? [['Filter', filters.join(', ')]] : [])],
				sections: [{ name: 'shots', beforeDir: resolve(before), afterDir: resolve(after), compareDir: out, rows }]
			});
			console.log(formatDiff(rows));
			console.log(`report: ${relative(process.cwd(), report)}`);
			return 0;
		}
		case 'perf': {
			const urls = o.url ?? [];
			if (!urls.length) throw new Error('perf needs --url (twice or more to compare)');
			const labels = o.label?.length === urls.length ? o.label : urls.map((u) => u.replace(/^https?:\/\//, ''));
			const suite = await loadSuite(list(o.suite)[0] ?? 'main');
			const probes = selectProbes(suite, list(o.only));
			const browser = await launch();
			let result;
			try {
				result = await runPerf({ browser, urls, labels, runs: int(o.runs, 5), cpu: int(o.cpu, 4), probes, path: suite.path, builds: o.build ?? [], calls: !!o.calls });
			} finally {
				await browser.close();
			}
			const out = resolve(o.out ?? join(qaDir(repo), 'perf', `${stamp()}.json`));
			mkdirSync(dirname(out), { recursive: true });
			writeFileSync(out, JSON.stringify(result, null, 1));
			console.log(formatPerf(result));
			console.log(`json: ${relative(process.cwd(), out)}`);
			return 0;
		}
		case 'budget': {
			const dir = o.build?.[0] ?? 'build';
			if (!existsSync(join(dir, '__preview.html'))) throw new Error(`budget needs a preview build: no ${join(dir, '__preview.html')} (APRON_PREVIEW=1 npm run build)`);
			const suite = await loadSuite('main');
			// `--shard 2/3`: this machine's share of the probes, checked against the same baseline; the first also
			// checks the bundle's size.
			const [index, count] = o.shard ? String(o.shard).split('/').map(Number) : [1, 1];
			if (!(Number.isInteger(index) && Number.isInteger(count) && index >= 1 && index <= count)) throw new Error(`--shard takes <index>/<count>, e.g. 2/3, not ${o.shard}`);
			if (count > 1 && o.update) throw new Error('--update rewrites the whole baseline: run it without --shard');
			const probes = shardOf(selectProbes(suite, list(o.only)).filter((p) => p.budget !== false), index, count);
			if (!probes.length) throw new Error(`shard ${index}/${count} has no probes to check`);
			const runs = int(o.runs, 3);
			const clock = o.clock ?? 'wall';
			if (!['wall', 'virtual', 'fake'].includes(clock)) throw new Error(`--clock takes wall, virtual or fake, not ${clock}`);
			const cpu = int(o.cpu, clock === 'virtual' ? 1 : 4);
			// The prototypes' counts have no baseline yet: they are printed (and written with --out), not checked.
			const prototype = !!o.calls || clock !== 'wall';
			if (prototype && o.update) throw new Error('--update writes the baseline from the default measurement: run it without --calls or --clock');
			const server = await serveDir(dir);
			const browser = await launch();
			let result;
			const started = Date.now();
			try {
				// Under reduced motion, so an animation's layouts don't count once per frame drawn: a faster runner
				// draws more frames, and the count would go with it.
				result = await runPerf({ browser, urls: [server.url], labels: ['now'], runs, cpu, reducedMotion: 'reduce', probes, path: suite.path, builds: index === 1 ? [dir] : [], chunkBuilds: [dir], calls: !!o.calls, clock });
			} finally {
				await browser.close();
				await server.close();
			}
			const path = join(repo, 'scripts/qa/perf-budget.json');
			const counts = countsOf(result, probes);
			if (prototype || o.out) console.log(`${formatSamples(samplesOf(result, probes))}\n`);
			if (o.out) {
				const out = resolve(o.out);
				mkdirSync(dirname(out), { recursive: true });
				const meta = { calls: !!o.calls, clock, runs, cpu, shard: `${index}/${count}`, seconds: Math.round((Date.now() - started) / 1000), chromium: browser.version(), cpus: cpus().length, cpuModel: cpus()[0]?.model, loadavg: result.loadavg };
				writeFileSync(out, `${JSON.stringify({ ...meta, probes: samplesOf(result, probes), bundle: counts.bundle }, null, 1)}\n`);
				console.log(`json: ${relative(process.cwd(), out)}`);
			}
			if (prototype) return 0;
			if (o.update) {
				writeBudget(path, counts, { runs, cpu });
				console.log(`wrote ${relative(process.cwd(), path)}`);
				return 0;
			}
			const rows = compareBudget(counts, readBudget(path));
			console.log(formatBudget(rows));
			const over = rows.filter((r) => r.status === 'over');
			if (over.length) console.log(`\n${over.length} over budget. If that cost is meant, run \`npm run qa -- budget --update\` and commit scripts/qa/perf-budget.json with the change.`);
			else if (rows.some((r) => r.status === 'under')) console.log('\nSome counts are well under budget: `npm run qa -- budget --update` locks the gain in.');
			return over.length ? 1 : 0;
		}
		case 'prof': {
			const urls = o.url ?? [];
			if (urls.length < 2) throw new Error('prof needs two --url');
			const browser = await launch();
			try {
				const totals = await runProfile({ browser, urls, runs: int(o.runs, 6), cpu: int(o.cpu, 4) });
				console.log(formatProfile(urls, totals));
			} finally {
				await browser.close();
			}
			return 0;
		}
		case 'sheet': {
			const [spec] = o._;
			if (!spec) throw new Error('sheet needs a spec file (see scripts/qa/README.md)');
			const out = resolve(o.out ?? spec.replace(/\.json$/, '') + '.png');
			const browser = await launch();
			try {
				await renderSheet(browser, spec, out);
			} finally {
				await browser.close();
			}
			console.log(`sheet: ${relative(process.cwd(), out)}`);
			return 0;
		}
		case 'serve': {
			const [dir] = o._;
			if (!dir) throw new Error('serve needs a build directory');
			const s = await serveDir(dir, { port: int(o.port, 0) });
			console.log(`serving ${dir} at ${s.url}/__preview (Ctrl-C stops)`);
			await new Promise(() => {});
			return 0;
		}
		case 'contract': {
			const dir = interopDir(repo, o.from);
			if (!dir) throw new Error('no interop suite found: pass --from <apron-server-go>/tests/interop or set APRON_INTEROP_DIR');
			const out = join(repo, 'e2e', 'interop-contract.json');
			const text = `${JSON.stringify({ from: 'apron-server-go/tests/interop', ...extractInteropContract(dir) }, null, '\t')}\n`;
			const counts = (c) => `${Object.keys(c.testIds).length} test ids, ${Object.keys(c.names).length} names, ${Object.keys(c.selectors).length} selectors`;
			if (o.check) {
				const same = existsSync(out) && readFileSync(out, 'utf8') === text;
				console.log(same ? `${relative(process.cwd(), out)} is current with ${dir}` : `${relative(process.cwd(), out)} is stale: run \`npm run qa -- contract --from ${dir}\``);
				return same ? 0 : 1;
			}
			writeFileSync(out, text);
			console.log(`${relative(process.cwd(), out)}: ${counts(JSON.parse(text))}, from ${dir}`);
			return 0;
		}
		case 'suites': {
			for (const name of suiteNames()) {
				const suite = await loadSuite(name);
				console.log(`${name}: ${expand(suite).length} jobs — ${suite.scenes.length} scenes × ${Object.keys(suite.viewports).join('/')} × ${suite.themes.join('/')}${suite.interactions.length ? `; perf probes: ${suite.interactions.map((p) => p.name).join(', ')}` : ''}`);
				if (suite.description) console.log(`  ${suite.description}`);
			}
			return 0;
		}
		case 'clean': {
			const target = o.all ? qaDir(repo) : join(qaDir(repo), 'snap');
			if (existsSync(target)) rmSync(target, { recursive: true, force: true });
			console.log(`removed ${relative(process.cwd(), target)}`);
			return 0;
		}
		case undefined:
		case 'help':
		case '--help':
		case '-h':
			console.log(HELP);
			return 0;
		default:
			console.error(`unknown command ${command}\n\n${HELP}`);
			return 2;
	}
}

main().then(
	(code) => process.exit(code),
	(e) => {
		console.error(`qa: ${e instanceof Error ? e.message : e}`);
		if (process.env.QA_DEBUG) console.error(e);
		process.exit(1);
	}
);
