// Writes the design system's components/index.d.ts: the design system's props documentation, generated from the components' `interface Props`.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const D = 'src/lib/design/components';
const names = [...readFileSync(`${D}/index.ts`, 'utf8').matchAll(/export \{ default as (\w+) \}/g)].map((m) => m[1]);
const types = readFileSync(`${D}/types.ts`, 'utf8').replace(/^import .*\n|^export type \{ Sender \};\n/gm, '').trim();
const sender = readFileSync(`${D}/util.ts`, 'utf8').match(/\/\*\* A user object[\s\S]*?\n\}\n/)[0].trim();

const out = [
	'/* Apron components (Svelte 5) for the Apron Chat Protocol. Section numbers (§, Appendix) refer to PROTOCOL.md.',
	' * Generated from src/lib/design/components by scripts/design-dts.js; it documents their props.',
	" * In Svelte, import them from '$lib/design/components'; in any page, components/bundle.js sets window.Apron (bottom of this file). */",
	"import type { Component, Snippet } from 'svelte';",
	"import type { HTMLButtonAttributes } from 'svelte/elements';",
	'',
	sender,
	'',
	types,
	''
];
for (const n of names) {
	const src = readFileSync(`${D}/${n}.svelte`, 'utf8');
	const m = src.match(/interface Props(?: extends ([^{]+))? \{([\s\S]*?)\n\t\}/);
	if (m) {
		out.push(`export interface ${n}Props${m[1] ? ` extends ${m[1].trim()}` : ''} {${m[2].trimEnd()}\n}`);
		out.push(`export declare const ${n}: Component<${n}Props>;\n`);
	} else {
		out.push(`export declare const ${n}: Component<${src.match(/\}?: (\w+) = \$props\(\);/)[1]}>;\n`);
	}
}
out.push(`export interface RenderHandle<P> { props: P; set(patch: Partial<P>): void; destroy(): void }
declare global { interface Window { Apron: {
${names.map((n) => `  ${n}: typeof ${n};\n`).join('')}  /** Mount a component; change \`handle.props.x\` or call \`handle.set({...})\` and it re-renders. */
  render<P extends Record<string, any>>(C: Component<P>, target: Element, props?: P): RenderHandle<P>;
  /** A snippet prop from markup you trust (already rendered and sanitized). */
  html(markup: string): Snippet;
  /** A snippet prop that renders another component. */
  part<P extends Record<string, any>>(C: Component<P>, props?: P): Snippet;
  /** A snippet prop that takes arguments (such as MenuButton's \`lead\`) and renders another component with props made from them. */
  partOf<P extends Record<string, any>>(C: Component<P>, propsOf: (...args: any[]) => P): Snippet<any[]>;
  /** Several snippets in a row, for one snippet prop. */
  parts(...snippets: Snippet[]): Snippet;
} } }
`);
const OUT = 'dist-design/project/components';
mkdirSync(OUT, { recursive: true });
writeFileSync(`${OUT}/index.d.ts`, out.join('\n').replaceAll('\n\t\t', '\n  ').replaceAll('\n\t', '\n  '));
