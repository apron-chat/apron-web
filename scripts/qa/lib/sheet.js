import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { PNG } from 'pngjs';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/**
 * Renders a hand-picked before/after sheet (for a pull request description) from a JSON spec:
 *
 *   { "panels": [{ "title": "…", "note": "…", "before": "run/main/before/room--desktop--light.png",
 *                  "after": "run/main/after/room--desktop--light.png", "box": [l, t, r, b], "scale": 2 }] }
 *
 * Paths are relative to the spec. `before` is optional (an after-only panel); `box` defaults to the whole
 * image. The sheet is laid out as HTML and screenshotted, so titles get real text rendering.
 */
export async function renderSheet(browser, specFile, outFile) {
	const spec = JSON.parse(readFileSync(specFile, 'utf8'));
	const base = dirname(resolve(specFile));
	const panels = spec.panels.map((/** @type {any} */ p) => {
		const after = resolve(base, p.after);
		const { width, height } = PNG.sync.read(readFileSync(after));
		return { ...p, after, before: p.before && resolve(base, p.before), box: p.box ?? [0, 0, width, height], scale: p.scale ?? 1 };
	});
	const crop = (/** @type {string} */ file, /** @type {number[]} */ [l, t, r, b], /** @type {number} */ s) =>
		`<div class="crop" style="width:${(r - l) * s}px;height:${(b - t) * s}px"><img src="data:image/png;base64,${readFileSync(file).toString('base64')}" style="transform:translate(${-l * s}px,${-t * s}px) scale(${s});"></div>`;
	const html = `<!doctype html><meta charset="utf-8"><style>
body { margin: 0; background: #e6e6e6; font: 14px/1.4 system-ui, sans-serif; color: #111; width: max-content; }
.panel { background: #fff; padding: 12px 16px 16px; margin-bottom: 4px; }
h2 { font-size: 18px; margin: 0 0 2px; } p { margin: 0 0 10px; color: #555; }
.row { display: flex; gap: 24px; } .label { font-size: 12px; font-weight: 600; margin-bottom: 4px; }
.before .label { color: #b0173f; } .after .label { color: #1c6c3d; }
.crop { overflow: hidden; outline: 1px solid #ccc; position: relative; }
.crop img { position: absolute; left: 0; top: 0; transform-origin: 0 0; image-rendering: ${spec.pixelated ? 'pixelated' : 'auto'}; }
</style>${panels
		.map(
			(/** @type {any} */ p) =>
				`<div class="panel"><h2>${esc(p.title ?? '')}</h2>${p.note ? `<p>${esc(p.note)}</p>` : ''}<div class="row">${p.before ? `<div class="before"><div class="label">BEFORE</div>${crop(p.before, p.box, p.scale)}</div>` : ''}<div class="after"><div class="label">AFTER</div>${crop(p.after, p.box, p.scale)}</div></div></div>`
		)
		.join('')}`;
	const page = await browser.newPage({ deviceScaleFactor: 1 });
	try {
		await page.setContent(html, { waitUntil: 'load' });
		await page.locator('body').screenshot({ path: outFile });
	} finally {
		await page.close();
	}
	return outFile;
}
