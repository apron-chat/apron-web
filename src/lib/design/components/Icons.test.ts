import { describe, expect, it } from 'vitest';

/**
 * Icons.svelte is the one place an icon's shapes are written, each a copy of lucide's under its name; everywhere else
 * draws one of those or lucide's own component. So the design system's icons can't drift apart: these check each copy
 * against @lucide/svelte's data (a lucide update that redraws one fails here; paste the markup the failure gives), and
 * that no other component draws an icon of its own.
 */

const ICONS = '/src/lib/design/components/Icons.svelte';

// The app's components as written; lucide's icons read from disk, as only a few are asked for. (The app has no Node
// types: hence the indirection.)
const components = import.meta.glob<string>('/src/**/*.svelte', { query: '?raw', import: 'default', eager: true });
const fsModule = 'node:fs';
const { readFileSync } = (await import(/* @vite-ignore */ fsModule)) as { readFileSync: (path: URL, encoding: 'utf8') => string };
const LUCIDE = new URL('../../../../node_modules/@lucide/svelte/dist/icons/', import.meta.url);

type Shape = [tag: string, attrs: Record<string, string>];

/** Lucide's shapes for `name`, through its aliases (`smile-plus` is `face-slightly-smiling-plus`). */
function lucide(name: string): Shape[] {
	const module = readFileSync(new URL(`${name}.js`, LUCIDE), 'utf8');
	const file = module.match(/from "\.\/([\w-]+)\.svelte"/)?.[1] ?? name;
	const data = readFileSync(new URL(`${file}.svelte`, LUCIDE), 'utf8').match(/const iconData = (\{.*\});/)?.[1];
	if (!data) throw new Error(`No lucide icon named ${name}`);
	return (JSON.parse(data).node as Shape[]).map(([tag, { key: _, ...attrs }]) => [tag, attrs]);
}

/** The shapes written in an `<svg>`'s markup, as lucide lists them. */
function shapes(svg: string): Shape[] {
	return [...svg.matchAll(/<(\w+)\s([^>]*?)\s*\/>/g)].map(([, tag, attrs]) => [tag, Object.fromEntries([...attrs.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, k, v]) => [k, v]))]);
}

const markup = (shapes: Shape[]) => shapes.map(([tag, attrs]) => `<${tag} ${Object.entries(attrs).map(([k, v]) => `${k}="${v}"`).join(' ')} />`).join('');
const kebab = (name: string) => name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

const source = components[ICONS];
const icons = [...source.matchAll(/\{#snippet (\w+)\(\)\}(.*?)\{\/snippet\}/g)].map(([, name, svg]) => ({ name, svg }));

describe('Icons', () => {
	it('exports each icon it draws, and draws each as a static, hidden .ap-icon', () => {
		expect(icons.length).toBeGreaterThan(0);
		const exported = source.match(/export \{([^}]*)\}/)?.[1].split(',').map((name: string) => name.trim()).filter(Boolean);
		expect(exported?.toSorted()).toEqual(icons.map(({ name }) => name).toSorted());
		for (const { name, svg } of icons) expect(svg, name).toMatch(/^<svg class="ap-icon" viewBox="0 0 24 24" aria-hidden="true">.*<\/svg>$/);
	});

	it.each(icons)('$name is lucide’s, as @lucide/svelte draws it now', ({ name, svg }) => {
		const theirs = lucide(kebab(name));
		expect(markup(shapes(svg)), `${name}: ${markup(theirs)}`).toBe(markup(theirs));
	});

	it('is the only component that draws an icon’s shapes', () => {
		expect(Object.keys(components).length).toBeGreaterThan(50);
		const drawn = Object.entries(components).filter(([path, text]) => path !== ICONS && /<svg[^>]*viewBox="0 0 24 24"/.test(text)).map(([path]) => path);
		expect(drawn).toEqual([]);
	});
});
