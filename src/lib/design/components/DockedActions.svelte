<script module lang="ts">
	import type { MessageAction } from './types';
	import type { DockedBar } from './message-dock.svelte';

	/**
	 * How each of an action's fields counts when a button is kept for another row: its `look` must agree, its `press` is
	 * taken from the new row. Typed over every field, so a field added to MessageAction is a type error until it's put
	 * here: left out, a kept button could show another row's.
	 */
	const FIELDS: { [K in keyof Required<MessageAction>]: 'look' | 'press' } = {
		id: 'look', label: 'look', glyph: 'look', icon: 'look', key: 'look', title: 'look', done: 'look', pressed: 'look',
		popup: 'look', expanded: 'look', attach: 'look', testid: 'look', danger: 'look', hidden: 'look', onclick: 'press'
	};
	const LOOK = (Object.keys(FIELDS) as (keyof MessageAction)[]).filter((field) => FIELDS[field] === 'look' && field !== 'done');

	/** What a button shows and how it's wired, all but its press: two rows whose actions agree here draw the same button. */
	function sameLook(a: MessageAction, b: MessageAction): boolean {
		for (const field of LOOK) if (a[field] !== b[field]) return false;
		return a.done?.label === b.done?.label && a.done?.glyph === b.done?.glyph;
	}

	/**
	 * `next`, keeping each of `last`'s actions that looks the same (its press taken from `next`, read as it's pressed),
	 * and `last` itself where every one is kept, as `steady` keeps the timeline's rows: moving to another row then
	 * redraws only the buttons that differ there.
	 */
	function steadyList(last: MessageAction[] | undefined, next: MessageAction[] | undefined): MessageAction[] | undefined {
		if (!last || !next) return next;
		let kept = last.length === next.length;
		const list = next.map((action, i) => {
			const old = last[i];
			if (!old || !sameLook(old, action)) return ((kept = false), action);
			old.onclick = action.onclick;
			return old;
		});
		return kept ? last : list;
	}

	function steady(last: DockedBar | undefined, next: DockedBar | undefined): DockedBar | undefined {
		if (!last || !next) return next;
		const quick = steadyList(last.quick, next.quick)!;
		const items = steadyList(last.items, next.items)!;
		const more = steadyList(last.more, next.more);
		return quick === last.quick && items === last.items && more === last.more && next.touch === last.touch ? last : { quick, items, more, touch: next.touch };
	}
</script>

<script lang="ts">
	import MessageActions from './MessageActions.svelte';
	import type { messageDock } from './message-dock.svelte';

	/** The dock's toolbar (`message-dock.svelte.ts`): the actions of the row that holds it, or nothing. */
	let { dock }: { dock: typeof messageDock } = $props();
	let last: DockedBar | undefined;
	const bar = $derived((last = steady(last, dock.owner?.bar())));
</script>

{#if bar}<MessageActions quick={bar.quick} items={bar.items} more={bar.more} touch={bar.touch} owner={dock.owner} />{/if}
