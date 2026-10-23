<script lang="ts">
	import type { MessageAction } from './types';

	/** How long a `done` action says so before the ⋯ actions close. */
	const DONE_MS = 1200;

	/**
	 * A message's hover toolbar. The rarer actions wait behind ⋯: pass them as `more`, and pressing ⋯ shows them in its
	 * place until one is used; or pass `onmore` to open a menu of your own.
	 */
	interface Props {
		items: MessageAction[];
		more?: MessageAction[];
		onmore?: () => void;
	}
	let { items, more, onmore }: Props = $props();

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

	function showMore(): void {
		if (onmore && !more) onmore();
		else open = true;
	}

	const noAttach = () => {};
</script>

<div class="ap-actions" role="toolbar" aria-label="Message actions">
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
