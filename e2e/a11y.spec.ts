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

/** Each screen as reached from the one before it: the connect screen on `/`; then, on the preview, a room, Preferences over it, and a thread. */
const CONNECT = async (preview: Preview) => {
	await preview.openRoot();
	await preview.openConnect();
};
const SCREENS: Record<string, (preview: Preview) => Promise<void>> = {
	room: (preview) => preview.open(),
	preferences: async (preview) => {
		await preview.roomsPane();
		await preview.press(preview.page.getByRole('button', { name: /^Open preferences/ }));
		await expect(preview.page.getByRole('dialog', { name: 'Preferences' })).toBeVisible();
	},
	thread: async (preview) => {
		await preview.page.keyboard.press('Escape');
		await expect(preview.page.getByRole('dialog', { name: 'Preferences' })).toHaveCount(0);
		await preview.openThread('thread_deploy');
		await expect(preview.page.getByTestId('message-list').locator('article[data-message-id]').first()).toBeVisible();
	}
};

/** The gated violations on the page now, by rule. */
async function audit(preview: Preview): Promise<Record<string, Finding>> {
	const { page } = preview;
	await page.evaluate(() => document.fonts.ready.then(() => undefined));
	// Once per page: the screens after the first are reached without a reload.
	if (!(await page.evaluate(() => 'axe' in window))) await page.addScriptTag({ path: AXE });
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

/** Fails on anything worse than this screen's baseline; with `E2E_UPDATE_A11Y`, writes what it found instead. */
async function check(preview: Preview, key: string): Promise<void> {
	const now = await audit(preview);
	if (UPDATE) {
		const current: Baseline = JSON.parse(readFileSync(BASELINE_FILE, 'utf8').trim() || '{}');
		current[key] = now;
		writeFileSync(BASELINE_FILE, `${JSON.stringify(Object.fromEntries(Object.entries(current).sort()), null, '\t')}\n`);
		return;
	}
	expect(regressions(now, baseline[key]), `axe on ${key}; if intended, update the baseline with E2E_UPDATE_A11Y=1`).toEqual([]);
}

if (UPDATE) test.describe.configure({ mode: 'serial' });

for (const device of ['desktop', 'phone'] as const) {
	test.describe(device, () => {
		test.use(DEVICES[device]);

		test('connect has no new serious or critical violations', async ({ preview }) => {
			await CONNECT(preview);
			await check(preview, `connect--${device}`);
		});

		test(`${Object.keys(SCREENS).join(', ')} have no new serious or critical violations`, async ({ preview }) => {
			for (const [screen, open] of Object.entries(SCREENS)) {
				await test.step(`${screen} has no new serious or critical violations`, async () => {
					await open(preview);
					await check(preview, `${screen}--${device}`);
				});
			}
		});
	});
}
