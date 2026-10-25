import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { DEVICES, expect, test, type Preview } from './fixtures';

/**
 * An accessibility baseline: axe-core on the main screens, at desktop and phone width. Serious and critical
 * violations are compared with `a11y-baseline.json`, per screen and rule: a rule that wasn't there, or that
 * now flags more elements, fails. Fixing some lowers the count, which passes; then `E2E_UPDATE_A11Y=1 npm run
 * e2e -- a11y` writes the lower baseline, to commit. Minor and moderate findings aren't gated.
 */

const BASELINE_FILE = resolve(import.meta.dirname, 'a11y-baseline.json');
const AXE = createRequire(import.meta.url).resolve('axe-core/axe.min.js');
const UPDATE = Boolean(process.env.E2E_UPDATE_A11Y);
const GATED = ['serious', 'critical'];

type Finding = { impact: string; help: string; targets: string[] };
type Baseline = Record<string, Record<string, Finding>>;

const baseline: Baseline = (() => {
	try {
		return JSON.parse(readFileSync(BASELINE_FILE, 'utf8'));
	} catch {
		return {};
	}
})();

const SCREENS: Record<string, (preview: Preview) => Promise<void>> = {
	connect: async (preview) => {
		await preview.openRoot();
		await preview.roomsPane();
		await preview.press(preview.page.getByRole('button', { name: 'Connection settings', exact: true }));
		await expect(preview.page.getByRole('form', { name: 'Sign in' })).toBeVisible();
	},
	room: (preview) => preview.open(),
	preferences: async (preview) => {
		await preview.open();
		await preview.roomsPane();
		await preview.press(preview.page.getByRole('button', { name: /^Open preferences/ }));
		await expect(preview.page.getByRole('dialog', { name: 'Preferences' })).toBeVisible();
	},
	thread: (preview) => preview.open('#room=general&thread=thread_deploy')
};

/** The gated violations on the page now, by rule. */
async function audit(preview: Preview): Promise<Record<string, Finding>> {
	const { page } = preview;
	await page.evaluate(() => document.fonts.ready.then(() => undefined));
	await page.addScriptTag({ path: AXE });
	const violations = await page.evaluate(async () => {
		const axe = (window as unknown as { axe: { run: (context: Document, options: object) => Promise<{ violations: { id: string; impact: string; help: string; nodes: { target: string[] }[] }[] }> } }).axe;
		const result = await axe.run(document, { resultTypes: ['violations'] });
		return result.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, targets: v.nodes.map((n) => n.target.join(' ')) }));
	});
	return Object.fromEntries(violations.filter((v) => GATED.includes(v.impact)).map((v) => [v.id, { impact: v.impact, help: v.help, targets: v.targets.sort() }]));
}

/** What got worse than the baseline: a rule it doesn't have, or more elements for one it has. */
function regressions(now: Record<string, Finding>, before: Record<string, Finding> = {}): string[] {
	return Object.entries(now)
		.filter(([rule, finding]) => finding.targets.length > (before[rule]?.targets.length ?? 0))
		.map(([rule, finding]) => `${rule} (${finding.impact}): ${finding.help}: ${finding.targets.length} element(s), baseline ${before[rule]?.targets.length ?? 0}: ${finding.targets.slice(0, 5).join(' | ')}`);
}

if (UPDATE) test.describe.configure({ mode: 'serial' });

for (const device of ['desktop', 'phone'] as const) {
	test.describe(device, () => {
		test.use(DEVICES[device]);

		for (const [screen, open] of Object.entries(SCREENS)) {
			test(`${screen} has no new serious or critical violations`, async ({ preview }) => {
				await open(preview);
				const key = `${screen}--${device}`;
				const now = await audit(preview);
				if (UPDATE) {
					const current: Baseline = JSON.parse(readFileSync(BASELINE_FILE, 'utf8').trim() || '{}');
					current[key] = now;
					writeFileSync(BASELINE_FILE, `${JSON.stringify(Object.fromEntries(Object.entries(current).sort()), null, '\t')}\n`);
					return;
				}
				expect(regressions(now, baseline[key]), `axe on ${key}; if intended, update the baseline with E2E_UPDATE_A11Y=1`).toEqual([]);
			});
		}
	});
}
