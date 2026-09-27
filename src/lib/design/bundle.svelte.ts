/* Entry for the design system bundle: one classic script that sets window.Apron.
   Built by `npm run design:bundle`; see scripts/design-bundle.js. */
import { createRawSnippet, mount, unmount, type Component, type Snippet } from 'svelte';
import * as components from './components';

type Props = Record<string, unknown>;

/** Mount a component into `target`. Change `handle.props.x = …` (or `handle.set({...})`) and it re-renders. */
function render(C: Component<any>, target: Element, initial: Props = {}) {
	const props = $state({ ...initial });
	const instance = mount(C, { target, props });
	return {
		props,
		set(patch: Props) {
			Object.assign(props, patch);
		},
		destroy() {
			unmount(instance);
		}
	};
}

/** A snippet prop from markup you trust (already rendered and sanitized), for `children`, `footer`, `action`… */
function html(markup: string): Snippet {
	return createRawSnippet(() => ({ render: () => `<span style="display:contents">${markup}</span>` }));
}

/** A snippet prop that renders another component: `footer: Apron.part(Apron.ThreadMarker, { thread: 'deploy' })`. */
function part(C: Component<any>, props: Props = {}): Snippet {
	return createRawSnippet(() => ({
		render: () => '<span style="display:contents"></span>',
		setup(el) {
			const instance = mount(C, { target: el, props });
			return () => unmount(instance);
		}
	}));
}

/** Several snippets in a row, for one snippet prop. */
function parts(...snippets: Snippet[]): Snippet {
	return createRawSnippet(() => ({
		render: () => '<span style="display:contents"></span>',
		setup(el) {
			const cleanups = snippets.map((s) => {
				const host = document.createElement('span');
				host.style.display = 'contents';
				el.appendChild(host);
				// Render each snippet through a tiny host component.
				const instance = mount(SnippetHost, { target: host, props: { snippet: s } });
				return () => unmount(instance);
			});
			return () => cleanups.forEach((c) => c());
		}
	}));
}

import SnippetHost from './SnippetHost.svelte';

const Apron = { ...components, render, html, part, parts, mount, unmount };
(window as unknown as { Apron: typeof Apron }).Apron = Apron;
