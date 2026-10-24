import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

/** Screenshots in a directory (failure captures excluded), optionally filtered by substrings. */
export function shotsIn(dir, filters = []) {
	if (!existsSync(dir)) return [];
	return readdirSync(dir)
		.filter((f) => f.endsWith('.png') && !f.endsWith('.FAILED.png'))
		.filter((f) => !filters.length || filters.some((s) => f.includes(s)))
		.sort();
}

const readPng = (path) => PNG.sync.read(readFileSync(path));

/**
 * @typedef {[number, number, number, number]} Box [left, top, right, bottom)
 * @typedef {{ file: string, status: 'same' | 'changed' | 'size' | 'missing' | 'added', pixels?: number,
 *   percent?: number, box?: Box, regions?: Box[], size?: [number, number], afterSize?: [number, number],
 *   crops?: { file: string, box: Box | null, layout: 'side' | 'stack' }[], diff?: string, flaky?: boolean }} DiffRow
 */

/**
 * Pixel-compares the same-named screenshots in two directories. Writes a diff PNG for each changed one to
 * `diffDir` (changed pixels red over a faded copy of `before`). `box` bounds every change; `regions` are
 * the separate changed areas.
 *
 * @returns {DiffRow[]}
 */
export function diffDirs(beforeDir, afterDir, { diffDir = undefined, filters = [], threshold = 0.1 } = {}) {
	const names = [...new Set([...shotsIn(beforeDir, filters), ...shotsIn(afterDir, filters)])].sort();
	if (diffDir) mkdirSync(diffDir, { recursive: true });
	return names.map((file) => {
		const a = join(beforeDir, file);
		const b = join(afterDir, file);
		if (!existsSync(b)) return { file, status: 'missing' };
		if (!existsSync(a)) return { file, status: 'added' };
		const x = readPng(a);
		const y = readPng(b);
		if (x.width !== y.width || x.height !== y.height)
			return { file, status: 'size', size: [x.width, x.height], afterSize: [y.width, y.height] };
		const out = new PNG({ width: x.width, height: x.height });
		const pixels = pixelmatch(x.data, y.data, out.data, x.width, x.height, { threshold, diffColor: [255, 0, 0] });
		if (!pixels) return { file, status: 'same', size: [x.width, x.height] };
		if (diffDir) writeFileSync(join(diffDir, file), PNG.sync.write(out));
		return {
			file,
			status: 'changed',
			pixels,
			percent: (100 * pixels) / (x.width * x.height),
			...changedRegions(out),
			size: [x.width, x.height]
		};
	});
}

/**
 * The changed regions of a pixelmatch diff (its pure-red pixels; anti-aliasing is yellow and the faded
 * copy grey). Changes closer than `join` px form one region, so a shifted row is one crop while a sidebar
 * tweak and a header tweak are two. More than `max` regions collapse into their overall box.
 *
 * @returns {{ box: Box, regions: Box[] }}
 */
function changedRegions(png, { cell = 8, join = 24, max = 6 } = {}) {
	const { width: w, height: h, data: d } = png;
	const gw = Math.ceil(w / cell);
	const gh = Math.ceil(h / cell);
	/** @type {(Box | undefined)[]} Per grid cell, the bounds of its changed pixels. */
	const cells = new Array(gw * gh);
	for (let y = 0; y < h; y++)
		for (let x = 0; x < w; x++) {
			const i = (y * w + x) * 4;
			if (d[i] !== 255 || d[i + 1] !== 0 || d[i + 2] !== 0) continue;
			const c = Math.floor(y / cell) * gw + Math.floor(x / cell);
			const b = (cells[c] ??= [x, y, x + 1, y + 1]);
			if (x < b[0]) b[0] = x;
			if (y < b[1]) b[1] = y;
			if (x + 1 > b[2]) b[2] = x + 1;
			if (y + 1 > b[3]) b[3] = y + 1;
		}
	const reach = Math.ceil(join / cell);
	const seen = new Uint8Array(gw * gh);
	/** @type {Box[]} */
	const regions = [];
	for (let start = 0; start < cells.length; start++) {
		if (!cells[start] || seen[start]) continue;
		seen[start] = 1;
		const stack = [start];
		/** @type {Box} */
		const box = [w, h, 0, 0];
		while (stack.length) {
			const c = /** @type {number} */ (stack.pop());
			const b = /** @type {Box} */ (cells[c]);
			box[0] = Math.min(box[0], b[0]);
			box[1] = Math.min(box[1], b[1]);
			box[2] = Math.max(box[2], b[2]);
			box[3] = Math.max(box[3], b[3]);
			const cx = c % gw;
			const cy = Math.floor(c / gw);
			for (let ny = Math.max(0, cy - reach); ny <= Math.min(gh - 1, cy + reach); ny++)
				for (let nx = Math.max(0, cx - reach); nx <= Math.min(gw - 1, cx + reach); nx++) {
					const n = ny * gw + nx;
					if (cells[n] && !seen[n]) {
						seen[n] = 1;
						stack.push(n);
					}
				}
		}
		regions.push(box);
	}
	if (!regions.length) return { box: [0, 0, w, h], regions: [[0, 0, w, h]] };
	// Regions whose boxes come within `join` of each other would crop the same area twice: merge them.
	for (let merged = true; merged; ) {
		merged = false;
		for (let i = 0; i < regions.length && !merged; i++)
			for (let j = i + 1; j < regions.length && !merged; j++) {
				const [a, b] = [regions[i], regions[j]];
				if (a[0] - join < b[2] && b[0] - join < a[2] && a[1] - join < b[3] && b[1] - join < a[3]) {
					regions[i] = [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
					regions.splice(j, 1);
					merged = true;
				}
			}
	}
	/** @type {Box} */
	const box = [
		Math.min(...regions.map((r) => r[0])),
		Math.min(...regions.map((r) => r[1])),
		Math.max(...regions.map((r) => r[2])),
		Math.max(...regions.map((r) => r[3]))
	];
	regions.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
	return { box, regions: regions.length > max ? [box] : regions };
}

/** Counts per status, and the `N/M identical` line. */
export function summarize(rows) {
	const counts = { same: 0, changed: 0, size: 0, missing: 0, added: 0 };
	for (const r of rows) counts[r.status]++;
	return { ...counts, total: rows.length, line: `${counts.same}/${rows.length} identical` };
}

/** The diff rows a person needs to look at, then the summary line. */
export function formatDiff(rows) {
	const lines = [];
	for (const r of rows) {
		if (r.status === 'same') continue;
		const what = {
			changed: `${r.pixels}px (${r.percent?.toFixed(3)}%) in ${r.regions?.map((b) => b.join(',')).join(' + ')}`,
			size: `${r.size?.join('×')} → ${r.afterSize?.join('×')}`,
			missing: 'only in before',
			added: 'only in after'
		}[r.status];
		lines.push(`${r.status.toUpperCase().padEnd(8)} ${r.file}  ${what}`);
	}
	lines.push(summarize(rows).line);
	return lines.join('\n');
}

/**
 * Crops before and after to `box` (plus `pad`) and lays them out before|after with a grey gutter, or
 * before above after when the crop is wider than `wide`. Without a box (sizes differ), the whole images.
 *
 * @returns {{ box: Box | null, layout: 'side' | 'stack' }}
 */
export function writeCrop(beforeFile, afterFile, box, outFile, { pad = 40, gutter = 16, wide = 600 } = {}) {
	const x = readPng(beforeFile);
	const y = readPng(afterFile);
	/** @type {Box | null} */
	const padded = box && [Math.max(0, box[0] - pad), Math.max(0, box[1] - pad), Math.min(x.width, box[2] + pad), Math.min(x.height, box[3] + pad)];
	const ca = padded ? crop(x, padded) : x;
	const cb = padded ? crop(y, padded) : y;
	const layout = Math.max(ca.width, cb.width) > wide ? 'stack' : 'side';
	const sheet =
		layout === 'side'
			? new PNG({ width: ca.width + gutter + cb.width, height: Math.max(ca.height, cb.height) })
			: new PNG({ width: Math.max(ca.width, cb.width), height: ca.height + gutter + cb.height });
	fill(sheet, [136, 136, 136, 255]);
	PNG.bitblt(ca, sheet, 0, 0, ca.width, ca.height, 0, 0);
	if (layout === 'side') PNG.bitblt(cb, sheet, 0, 0, cb.width, cb.height, ca.width + gutter, 0);
	else PNG.bitblt(cb, sheet, 0, 0, cb.width, cb.height, 0, ca.height + gutter);
	writeFileSync(outFile, PNG.sync.write(sheet));
	return { box: padded, layout };
}

function crop(png, [l, t, r, b]) {
	const out = new PNG({ width: r - l, height: b - t });
	PNG.bitblt(png, out, l, t, r - l, b - t, 0, 0);
	return out;
}

function fill(png, [r, g, b, a]) {
	for (let i = 0; i < png.data.length; i += 4) {
		png.data[i] = r;
		png.data[i + 1] = g;
		png.data[i + 2] = b;
		png.data[i + 3] = a;
	}
}

/**
 * Diffs two directories and writes, under `outDir`: `diff/` (diff PNGs), `crops/` (a before|after crop of
 * each changed region, `<shot>--<n>.png` when a shot has several) and `summary.json`. Returns the rows,
 * each changed one with its `crops` and `diff` (paths relative to `outDir`).
 *
 * @returns {DiffRow[]}
 */
export function compareDirs(beforeDir, afterDir, outDir, { filters = [] } = {}) {
	const cropDir = join(outDir, 'crops');
	mkdirSync(cropDir, { recursive: true });
	const rows = diffDirs(beforeDir, afterDir, { diffDir: join(outDir, 'diff'), filters });
	for (const row of rows) {
		if (row.status !== 'changed' && row.status !== 'size') continue;
		/** @type {(Box | null)[]} */
		const boxes = row.status === 'size' ? [null] : (row.regions ?? [row.box ?? null]);
		row.crops = boxes.map((box, i) => {
			const file = boxes.length > 1 ? row.file.replace(/\.png$/, `--${i + 1}.png`) : row.file;
			return { file: join('crops', file), ...writeCrop(join(beforeDir, row.file), join(afterDir, row.file), box, join(cropDir, file)) };
		});
		if (row.status === 'changed') row.diff = join('diff', row.file);
	}
	writeFileSync(join(outDir, 'summary.json'), JSON.stringify({ beforeDir, afterDir, ...summarize(rows), rows }, null, 1));
	return rows;
}
