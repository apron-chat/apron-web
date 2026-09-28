/* Entry for the design system bundle: one classic script that sets window.Apron.
   Built by `npm run design:bundle`; see scripts/design-bundle.js. */
import { createRawSnippet, flushSync, mount, unmount, type Component, type Snippet } from 'svelte';
import * as components from './components';
import SnippetHost from './SnippetHost.svelte';

type Props = Record<string, any>;

/** Mount a component into `target`. Change `handle.props.x = …` (or `handle.set({...})`) and it re-renders.
    Edits made inside a component (a typed draft) are not written back here: listen with its `oninput`. */
function render<P extends Props>(C: Component<P>, target: Element, initial: P = {} as P) {
	const props = $state({ ...initial });
	const instance = mount(C, { target, props });
	// Plain pages read the DOM right after mounting: render synchronously.
	flushSync();
	return {
		props,
		set(patch: Partial<P>) {
			Object.assign(props, patch);
			flushSync();
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
function part<P extends Props>(C: Component<P>, props: P = {} as P): Snippet {
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
	return part(SnippetHost, { snippets });
}

const Apron = { ...components, render, html, part, parts, mount, unmount };

declare global {
	interface Window {
		Apron: typeof Apron;
	}
}
window.Apron = Apron;
