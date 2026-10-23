import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { extractInteropContract, interopDir } from '../scripts/qa/lib/interop-contract.js';
import { contract, SCENES, SEEN_DIR, type Seen } from './contract';
import { expect, test } from './fixtures';

/**
 * The test ids, accessible names and selectors apron-server-go's interop suite finds this app's elements by
 * (`interop-contract.json`, read from its specs) must all still be there: each one shown by some scene in
 * `contract-scenes.spec.ts`, which runs first. One that disappears fails here with the interop tests that use it.
 *
 * A few can't be reached on `/__preview`; they are listed in OUT_OF_REACH with why, and checked more weakly:
 * their text must still be in the built bundle. An entry listed there that a scene does show fails too, so
 * the list stays honest.
 */

const SIGNED_IN = 'Needs a signed-in account (passkey or email): the preview and the scripted server sign in guests only. Interop push.spec and webauthn.spec reach it.';
const OUT_OF_REACH: Record<string, string> = {
	'button "Alert when it’s closed, too" (substring)': `Web push. ${SIGNED_IN}`,
	'button "Resume"': `Pausing notifications. ${SIGNED_IN}`,
	'button /^Pause/': `Pausing notifications. ${SIGNED_IN}`,
	'button /^Open preferences\\. Notifications paused/': `Pausing notifications. ${SIGNED_IN}`,
	'menuitem /For 1 hour/': `Pausing notifications. ${SIGNED_IN}`,
	'menuitem /Until I resume/': `Pausing notifications. ${SIGNED_IN}`,
	'option /For 1 hour/': `Pausing notifications. ${SIGNED_IN}`,
	'option /Until I resume/': `Pausing notifications. ${SIGNED_IN}`,
	'button "Sign out"': SIGNED_IN,
	'button "Signing in…"': 'Shown only during a passkey ceremony, which needs an authenticator and a server that verifies it.',
	'.ap-embed-livebadge': 'A live stream loads only from the chat server’s own origin, and the preview has none.',
	// push.spec's statusChooser takes a status control as a menu button or a select: this app has the button.
	'combobox /status/i': 'The alternative to `button /status/i` (seen): interop accepts a select or a menu button.',
	option: 'The options of that select, the alternative to the menu this app shows.'
};

/**
 * Entries the interop suite uses that this app no longer renders: real breaks, reported to fix on one side
 * or the other, and tested (as fixme) below rather than failing every run.
 */
const KNOWN_BREAKS: Record<string, string> = {};

const seen: Seen[] = existsSync(SEEN_DIR) ? readdirSync(SEEN_DIR).map((f) => JSON.parse(readFileSync(join(SEEN_DIR, f), 'utf8'))) : [];
const ran = new Set(seen.map((s) => s.scene));
const shown = (kind: 'testIds' | 'names' | 'selectors' | 'readme') => new Set(seen.flatMap((s) => s[kind]));

test.beforeEach(() => {
	const missing = SCENES.map((s) => s.name).filter((name) => !ran.has(name));
	test.skip(missing.length > 0, `scenes that didn't run (filtered out, or failed): ${missing.join(', ')}`);
});

/** The entries of one kind no scene showed and OUT_OF_REACH doesn't excuse, with the interop tests that use them. */
function missing(kind: 'testIds' | 'names' | 'selectors', entries: Record<string, string[]>): string[] {
	const found = shown(kind);
	return Object.entries(entries)
		.filter(([key]) => !found.has(key) && !(key in OUT_OF_REACH) && !(key in KNOWN_BREAKS))
		.map(([key, at]) => `${key}  (used at ${at.join(', ')})`);
}

const HOW = 'No scene in contract-scenes.spec.ts shows these. If the app renamed or removed them, the interop suite in apron-server-go breaks: keep them, or change both. If a scene just doesn’t reach the state, add one, or list them in OUT_OF_REACH with why.';

test('every test id the interop suite uses is rendered', () => {
	expect(missing('testIds', contract.testIds), HOW).toEqual([]);
});

test('every accessible name the interop suite uses is there', () => {
	expect(missing('names', Object.fromEntries(Object.entries(contract.names).map(([key, entry]) => [key, entry.at]))), HOW).toEqual([]);
});

test('every selector the interop suite uses matches', () => {
	expect(missing('selectors', contract.selectors), HOW).toEqual([]);
});

test('the README’s UI contract holds', () => {
	const found = shown('readme');
	expect(contract.readme.filter((item) => !found.has(item)), HOW).toEqual([]);
});

test('what no scene reaches is still in the bundle, and is still out of reach', () => {
	const all = new Set([...Object.keys(contract.testIds), ...Object.keys(contract.names), ...Object.keys(contract.selectors)]);
	expect(Object.keys(OUT_OF_REACH).filter((key) => !all.has(key)), 'OUT_OF_REACH or KNOWN_BREAKS lists entries the interop suite no longer uses').toEqual([]);
	const reached = new Set([...shown('testIds'), ...shown('names'), ...shown('selectors')]);
	expect(Object.keys(OUT_OF_REACH).filter((key) => reached.has(key)), 'a scene shows these now: take them off OUT_OF_REACH').toEqual([]);
	const dir = process.env.E2E_BUILD_DIR;
	test.skip(!dir, 'no build directory to read (E2E_URL was given)');
	const bundle = files(join(dir!, '_app')).filter((f) => /\.(js|css)$/.test(f)).map((f) => readFileSync(f, 'utf8')).join('\n');
	const absent = Object.keys(OUT_OF_REACH).filter((key) => !inBundle(key, bundle));
	expect(absent, 'out of reach, and not in the built bundle either: renamed or removed?').toEqual([]);
});

for (const [key, why] of Object.entries(KNOWN_BREAKS)) {
	test(`interop's ${key} matches`, () => {
		test.fixme(true, why);
		expect([...shown('testIds'), ...shown('names'), ...shown('selectors')]).toContain(key);
	});
}

test('known breaks are still broken', () => {
	const reached = new Set([...shown('testIds'), ...shown('names'), ...shown('selectors')]);
	expect(Object.keys(KNOWN_BREAKS).filter((key) => reached.has(key)), 'a scene shows these now: take them off KNOWN_BREAKS').toEqual([]);
});

test('the contract is current with the interop suite', () => {
	const dir = interopDir(resolve(import.meta.dirname, '..'));
	test.skip(!dir, 'apron-server-go is not checked out beside this repository (set APRON_INTEROP_DIR)');
	const fresh = extractInteropContract(dir!);
	expect({ ...contract, from: undefined }, `interop-contract.json is stale: run \`npm run qa -- contract --from ${dir}\``).toEqual({ ...fresh, from: undefined });
});

/** Whether an entry's text is in the bundle: a test id or name as written, a regex's literal core, a selector's class names. */
function inBundle(key: string, bundle: string): boolean {
	const entry = contract.names[key];
	if (entry) {
		if (typeof entry.name === 'string') return bundle.includes(entry.name);
		return new RegExp(entry.name.regex.replace(/^\^|\$$/g, ''), entry.name.flags).test(bundle);
	}
	if (key in contract.testIds) return bundle.includes(key);
	const classes = [...key.matchAll(/\.([\w-]+)/g)].map((m) => m[1]);
	const attributes = [...key.matchAll(/\[([\w-]+)/g)].map((m) => m[1]);
	return [...classes, ...attributes].every((part) => bundle.includes(part));
}

function files(dir: string): string[] {
	return readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		return statSync(path).isDirectory() ? files(path) : [path];
	});
}
