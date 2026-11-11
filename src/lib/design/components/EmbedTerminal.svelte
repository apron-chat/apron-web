<script lang="ts">
	/* terminal (§4.8.6): live while url is set and not done (the consumer writes GET url to its screen), finished once
	   the embed carries output. The screen is the consumer's, through `attach` (such as an xterm.js terminal); without
	   one, `text` shows as plain preformatted text. With `onexpand`, Expand in the header (and, on a touch screen, a tap
	   on the screen) asks to show it full screen, in a TerminalViewer. With `oncopy`, Copy in the header (a CopyButton)
	   copies the screen's text. With `page`, a link in the header opens the stream on a page of its own, in a new tab.
	   Its `class` and `testid` go on its box. */
	import ExternalLink from '@lucide/svelte/icons/external-link';
	import Eye from '@lucide/svelte/icons/eye';
	import Maximize2 from '@lucide/svelte/icons/maximize-2';
	import X from '@lucide/svelte/icons/x';
	import { tick } from 'svelte';
	import CopyButton from './CopyButton.svelte';
	import type { EmbedComponentProps } from './types';

	let props: EmbedComponentProps = $props();
	const live = $derived(!!props.url && !props.done && !props.closed);
	let expandButton = $state<HTMLButtonElement>();
	let closeButton = $state<HTMLButtonElement>();
	let showButton = $state<HTMLButtonElement>();

	/** Close, then Show: focus moves to the one that took the other's place, so it isn't lost with the button pressed. */
	async function toggle(press: (() => void) | undefined, next: () => HTMLButtonElement | undefined): Promise<void> {
		press?.();
		await tick();
		next()?.focus();
	}

	function expand(): void {
		if (expandButton) props.onexpand?.(expandButton);
	}

	/** On a touch screen a tap on the screen expands it, as Expand does; a mouse keeps selecting its text. */
	function tapToExpand(screen: HTMLElement): (() => void) | undefined {
		if (!props.onexpand) return undefined;
		let touch = false;
		const down = (event: PointerEvent) => (touch = event.pointerType === 'touch');
		const click = () => {
			if (touch) expand();
			touch = false;
		};
		// Captured, so the terminal drawn inside can't keep them from the box.
		screen.addEventListener('pointerdown', down, { capture: true, passive: true });
		screen.addEventListener('click', click, { capture: true });
		return () => {
			screen.removeEventListener('pointerdown', down, { capture: true });
			screen.removeEventListener('click', click, { capture: true });
		};
	}
</script>

<div data-testid={props.testid} class={['ap-embed', 'ap-embed-terminal', live && 'ap-embed-terminal-live', props.closed && 'ap-embed-terminal-closed', props.class]}>
	<div class="ap-embed-termhead">
		<span class="ap-embed-termtitle" dir="auto">{props.title || 'Terminal'}</span>
		{#if live}<span class="ap-embed-livebadge" role="status"><i aria-hidden="true"></i>Live</span>
		{:else}<span class="ap-embed-detail">{props.closed ? 'Closed' : props.status || 'Finished'}</span>{/if}
		{#if props.oncopy && !props.closed}<CopyButton oncopy={props.oncopy} label="Copy terminal text" class="ap-embed-termbtn ap-embed-termcopy" />{/if}
		{#if props.page}
			<a href={props.page} target="_blank" rel="noopener noreferrer" class="ap-iconbtn ap-embed-termbtn ap-embed-termopen" aria-label="Open terminal in a new tab" title="Open in a new tab"><ExternalLink size={14} aria-hidden="true" /></a>
		{/if}
		{#if props.onexpand && !props.closed}
			<button bind:this={expandButton} type="button" class="ap-iconbtn ap-embed-termbtn ap-embed-termexpand" aria-label="Expand terminal" aria-haspopup="dialog" title="Expand" onclick={expand}><Maximize2 size={14} aria-hidden="true" /></button>
		{/if}
		{#if props.closed}
			{#if props.onshow}<button bind:this={showButton} type="button" class="ap-iconbtn ap-embed-termbtn ap-embed-termshow" aria-label="Show terminal" title="Show" onclick={() => toggle(props.onshow, () => closeButton)}><Eye size={14} aria-hidden="true" /></button>{/if}
		{:else if props.onclose}
			<button bind:this={closeButton} type="button" class="ap-iconbtn ap-embed-termbtn ap-embed-termclose" aria-label="Close terminal" title="Close" onclick={() => toggle(props.onclose, () => showButton)}><X size={14} aria-hidden="true" /></button>
		{/if}
	</div>
	{#if props.closed}<!-- Closed: no screen, so nothing draws or reads the stream. -->
	{:else if props.attach}<div class="ap-embed-termscreen" dir="ltr" {@attach props.attach} {@attach tapToExpand}></div>
	{:else}<pre class="ap-embed-termscreen ap-embed-termtext" dir="ltr">{props.text || ''}</pre>{/if}
</div>
