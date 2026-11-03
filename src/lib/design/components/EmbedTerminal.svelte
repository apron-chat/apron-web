<script lang="ts">
	/* terminal (§4.8.6): live while url is set and not done (the consumer writes GET url to its screen), finished once
	   the embed carries output. The screen is the consumer's, through `attach` (such as an xterm.js terminal); without
	   one, `text` shows as plain preformatted text. With `onexpand`, Expand in the header (and, on a touch screen, a tap
	   on the screen) asks to show it full screen, in a TerminalViewer. With `oncopy`, Copy in the header copies the screen's
   text. With `page`, a link in the header opens the stream on a page of its own, in a new tab. Its `class` and `testid` go on its box. */
	import Check from '@lucide/svelte/icons/check';
	import Copy from '@lucide/svelte/icons/copy';
	import ExternalLink from '@lucide/svelte/icons/external-link';
	import Maximize2 from '@lucide/svelte/icons/maximize-2';
	import type { EmbedComponentProps } from './types';

	let props: EmbedComponentProps = $props();
	const live = $derived(!!props.url && !props.done);
	let expandButton = $state<HTMLButtonElement>();

	/** Whether Copy just worked, so it says Copied until the timer clears it. */
	let copied = $state(false);
	let copiedTimer: ReturnType<typeof setTimeout> | undefined;
	$effect(() => () => clearTimeout(copiedTimer));

	async function copy(): Promise<void> {
		if (!(await props.oncopy?.())) return;
		copied = true;
		clearTimeout(copiedTimer);
		copiedTimer = setTimeout(() => (copied = false), 1500);
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

<div data-testid={props.testid} class={['ap-embed', 'ap-embed-terminal', live && 'ap-embed-terminal-live', props.class]}>
	<div class="ap-embed-termhead">
		<span class="ap-embed-termtitle" dir="auto">{props.title || 'Terminal'}</span>
		{#if live}<span class="ap-embed-livebadge" role="status"><i aria-hidden="true"></i>Live</span>
		{:else}<span class="ap-embed-detail">{props.status || 'Finished'}</span>{/if}
		{#if props.oncopy}
			<button type="button" class="ap-iconbtn ap-embed-termbtn ap-embed-termcopy" aria-label={copied ? 'Copied' : 'Copy terminal text'} title={copied ? 'Copied' : 'Copy'} onclick={copy}>
				{#if copied}<Check size={14} aria-hidden="true" />{:else}<Copy size={14} aria-hidden="true" />{/if}
			</button>
		{/if}
		{#if props.page}
			<a href={props.page} target="_blank" rel="noopener noreferrer" class="ap-iconbtn ap-embed-termbtn ap-embed-termopen" aria-label="Open terminal in a new tab" title="Open in a new tab"><ExternalLink size={14} aria-hidden="true" /></a>
		{/if}
		{#if props.onexpand}
			<button bind:this={expandButton} type="button" class="ap-iconbtn ap-embed-termbtn ap-embed-termexpand" aria-label="Expand terminal" aria-haspopup="dialog" title="Expand" onclick={expand}><Maximize2 size={14} aria-hidden="true" /></button>
		{/if}
	</div>
	{#if props.attach}<div class="ap-embed-termscreen" dir="ltr" {@attach props.attach} {@attach tapToExpand}></div>
	{:else}<pre class="ap-embed-termscreen ap-embed-termtext" dir="ltr">{props.text || ''}</pre>{/if}
</div>
