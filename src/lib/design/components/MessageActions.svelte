<script lang="ts">
	import { tick } from 'svelte';
	import { check, ellipsis } from './ActionIcons.svelte';
	import type { MessageAction } from './types';

	/** How long a `done` action says so before the ⋯ actions close. */
	const DONE_MS = 1200;

	/**
	 * A message's hover toolbar. The rarer actions wait behind ⋯: pass them as `more`, and pressing ⋯ shows them in its
	 * place until one is used; or pass `onmore` to open a menu of your own. `touch` sizes it for a finger, and ⋯ then
	 * opens every action as a menu, one row each. `quick` go first, set apart, and stay in a row of their own atop
	 * that menu: one-press reactions, such as the emoji you used last.
	 */
	interface Props {
		quick?: MessageAction[];
		items: MessageAction[];
		more?: MessageAction[];
		onmore?: () => void;
		touch?: boolean;
	}
	let { quick = [], items, more, onmore, touch = false }: Props = $props();

	let open = $state(false);
	/** The `id` of the action that worked, saying so (Copied) until the timer closes the ⋯ actions. */
	let done = $state<string | undefined>();
	let timer: ReturnType<typeof setTimeout> | undefined;
	$effect(() => () => clearTimeout(timer));

	const visible = (list: MessageAction[] | undefined) => (list ?? []).filter((it) => it && !it.hidden);
	const shown = $derived([...visible(items), ...(open ? visible(more) : [])]);
	const quickShown = $derived(visible(quick));
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

	// A press anywhere else puts the rest away, as it would any menu, rather than leaving them for the next hover.
	$effect(() => {
		if (!open) return;
		const away = (event: PointerEvent) => {
			if (!bar?.contains(event.target as Node)) open = false;
		};
		document.addEventListener('pointerdown', away, true);
		return () => document.removeEventListener('pointerdown', away, true);
	});

	/** ⋯ goes as the rest show, so the focus it held moves on to the first of them rather than dropping out. */
	function showMore(event: MouseEvent): void {
		if (onmore && !more) return onmore();
		const focused = event.currentTarget === document.activeElement;
		open = true;
		if (focused) void tick().then(() => bar?.querySelectorAll<HTMLElement>('.ap-actions-btn:not(.ap-actions-emoji)')[visible(items).length]?.focus());
	}

	const noAttach = () => {};

	/**
	 * A press of the mouse while the keyboard is on the message or in its toolbar, its words showing (apron.css): the
	 * focus stays put, so they do too. Focus going to the button pressed would take them away, and the toolbar would
	 * shrink between the press and the release, which would then land on another button and click none.
	 */
	function mousedown(event: MouseEvent): void {
		if (touch || event.button !== 0 || !bar) return;
		try {
			if (bar.closest('.ap-msg')?.matches(':focus-visible') || bar.querySelector(':focus-visible')) event.preventDefault();
		} catch {
			// No :focus-visible here: no words for the keyboard either.
		}
	}

	/**
	 * Touch's menu: a row each, its icon beside its words. Elsewhere an action with an icon shows the icon alone, its
	 * words (in the markup, for the keyboard) showing beside it only while the keyboard is on the message (apron.css).
	 */
	const menu = $derived(touch && open);
	/** The tooltip: its name, and its key. */
	const tip = (it: MessageAction) => {
		const name = it.title ?? (it.icon ? it.label : undefined);
		return name && it.key ? `${name} (${it.key})` : name;
	};
</script>

<!-- svelte-ignore a11y_interactive_supports_focus (its buttons are the stops; the mousedown only keeps focus where it is) -->
<div bind:this={bar} class={['ap-actions', touch && 'ap-actions-touch', touch && open && 'ap-actions-menu']} role="toolbar" aria-label="Message actions" aria-orientation={menu ? 'vertical' : undefined} onmousedown={mousedown}>
	{#if quickShown.length}
		<div class="ap-actions-quick" role="group" aria-label="Quick reactions">
			{#each quickShown as it (it.id ?? it.label)}
				<button class="ap-actions-btn ap-actions-emoji" type="button" aria-label={it.label} aria-pressed={Boolean(it.pressed)} title={it.title} onclick={(event) => press(it, event)}>{it.glyph}</button>
			{/each}
		</div>
		<span class="ap-actions-sep" aria-hidden="true"></span>
	{/if}
	{#each shown as it (it.id ?? it.label)}
		{@const said = it.done && done === (it.id ?? it.label) ? it.done : undefined}
		{@const icon = said && it.icon ? check : it.icon}
		<button
			class={['ap-actions-btn', it.danger && 'ap-actions-danger', icon && (menu ? 'ap-actions-row' : 'ap-actions-icon')]}
			type="button"
			data-testid={it.testid}
			aria-label={said?.label ?? it.label}
			aria-keyshortcuts={it.key?.toLowerCase()}
			data-key={touch ? undefined : it.key}
			title={menu ? undefined : tip(it)}
			aria-haspopup={it.popup ? 'dialog' : undefined}
			aria-expanded={it.popup ? Boolean(it.expanded) : undefined}
			{@attach it.attach ?? noAttach}
			onclick={(event) => press(it, event)}
		>{#if icon}{@render icon()}<span class="ap-actions-label">{said ? (said.glyph ?? said.label) : (it.glyph ?? it.label)}</span>{:else}{said ? (said.glyph ?? said.label) : (it.glyph ?? it.label)}{/if}</button>
	{/each}
	{#if hasMore}<button class="ap-actions-btn ap-actions-icon" type="button" aria-label="More actions" aria-expanded="false" title="More" onclick={showMore}>{@render ellipsis()}</button>{/if}
</div>
