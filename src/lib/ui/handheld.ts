/**
 * A phone or tablet: touch first, with no pointer that hovers. Mobile apps
 * are the model there, for a hidden page and for the keyboard alike.
 */
export function handheld(): boolean {
	return typeof matchMedia === 'function' && matchMedia('(hover: none) and (pointer: coarse)').matches;
}

/** What Enter does in the composer and the message editor: the design system's rule, which both follow. */
export { enterAction } from '$lib/design/components/compose';
