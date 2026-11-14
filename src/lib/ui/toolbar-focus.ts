/**
 * One Tab stop for a horizontal toolbar (WAI-ARIA's toolbar pattern): the arrows move between its buttons across
 * all its groups, wrapping at the ends and reversed right to left, and Home and End go to the first and last.
 *
 * The toolbar says `focusgroup="toolbar wrap"`, which browsers that have focusgroup do all this for. Where one
 * doesn't, this attachment does: it keeps `tabindex="0"` on the button last focused (so Tab comes back to it)
 * and `-1` on the rest. It does nothing where focusgroup is native, so the two never both run.
 */
export function rovingToolbar(bar: HTMLElement): (() => void) | undefined {
	if (typeof HTMLElement !== 'undefined' && 'focusGroup' in HTMLElement.prototype) return undefined;
	const buttons = () => [...bar.querySelectorAll<HTMLButtonElement>('button')];
	/** Its one Tab stop, disabled or not: they're disabled together, and the stop stays put for when they're not. */
	const rove = (to: HTMLElement) => {
		for (const item of buttons()) item.tabIndex = item === to ? 0 : -1;
	};
	const first = buttons()[0];
	if (first) rove(first);

	const focusin = (event: FocusEvent) => {
		if (event.target instanceof HTMLButtonElement) rove(event.target);
	};
	const keydown = (event: KeyboardEvent) => {
		if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
		const all = buttons().filter((item) => !item.disabled);
		const at = all.indexOf(document.activeElement as HTMLButtonElement);
		if (at < 0) return;
		const rtl = getComputedStyle(bar).direction === 'rtl';
		const step: Record<string, number> = { ArrowRight: rtl ? -1 : 1, ArrowLeft: rtl ? 1 : -1 };
		const to = event.key === 'Home' ? 0 : event.key === 'End' ? all.length - 1 : event.key in step ? (at + step[event.key] + all.length) % all.length : undefined;
		if (to === undefined) return;
		event.preventDefault();
		all[to].focus();
	};
	bar.addEventListener('focusin', focusin);
	bar.addEventListener('keydown', keydown);
	return () => {
		bar.removeEventListener('focusin', focusin);
		bar.removeEventListener('keydown', keydown);
	};
}
