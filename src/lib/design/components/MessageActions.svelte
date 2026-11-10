<script lang="ts">
	import { tick } from 'svelte';
	import { check, ellipsis } from './ActionIcons.svelte';
	import type { MessageAction } from './types';

	/** How long a `done` action says so before the ⋯ actions close. */
	const DONE_MS = 1200;

	/**
	 * A message's hover toolbar. The rarer actions wait behind ⋯: pass them as `more`, and pressing ⋯ opens every action
	 * as a menu, one row each, its icon beside its words, until one is used, a press elsewhere or Escape; or pass
	 * `onmore` to open a menu of your own. `touch` sizes it for a finger. `quick` go first, set apart, and keep a row of
	 * their own atop the menu: one-press reactions, such as the emoji you used last.
	 */
	interface Props {
		quick?: MessageAction[];
		items: MessageAction[];
		more?: MessageAction[];
		onmore?: () => void;
		touch?: boolean;
		/** Whose actions these are, where one toolbar serves many (the dock): a new one starts with ⋯ shut and nothing done. */
		owner?: unknown;
	}
	let { quick = [], items, more, onmore, touch = false, owner }: Props = $props();

	/** Whose actions these are: `owner`, else this toolbar's own. */
	const self = {};
	const whose = $derived(owner ?? self);
	/** Whose ⋯ is open, so the next owner's starts shut. */
	let openFor = $state.raw<unknown>();
	const open = $derived(openFor !== undefined && openFor === whose);
	/** The action that worked, and whose, saying so (Copied) until the timer closes the ⋯ actions. */
	let doneFor = $state.raw<{ owner: unknown; id: string }>();
	const done = $derived(doneFor?.owner === whose ? doneFor.id : undefined);
	let timer: ReturnType<typeof setTimeout> | undefined;
	$effect(() => () => clearTimeout(timer));

	const visible = (list: MessageAction[] | undefined) => (list ?? []).filter((it) => it && !it.hidden);
	const shown = $derived([...visible(items), ...(open ? visible(more) : [])]);
	const quickShown = $derived(visible(quick));
	const hasMore = $derived(!open && (visible(more).length > 0 || Boolean(onmore)));

	async function press(it: MessageAction, event: MouseEvent): Promise<void> {
		// Whose press this is, before the await: the toolbar may serve another owner by the time it resolves.
		const mine = whose;
		if (!it.done) openFor = undefined;
		const result = it.onclick?.(event);
		if (!it.done) return;
		if (!(await result)) {
			if (openFor === mine) openFor = undefined;
			return;
		}
		clearTimeout(timer);
		doneFor = { owner: mine, id: it.id ?? it.label };
		// Its owner's Copied and menu only: where one toolbar serves many (the dock), the next owner's are its own.
		timer = setTimeout(() => {
			if (doneFor?.owner === mine) doneFor = undefined;
			if (openFor === mine) openFor = undefined;
		}, DONE_MS);
	}

	let bar = $state<HTMLElement | undefined>();

	/**
	 * While the menu is open, a press anywhere else or Escape anywhere puts it away, as any menu's would, rather than
	 * leaving it for the next hover (where one toolbar serves many, a menu left open would keep it from the rest). Escape
	 * comes here first, before a message's or the timeline's own, and gives ⋯ the keyboard if it was in the menu.
	 */
	$effect(() => {
		if (!open) return;
		const away = (event: PointerEvent) => {
			if (!bar?.contains(event.target as Node)) openFor = undefined;
		};
		const escape = (event: KeyboardEvent) => {
			if (event.key !== 'Escape') return;
			event.preventDefault();
			event.stopPropagation();
			const inside = bar?.contains(document.activeElement);
			openFor = undefined;
			if (inside) void tick().then(() => bar?.querySelector<HTMLElement>('[aria-label="More actions"]')?.focus());
		};
		document.addEventListener('pointerdown', away, true);
		document.addEventListener('keydown', escape, true);
		return () => {
			document.removeEventListener('pointerdown', away, true);
			document.removeEventListener('keydown', escape, true);
		};
	});

	/**
	 * Focus leaving the toolbar with the menu open puts the menu away (Tab on to the composer, say). A focused button
	 * taken out (⋯ as the menu opens) blurs too, but focus hasn't left: that one is gone once this settles.
	 */
	function focusout(event: FocusEvent): void {
		if (!open || (event.relatedTarget instanceof Node && bar?.contains(event.relatedTarget))) return;
		const from = event.target as Node;
		queueMicrotask(() => {
			if (from.isConnected && !bar?.contains(document.activeElement)) openFor = undefined;
		});
	}

	/** ⋯ goes as the rest show, so the focus it held moves on to the first of them rather than dropping out. */
	function showMore(event: MouseEvent): void {
		if (onmore && !more) return onmore();
		const focused = event.currentTarget === document.activeElement;
		openFor = whose;
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
	 * The menu ⋯ opens: a row each, its icon beside its words. Elsewhere an action with an icon shows the icon, its words
	 * (in the markup) beside it where the pane is wide or the keyboard is on the message (apron.css).
	 */
	const menu = $derived(open);

	/** The tooltip: its name, and its key. */
	const tip = (it: MessageAction) => {
		const name = it.title ?? (it.icon ? it.label : undefined);
		return name && it.key ? `${name} (${it.key})` : name;
	};
</script>

<!-- svelte-ignore a11y_interactive_supports_focus (its buttons are the stops; the mousedown only keeps focus where it is) -->
<div bind:this={bar} class={['ap-actions', touch && 'ap-actions-touch', menu && 'ap-actions-menu']} role="toolbar" aria-label="Message actions" aria-orientation={menu ? 'vertical' : undefined} onmousedown={mousedown} onfocusout={focusout}>
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
