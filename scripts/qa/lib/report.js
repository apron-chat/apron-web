import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { summarize } from './images.js';
import { perfRows } from './perf.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/**
 * Writes a static HTML report: per section (suite), the changed shots with their before|after crops and
 * links to the full screenshots and diff, then failures, rechecked flakes and the identical list; and an
 * optional perf table. Image paths are relative, so the report opens from disk.
 *
 * @param {string} file
 * @param {{ title: string, meta?: [string, string][], sections: Section[], perf?: any }} report
 *
 * @typedef {{ name: string, beforeDir: string, afterDir: string, compareDir: string, rows: any[],
 *   failures?: { target: string, id: string, error: string }[], flaky?: string[] }} Section
 */
export function writeReport(file, { title, meta = [], sections, perf }) {
	const base = dirname(file);
	mkdirSync(base, { recursive: true });
	const rel = (p) => relative(base, p).split('\\').join('/');
	const body = [];
	body.push(`<h1>${esc(title)}</h1>`);
	if (meta.length) body.push(`<dl class="meta">${meta.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>`);

	body.push('<table class="summary"><thead><tr><th>Suite</th><th>Identical</th><th>Changed</th><th>Other</th><th>Failed</th><th>Flaky</th></tr></thead><tbody>');
	for (const s of sections) {
		const c = summarize(s.rows);
		const other = c.size + c.missing + c.added;
		body.push(
			`<tr><td><a href="#${esc(s.name)}">${esc(s.name)}</a></td><td>${c.same}/${c.total}</td><td class="${c.changed ? 'hot' : ''}">${c.changed}</td><td class="${other ? 'hot' : ''}">${other}</td><td class="${s.failures?.length ? 'hot' : ''}">${s.failures?.length ?? 0}</td><td>${s.flaky?.length ?? 0}</td></tr>`
		);
	}
	body.push('</tbody></table>');
	body.push('<label class="zoom"><input type="checkbox" id="zoom"> Show crops at 2× (pixelated)</label>');

	for (const s of sections) {
		const c = summarize(s.rows);
		body.push(`<section id="${esc(s.name)}"><h2>${esc(s.name)} <small>${esc(c.line)}</small></h2>`);
		const shown = s.rows.filter((r) => r.status !== 'same');
		if (!shown.length) body.push('<p class="ok">No differences.</p>');
		for (const r of shown) {
			const before = rel(join(s.beforeDir, r.file));
			const after = rel(join(s.afterDir, r.file));
			const links = [];
			if (r.status !== 'added') links.push(`<a href="${esc(before)}">before</a>`);
			if (r.status !== 'missing') links.push(`<a href="${esc(after)}">after</a>`);
			if (r.diff) links.push(`<a href="${esc(rel(join(s.compareDir, r.diff)))}">diff</a>`);
			const what =
				r.status === 'changed'
					? `${r.pixels} px (${r.percent.toFixed(3)}%) in ${r.regions.length} region${r.regions.length === 1 ? '' : 's'}`
					: r.status === 'size'
						? `size ${r.size.join('×')} → ${r.afterSize.join('×')}`
						: r.status === 'missing'
							? 'only in before'
							: 'only in after';
			body.push(`<article class="shot"><h3>${esc(r.file.replace(/\.png$/, ''))} <span class="tag ${r.status}">${r.status}</span></h3>`);
			body.push(`<p class="what">${esc(what)} · ${links.join(' · ')}</p>`);
			if (r.crops?.length)
				for (const c of r.crops) {
					const where = c.box ? `x ${c.box[0]}–${c.box[2]}, y ${c.box[1]}–${c.box[3]}` : 'whole screenshots';
					const labels = c.layout === 'side' ? '<div class="labels"><span>Before</span><span>After</span></div>' : '<div class="labels stack"><span>Before (top) · After (bottom)</span></div>';
					body.push(`<figure>${labels}<img loading="lazy" src="${esc(rel(join(s.compareDir, c.file)))}" alt="${esc(r.file)}, before and after"><figcaption>${esc(where)}</figcaption></figure>`);
				}
			else body.push(`<figure><img loading="lazy" class="full" src="${esc(r.status === 'added' ? after : before)}" alt="${esc(r.file)}"></figure>`);
			body.push('</article>');
		}
		if (s.failures?.length) {
			body.push('<h3>Failed (after retries)</h3><ul class="fail">');
			for (const f of s.failures) body.push(`<li><code>${esc(f.id)}</code> on ${esc(f.target)}: ${esc(f.error)}</li>`);
			body.push('</ul>');
		}
		if (s.flaky?.length)
			body.push(`<h3>Flaky</h3><p>Differed on the first pass, identical on the recheck:</p><ul>${s.flaky.map((f) => `<li><code>${esc(f)}</code></li>`).join('')}</ul>`);
		const same = s.rows.filter((r) => r.status === 'same');
		if (same.length)
			body.push(
				`<details><summary>${same.length} identical</summary><ul class="same">${same.map((r) => `<li><a href="${esc(rel(join(s.afterDir, r.file)))}">${esc(r.file.replace(/\.png$/, ''))}</a></li>`).join('')}</ul></details>`
			);
		body.push('</section>');
	}

	if (perf) {
		body.push(`<section id="perf"><h2>Performance <small>${perf.runs} interleaved runs, ${perf.cpu}× CPU throttle</small></h2>`);
		body.push(`<p class="what">Median [min–max]; Δ is the median against ${esc(perf.labels[0])}; “~” marks a Δ inside the spread (noise). Load average ${perf.loadavg.start.map((n) => n.toFixed(1)).join(' ')} → ${perf.loadavg.end.map((n) => n.toFixed(1)).join(' ')}.</p>`);
		body.push(`<table class="perf"><thead><tr><th>Probe</th><th>Metric</th>${perf.labels.map((l) => `<th>${esc(l)}</th>`).join('')}</tr></thead><tbody>`);
		for (const row of perfRows(perf))
			body.push(
				`<tr><td>${esc(row.probe)}</td><td>${esc(row.metric)}</td>${row.cells.map((c) => `<td>${esc(c.text)}${c.delta ? ` <span class="${c.noise ? 'noise' : 'delta'}">${esc(c.delta)}</span>` : ''}</td>`).join('')}</tr>`
			);
		body.push('</tbody></table></section>');
	}

	writeFileSync(file, page(title, body.join('\n')));
	return file;
}

function page(title, body) {
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
:root { --bg: #fafafa; --fg: #1a1a22; --muted: #5d5d6b; --line: #dcdce3; --card: #fff; --hot: #b3261e; --ok: #1c6c3d; --accent: #3550c8; color-scheme: light dark; }
@media (prefers-color-scheme: dark) { :root { --bg: #15151f; --fg: #e8e8ef; --muted: #a0a0b0; --line: #34344a; --card: #1d1d2a; --hot: #ff8a80; --ok: #7bd389; --accent: #9fb0ff; } }
* { box-sizing: border-box; }
body { margin: 0 auto; max-width: 1400px; padding: 24px 16px 64px; background: var(--bg); color: var(--fg); font: 14px/1.45 system-ui, sans-serif; }
a { color: var(--accent); }
h1 { font-size: 22px; margin: 0 0 12px; }
h2 { font-size: 18px; margin: 32px 0 12px; border-bottom: 1px solid var(--line); padding-bottom: 6px; }
h2 small { color: var(--muted); font-weight: 400; font-size: 14px; margin-left: 8px; }
h3 { font-size: 14px; margin: 0 0 4px; overflow-wrap: anywhere; }
.meta { display: grid; grid-template-columns: max-content 1fr; gap: 2px 12px; margin: 0 0 16px; color: var(--muted); }
.meta dd { margin: 0; color: var(--fg); overflow-wrap: anywhere; }
table { border-collapse: collapse; margin: 8px 0; }
th, td { border: 1px solid var(--line); padding: 4px 10px; text-align: left; font-variant-numeric: tabular-nums; }
th { background: var(--card); }
.hot { color: var(--hot); font-weight: 600; }
.ok { color: var(--ok); }
.zoom { display: block; margin: 12px 0; color: var(--muted); }
.shot { background: var(--card); border: 1px solid var(--line); border-radius: 8px; padding: 12px; margin: 12px 0; overflow-x: auto; }
.what { color: var(--muted); margin: 0 0 8px; }
.tag { font-size: 11px; font-weight: 600; text-transform: uppercase; padding: 1px 6px; border-radius: 4px; border: 1px solid currentColor; color: var(--hot); margin-left: 6px; }
figure { margin: 8px 0 12px; width: fit-content; max-width: 100%; }
figcaption { font-size: 12px; color: var(--muted); margin-top: 2px; }
figure .labels { display: grid; grid-template-columns: 1fr 16px 1fr; font-size: 12px; color: var(--muted); }
figure .labels.stack { display: block; }
figure .labels span:last-child { grid-column: 3; }
figure img { display: block; max-width: 100%; height: auto; border: 1px solid var(--line); }
figure img.full { max-height: 70vh; }
body.zoom2 figure { max-width: none; }
body.zoom2 figure img:not(.full) { max-width: none; zoom: 2; image-rendering: pixelated; }
.same { columns: 3 260px; padding-left: 18px; }
.fail li { color: var(--hot); }
.delta { font-weight: 600; }
.noise { color: var(--muted); }
code { overflow-wrap: anywhere; }
</style>
</head>
<body>
${body}
<script>
const z = document.getElementById('zoom');
try { z.checked = localStorage.getItem('qa-zoom') === '1'; } catch {}
const apply = () => { document.body.classList.toggle('zoom2', z.checked); try { localStorage.setItem('qa-zoom', z.checked ? '1' : '0'); } catch {} };
z.addEventListener('change', apply); apply();
</script>
</body>
</html>
`;
}
