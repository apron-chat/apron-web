import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import ts from 'typescript';

/**
 * Reads what apron-server-go's browser interop suite (`tests/interop/*.ts`) relies on in this app's DOM, from
 * the specs' own source, so `e2e/contract.spec.ts` can check this app still renders it:
 *
 * - `testIds`: `getByTestId('…')`, and `[data-testid="…"]` inside CSS selectors;
 * - `names`: `getByRole(role, { name })` and `getByLabel(…)` with a literal name (a string or a regex), also
 *   when it reaches the call through a helper's parameter or a `const`;
 * - `selectors`: the CSS selectors given to `locator(…)` (classes and data attributes), with values that come
 *   from variables reduced to the attribute alone (`article[data-message-id]`);
 * - `readme`: the backticked names in the README's "UI contract" paragraph.
 *
 * Each entry lists where the suite uses it (`file:line`). Names built at run time (from a token, a user's
 * handle) can't be checked here; they are listed under `dynamic`, for a reader, and not enforced.
 */
export function extractInteropContract(dir) {
	const root = resolve(dir);
	const files = readdirSync(root)
		.filter((f) => f.endsWith('.ts') && !f.endsWith('.d.ts') && !f.endsWith('.config.ts'))
		.sort();
	if (!files.length) throw new Error(`no interop specs (*.ts) in ${root}`);
	const sources = files.map((f) => ts.createSourceFile(f, readFileSync(join(root, f), 'utf8'), ts.ScriptTarget.Latest, true));

	/** @type {Map<string, Set<string>>} */
	const testIds = new Map();
	/** @type {Map<string, { roles: string[], name: string | { regex: string, flags: string }, exact: boolean, at: Set<string> }>} */
	const names = new Map();
	/** @type {Map<string, Set<string>>} */
	const selectors = new Map();
	/** @type {Map<string, Set<string>>} */
	const dynamic = new Map();
	const add = (map, key, at) => (map.get(key) ?? map.set(key, new Set()).get(key)).add(at);

	// Helpers that pass one of their parameters on as a name or a test id: `messageAction(message, name)`.
	/** @type {Map<string, { index: number, kind: 'name' | 'testid', roles: string[], exact: boolean }[]>} */
	const forwarders = new Map();
	for (const sf of sources) visit(sf, (node) => {
		const fn = functionLike(node);
		if (!fn) return;
		const params = fn.node.parameters.map((p) => (ts.isIdentifier(p.name) ? p.name.text : ''));
		const found = [];
		walk(fn.node.body, (inner) => {
			const query = queryCall(inner);
			if (!query) return;
			const arg = query.kind === 'testid' ? query.testid : query.nameNode;
			if (arg && ts.isIdentifier(arg) && params.includes(arg.text)) {
				const index = params.indexOf(arg.text);
				const same = found.find((f) => f.index === index && f.kind === query.kind);
				if (same) same.roles.push(...(query.roles ?? []));
				else found.push({ index, kind: query.kind, roles: [...(query.roles ?? [])], exact: !!query.exact });
			}
		});
		if (found.length) forwarders.set(fn.name, found);
	});

	for (const sf of sources) {
		const consts = constLiterals(sf);
		const at = (node) => `${sf.fileName}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1}${negated(sf, node) ? ABSENT : ''}`;
		visit(sf, (node) => {
			const query = queryCall(node);
			if (query?.kind === 'testid') {
				const value = literal(query.testid, consts);
				if (typeof value === 'string') add(testIds, value, at(node));
				else if (query.testid && !isForwarded(query.testid, node)) add(dynamic, `getByTestId(${query.testid.getText(sf)})`, at(node));
			} else if (query?.kind === 'name') {
				// `a ? 'X' : b`: the literal branch is a name the suite uses; the other is listed as dynamic.
				const options = query.nameNode && ts.isConditionalExpression(query.nameNode) ? [query.nameNode.whenTrue, query.nameNode.whenFalse] : [query.nameNode];
				for (const option of options) {
					const value = option ? literal(option, consts) : undefined;
					if (value !== undefined) addName(query.roles, value, query.exact, at(node));
					else if (option && !isForwarded(option, node)) add(dynamic, `${query.roles.join('|')} named ${option.getText(sf)}`, at(node));
				}
			} else if (query?.kind === 'css') {
				const css = cssText(query.css);
				if (css === undefined) return;
				for (const id of css.matchAll(/\[data-testid="([^"$]+)"\]/g)) add(testIds, id[1], at(node));
				add(selectors, css, at(node));
			}
			// A call to a forwarding helper with a literal for the forwarded parameter.
			if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && forwarders.has(node.expression.text)) {
				for (const f of forwarders.get(node.expression.text) ?? []) {
					const arg = node.arguments[f.index];
					const value = arg && literal(arg, consts);
					if (f.kind === 'testid' && typeof value === 'string') add(testIds, value, at(node));
					else if (f.kind === 'name' && value !== undefined) addName(f.roles, value, f.exact, at(node));
					else if (arg) add(dynamic, `${node.expression.text}(…, ${arg.getText(sf)})`, at(node));
				}
			}
		});
	}

	function addName(roles, value, exact, where) {
		const key = `${[...new Set(roles)].join('|')} ${typeof value === 'string' ? JSON.stringify(value) : `/${value.regex}/${value.flags}`}${typeof value === 'string' && !exact ? ' (substring)' : ''}`;
		const entry = names.get(key) ?? names.set(key, { roles: [...new Set(roles)], name: value, exact: !!exact, at: new Set() }).get(key);
		entry.at.add(where);
	}

	// What the suite only ever asserts is absent (`expect(…).toHaveCount(0)`, `.not`, `toBeHidden`), such as a
	// script left in sanitized HTML, goes apart: the app must not show it.
	const onlyAbsent = (where) => [...where].every((w) => w.endsWith(ABSENT));
	const split = (map, where = (v) => v) => {
		const absent = new Map();
		for (const [key, value] of map) if (onlyAbsent(where(value))) (absent.set(key, value), map.delete(key));
		return absent;
	};
	const absentIds = split(testIds);
	const absentNames = split(names, (v) => v.at);
	const absentSelectors = split(selectors);

	const sorted = (map, value = (v) => [...v].sort(byLocation)) =>
		Object.fromEntries([...map].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => [k, value(v)]));
	const nameEntry = (v) => ({ roles: v.roles, name: v.name, exact: v.exact, at: [...v.at].sort(byLocation) });
	return {
		testIds: sorted(testIds),
		names: sorted(names, nameEntry),
		selectors: sorted(selectors),
		readme: readmeContract(join(root, 'README.md')),
		absent: { testIds: sorted(absentIds), names: sorted(absentNames, nameEntry), selectors: sorted(absentSelectors) },
		dynamic: sorted(dynamic)
	};
}

const ABSENT = ' (absent)';

/** Whether the query is what an `expect(…)` asserts is not there: `.not.…`, `.toHaveCount(0)` or `.toBeHidden()`. */
function negated(sf, node) {
	let top = node;
	while (top.parent && ((ts.isPropertyAccessExpression(top.parent) || ts.isCallExpression(top.parent)) && top.parent.expression === top)) top = top.parent;
	const call = top.parent;
	if (!call || !ts.isCallExpression(call) || !ts.isIdentifier(call.expression) || call.expression.text !== 'expect' || call.arguments[0] !== top) return false;
	return /^\s*\.(not\.|toHaveCount\(\s*0\s*\)|toBeHidden\()/.test(sf.text.slice(call.end, call.end + 40));
}

/** The backticked names in the README's paragraph on the UI contract. */
function readmeContract(path) {
	if (!existsSync(path)) return [];
	const paragraph = readFileSync(path, 'utf8')
		.split(/\n\s*\n/)
		.find((p) => /UI contract/i.test(p));
	return paragraph ? [...new Set([...paragraph.matchAll(/`([^`]+)`/g)].map((m) => m[1].replace(/\s+/g, ' ')))] : [];
}

const byLocation = (a, b) => {
	const [fa, la] = a.split(':');
	const [fb, lb] = b.split(':');
	if (fa === fb && parseInt(la) === parseInt(lb)) return a < b ? -1 : a > b ? 1 : 0;
	return fa === fb ? parseInt(la) - parseInt(lb) : fa < fb ? -1 : 1;
};

function visit(node, fn) {
	fn(node);
	ts.forEachChild(node, (child) => visit(child, fn));
}
function walk(node, fn) {
	if (node) visit(node, fn);
}

/** A named function: `function f(…) {}` or `const f = (…) => …`. */
function functionLike(node) {
	if (ts.isFunctionDeclaration(node) && node.name && node.body) return { name: node.name.text, node };
	if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer)))
		return { name: node.name.text, node: node.initializer };
	return undefined;
}

/** Whether this argument is a parameter of the function it sits in (a forwarder's call sites are read instead). */
function isForwarded(arg, node) {
	if (!ts.isIdentifier(arg)) return false;
	for (let p = node.parent; p; p = p.parent) {
		if (ts.isFunctionDeclaration(p) || ts.isArrowFunction(p) || ts.isFunctionExpression(p)) {
			if (p.parameters.some((param) => ts.isIdentifier(param.name) && param.name.text === arg.text)) return true;
		}
	}
	return false;
}

/** A Playwright query: `getByTestId(x)`, `getByRole(role, { name, exact })`, `getByLabel(x, { exact })`, `locator('css')`. */
function queryCall(node) {
	if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return undefined;
	const method = node.expression.name.text;
	const [first, second] = node.arguments;
	if (method === 'getByTestId') return { kind: 'testid', testid: first };
	if (method === 'getByRole' && first && ts.isStringLiteralLike(first)) {
		const options = second && ts.isObjectLiteralExpression(second) ? second : undefined;
		const prop = (key) => options?.properties.find((p) => (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) && p.name.getText() === key);
		const name = prop('name');
		if (!name) return undefined;
		const nameNode = ts.isShorthandPropertyAssignment(name) ? name.name : name.initializer;
		const exact = prop('exact');
		return { kind: 'name', roles: [first.text], nameNode, exact: !!exact && ts.isPropertyAssignment(exact) && exact.initializer.kind === ts.SyntaxKind.TrueKeyword };
	}
	if (method === 'getByLabel' && first) {
		const options = second && ts.isObjectLiteralExpression(second) ? second : undefined;
		const exact = options?.properties.find((p) => ts.isPropertyAssignment(p) && p.name.getText() === 'exact');
		return { kind: 'name', roles: ['label'], nameNode: first, exact: !!exact && exact.initializer.kind === ts.SyntaxKind.TrueKeyword };
	}
	if (method === 'locator' && first && (ts.isStringLiteralLike(first) || ts.isTemplateExpression(first))) return { kind: 'css', css: first };
	return undefined;
}

/** The `const X = 'literal' | /regex/` declarations at any level of a file. */
function constLiterals(sf) {
	const consts = new Map();
	visit(sf, (node) => {
		if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && (ts.isStringLiteralLike(node.initializer) || ts.isRegularExpressionLiteral(node.initializer)))
			consts.set(node.name.text, node.initializer);
	});
	return consts;
}

/** A string or regex literal (directly or through a `const`), else undefined. */
function literal(node, consts) {
	if (!node) return undefined;
	if (ts.isIdentifier(node) && consts.has(node.text)) node = consts.get(node.text);
	if (ts.isStringLiteralLike(node)) return node.text;
	if (ts.isRegularExpressionLiteral(node)) {
		const m = /^\/(.*)\/([a-z]*)$/s.exec(node.text);
		return m ? { regex: m[1], flags: m[2] } : undefined;
	}
	return undefined;
}

/** A CSS selector's text; a value put in from a variable leaves only its attribute (`[data-thread="${id}"]` → `[data-thread]`). */
function cssText(node) {
	if (ts.isStringLiteralLike(node)) return node.text;
	let text = node.head.text;
	for (const span of node.templateSpans) text += '\u0000' + span.literal.text;
	text = text.replace(/\[([\w-]+)(?:[~|^$*]?=)"[^"\]]*\u0000[^"\]]*"\]/g, '[$1]');
	return text.includes('\u0000') ? undefined : text;
}

/** The interop directory: `--from`, `APRON_INTEROP_DIR`, or a checkout of apron-server-go next to this one. */
export function interopDir(repo, from) {
	const candidates = from
		? [from]
		: [process.env.APRON_INTEROP_DIR, join(repo, '../apron-server-go/tests/interop'), join(repo, '../apron-chat/apron-server-go/tests/interop'), join(repo, '../../apron-chat/apron-server-go/tests/interop')].filter(Boolean);
	return candidates.map((c) => resolve(c)).find((c) => existsSync(join(c, 'test-helpers.ts')) || existsSync(join(c, 'chat.spec.ts')));
}

export const contractName = (dir) => basename(resolve(dir, '../..'));
