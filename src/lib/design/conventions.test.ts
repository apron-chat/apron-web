import { parse } from 'svelte/compiler';
import { describe, expect, it } from 'vitest';

// Read from disk, as apron.test.ts does. (The app has no Node types: hence the indirection.)
const fsModule = 'node:fs';
const { readFileSync, readdirSync } = await import(/* @vite-ignore */ fsModule) as { readFileSync: (path: URL, encoding: 'utf8') => string; readdirSync: (path: URL) => string[] };
const folder = new URL('./components/', import.meta.url);
const components = readdirSync(folder).filter((file) => file.endsWith('.svelte')).sort();

/**
 * Files another branch is converting to explicit props (the message row's rebuild), skipped until it lands. This is
 * not a list of components allowed to spread: once a file here has no spread without its reason, delete its entry.
 */
const CONVERTING = new Set(['Avatar.svelte', 'Message.svelte', 'MessageActions.svelte', 'ReactionBar.svelte', 'ReplyPreview.svelte', 'RoleBadges.svelte']);

/** The comment that lets a spread stay, right before what it is on: `<!-- spread: why -->`. */
const REASON = /^\s*spread:\s*\S/;

interface Node {
	type: string;
	start: number;
	name?: string;
	data?: string;
	attributes?: { type: string }[];
	nodes?: Node[];
	[key: string]: unknown;
}

/**
 * Every element or component in `source`'s markup that takes a spread (`{...x}`) with no `<!-- spread: … -->`
 * comment among the comments right before it, as `line: <name>`.
 */
function unjustified(source: string): string[] {
	const found: string[] = [];
	const visit = (value: unknown): void => {
		if (!value || typeof value !== 'object') return;
		if (Array.isArray(value)) {
			for (const item of value) visit(item);
			return;
		}
		const node = value as Node;
		if (node.type === 'Fragment' && Array.isArray(node.nodes)) {
			node.nodes.forEach((child, index) => {
				if (!child.attributes?.some((attribute) => attribute.type === 'SpreadAttribute')) return;
				// The comments just before it, whitespace aside.
				const before: string[] = [];
				for (let at = index - 1; at >= 0; at--) {
					const sibling = node.nodes![at];
					if (sibling.type === 'Comment') before.push(sibling.data ?? '');
					else if (!(sibling.type === 'Text' && !String(sibling.data).trim())) break;
				}
				if (!before.some((comment) => REASON.test(comment))) found.push(`${source.slice(0, child.start).split('\n').length}: <${child.name}>`);
			});
		}
		for (const [key, child] of Object.entries(node)) if (key !== 'parent' && key !== 'metadata') visit(child);
	};
	visit((parse(source, { modern: true }) as unknown as { fragment: Node }).fragment);
	return found;
}

describe('design components', () => {
	it('spread nothing onto an element or component without a `<!-- spread: why -->` comment right before it', () => {
		const offenders = components
			.filter((file) => !CONVERTING.has(file))
			.flatMap((file) => unjustified(readFileSync(new URL(file, folder), 'utf8')).map((where) => `${file}:${where}`));
		// Declare the props a component takes (`class`, `testid`, an `id`, the handlers its callers use) instead. A spread
		// stays only where the component stands in for one element any of whose attributes is the caller's, saying so.
		expect(offenders).toEqual([]);
	});

	it('finds a spread without its reason, wherever it sits, and takes one with it', () => {
		expect(unjustified('<div {...rest}></div>')).toEqual(['1: <div>']);
		expect(unjustified('{#if a}\n\t<Row {...rest} />\n{/if}')).toEqual(['2: <Row>']);
		expect(unjustified('<!-- a note --><b {...rest}></b>')).toEqual(['1: <b>']);
		expect(unjustified('<!-- spread: a generic <button> -->\n<!-- its role follows -->\n<button {...rest}></button>')).toEqual([]);
		expect(unjustified('<!-- spread: -->\n<button {...rest}></button>')).toEqual(['2: <button>']);
		expect(unjustified('<!-- spread: why --><p></p><button {...rest}></button>')).toEqual(['1: <button>']);
		expect(unjustified('<script>const { a, ...rest } = $props();</script><i title={a}></i>')).toEqual([]);
	});
});
