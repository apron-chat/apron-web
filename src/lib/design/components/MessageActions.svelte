<script lang="ts">
	import { tick } from 'svelte';
	import type { MessageAction } from './types';

	/** How long a `done` action says so before the ⋯ actions close. */
	const DONE_MS = 1200;

	/**
	 * A message's hover toolbar. The rarer actions wait behind ⋯: pass them as `more`, and pressing ⋯ shows them in its
	 * place until one is used; or pass `onmore` to open a menu of your own. `touch` sizes it for a finger, and ⋯ then
	 * opens every action as a menu, one row each.
	 */
	interface Props {
		items: MessageAction[];
		more?: MessageAction[];
		onmore?: () => void;
		touch?: boolean;
	}
	let { items, more, onmore, touch = false }: Props = $props();

	let open = $state(false);
	/** The `id` of the action that worked, saying so (Copied) until the timer closes the ⋯ actions. */
	let done = $state<string | undefined>();
	let timer: ReturnType<typeof setTimeout> | undefined;
	$effect(() => () => clearTimeout(timer));

	const visible = (list: MessageAction[] | undefined) => (list ?? []).filter((it) => it && !it.hidden);
	const shown = $derived([...visible(items), ...(open ? visible(more) : [])]);
	const hasMore = $derived(!open && (visible(more).length > 0 || Boolean(onmore)));

	async function press(it: MessageAction, event: MouseEvent): Promise<void> {
		if (!it.done) open = false;
		const result = it.onclick?.(event);
		if (!it.done) return;
		if (!(await result)) {
			open = false;
			return;
		}
		clearTimeout(timer);
		done = it.id ?? it.label;
		timer = setTimeout(() => {
			done = undefined;
			open = false;
		}, DONE_MS);
	}

	let bar = $state<HTMLElement | undefined>();

	/** ⋯ goes as the rest show, so the focus it held moves on to the first of them rather than dropping out. */
	function showMore(event: MouseEvent): void {
		if (onmore && !more) return onmore();
		const focused = event.currentTarget === document.activeElement;
		open = true;
		if (focused) void tick().then(() => bar?.querySelectorAll<HTMLElement>('.ap-actions-btn')[visible(items).length]?.focus());
	}

	const noAttach = () => {};
</script>

<div bind:this={bar} class={['ap-actions', touch && 'ap-actions-touch', touch && open && 'ap-actions-menu']} role="toolbar" aria-label="Message actions" aria-orientation={touch && open ? 'vertical' : undefined}>
	{#each shown as it (it.id ?? it.label)}
		{@const said = it.done && done === (it.id ?? it.label) ? it.done : undefined}
		<button
			class={['ap-actions-btn', it.danger && 'ap-actions-danger']}
			type="button"
			data-testid={it.testid}
			aria-label={said?.label ?? it.label}
			title={it.title}
			aria-haspopup={it.popup ? 'dialog' : undefined}
			aria-expanded={it.popup ? Boolean(it.expanded) : undefined}
			{@attach it.attach ?? noAttach}
			onclick={(event) => press(it, event)}
		>{said ? (said.glyph ?? said.label) : (it.glyph ?? it.label)}</button>
	{/each}
	{#if hasMore}<button class="ap-actions-btn" type="button" aria-label="More actions" aria-expanded="false" title="More" onclick={showMore}>⋯</button>{/if}
</div>
