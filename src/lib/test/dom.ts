import { createRawSnippet, flushSync, mount, tick, unmount as unmountComponent, type Component, type MountOptions, type Snippet } from 'svelte';
import { onTestFinished, vi } from 'vitest';

/**
 * Test support for components in jsdom (`// @vitest-environment jsdom` in a
 * `*.svelte.test.ts` file). `render` mounts a component, flushes its effects,
 * and cleans up after the test by itself: everything it mounted is unmounted
 * and the body emptied once the test's `afterEach` hooks have run.
 *
 *     const root = render(RoomItem, { room: 'general', name: 'General' });
 *     byRole('button', 'General').click();
 */

const mounted = new Map<HTMLElement, ReturnType<typeof mount>[]>();
let cleanupQueued = false;

export interface RenderOptions {
	/** Where to mount. Default a fresh `<div>` appended to the body. */
	target?: HTMLElement;
}

/**
 * Mounts `component` with `props`, flushes, and returns the element it was
 * mounted into. Popovers and dialogs a component moves elsewhere are still
 * found through `document`. Call it from a test or a `beforeEach`, not a
 * `beforeAll`: the cleanup belongs to the test.
 */
export function render<Props extends Record<string, any>>(component: Component<Props, any, any>, props?: Props, options: RenderOptions = {}): HTMLElement {
	const root = options.target ?? document.body.appendChild(document.createElement('div'));
	const instance = mount(component, { target: root, props } as MountOptions<Props>);
	mounted.set(root, [...(mounted.get(root) ?? []), instance]);
	if (!cleanupQueued) {
		cleanupQueued = true;
		onTestFinished(cleanup);
	}
	flushSync();
	return root;
}

/**
 * Unmounts what `render` mounted: all of it, or what went into `root`. The
 * page is left as it is, so a test can render again beside it.
 */
export function unmount(root?: HTMLElement): void {
	for (const [target, instances] of mounted) {
		if (root && target !== root) continue;
		for (const instance of instances) unmountComponent(instance);
		mounted.delete(target);
	}
}

/** What the component `render` mounted last (into `root`) exports, such as a `focus()`. */
export function exportsOf<T extends Record<string, unknown>>(root?: HTMLElement): T {
	const instances = root ? mounted.get(root) : [...mounted.values()].at(-1);
	const instance = instances?.at(-1);
	if (!instance) throw new Error('nothing rendered');
	return instance as T;
}

/** Unmounts everything `render` mounted and empties the body. */
export function cleanup(): void {
	unmount();
	cleanupQueued = false;
	document.body.innerHTML = '';
}

/** A snippet that renders `markup`, for snippet props. */
export function html(markup: string): Snippet {
	return createRawSnippet(() => ({ render: () => markup }));
}

/** An element's accessible name, as far as these tests need it: `aria-label`, else its trimmed text. */
export function nameOf(element: Element): string {
	return element.getAttribute('aria-label') ?? element.textContent?.trim() ?? '';
}

/**
 * The element with this role and accessible name (see `nameOf`), or `null`.
 * A role is matched by its attribute or by the tags that carry it implicitly
 * (`button`, `link`, `textbox`, `checkbox`, `dialog`, `heading`, `listitem`).
 */
export function queryByRole<T extends HTMLElement = HTMLElement>(role: string, name?: string | RegExp, within: ParentNode = document): T | null {
	const selector = [`[role="${role}"]`, ...(IMPLICIT[role] ?? []).map((tag) => `${tag}:not([role])`)].join(', ');
	return [...within.querySelectorAll<T>(selector)].find((element) => name === undefined || (typeof name === 'string' ? nameOf(element) === name : name.test(nameOf(element)))) ?? null;
}

/** `queryByRole`, throwing when nothing matches. */
export function byRole<T extends HTMLElement = HTMLElement>(role: string, name?: string | RegExp, within: ParentNode = document): T {
	const element = queryByRole<T>(role, name, within);
	if (!element) throw new Error(`no ${role}${name === undefined ? '' : ` named ${name}`}`);
	return element;
}

const IMPLICIT: Record<string, string[]> = {
	button: ['button'],
	link: ['a[href]'],
	textbox: ['input:not([type])', 'input[type="text"]', 'input[type="email"]', 'textarea'],
	checkbox: ['input[type="checkbox"]'],
	dialog: ['dialog'],
	heading: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'],
	listitem: ['li']
};

/** The button with this accessible name (see `nameOf`). Throws when there is none. */
export const button = (name: string | RegExp, within?: ParentNode) => byRole<HTMLButtonElement>('button', name, within);

/** Dispatches a bubbling, cancelable `keydown` of `key` at `target`. Returns false when a handler prevented it. */
export function press(target: Element, key: string, init: KeyboardEventInit = {}): boolean {
	return target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
}

/** Dispatches a touch-pointer mouse event (`contextmenu`, `pointerdown`, …) at `target`, at `x`, `y`. */
export function touch(type: string, target: Element, x = 0, y = 0): void {
	const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, detail: 1 });
	Object.defineProperty(event, 'pointerType', { value: 'touch' });
	target.dispatchEvent(event);
}

/** Types `value` into a field as one `input` event, then flushes. */
export function type(element: HTMLInputElement | HTMLTextAreaElement, value: string): void {
	element.value = value;
	element.dispatchEvent(new Event('input'));
	flushSync();
}

/** Submits `form` (default the first on the page) and lets its async handler run. */
export async function submit(form: HTMLFormElement = document.querySelector('form')!): Promise<void> {
	form.requestSubmit();
	await tick();
	await Promise.resolve();
	await tick();
}

/**
 * Gives jsdom's `<dialog>` the modal methods it lacks: `showModal` opens it,
 * `close` closes it and fires `close`. Leaves real ones alone.
 */
export function stubDialog(): void {
	HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.open = true; };
	HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) { this.open = false; this.dispatchEvent(new Event('close')); };
}

/**
 * A `ResizeObserver` that observes nothing, for components that bind sizes
 * (`bind:offsetHeight`), until `vi.unstubAllGlobals()`. Not installed by
 * default: without one, `RoleBadges` skips fitting, which other tests rely on.
 */
export function stubResizeObserver(): void {
	vi.stubGlobal('ResizeObserver', class {
		observe(): void {}
		unobserve(): void {}
		disconnect(): void {}
	});
}
