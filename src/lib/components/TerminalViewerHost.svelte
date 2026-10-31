<script lang="ts">
	import { untrack } from 'svelte';
	import { pushState } from '$app/navigation';
	import { page } from '$app/state';
	import TerminalViewer from '$lib/design/components/TerminalViewer.svelte';
	import { TerminalScreen, VIEWER_FIT, VIEWER_SCROLLBACK } from '$lib/ui/terminal-screen';
	import { terminalViewer } from '$lib/ui/terminal-viewer.svelte';

	/**
	 * The one terminal viewer, mounted once outside the timeline; a terminal embed's Expand opens it
	 * (`terminalViewer.show`). Its screen is a `TerminalScreen` of its own, fitted to the viewer (`VIEWER_FIT`), fed by
	 * the embed's `TerminalFeed`: the text so far, then what arrives, from the embed's one read of the live text. Unlike
	 * the message's, it keeps `VIEWER_SCROLLBACK` lines to scroll back through, with the wheel, a swipe, or the arrows,
	 * Page Up and Down, Home and End wherever focus is in the viewer: the screen still takes no input.
	 * Open, it is a history entry of its own (`page.state.terminal`, marked with when it opened), so Back closes it.
	 */
	let view = $derived(terminalViewer.view);
	/** The history entry opening it pushed, which closing it leaves; 0 for none. */
	let entry = 0;

	$effect(() => {
		if (!terminalViewer.open) return;
		untrack(() => {
			if (entry) return;
			const mark = Date.now();
			try {
				pushState('', { ...page.state, terminal: mark });
				entry = mark;
			} catch {
				// The router isn't started yet (in development): it just isn't an entry Back leaves.
			}
		});
	});

	// Back (or anything else that leaves its entry) closes it.
	$effect(() => {
		const here = page.state.terminal;
		untrack(() => {
			if (entry && here !== entry) {
				entry = 0;
				terminalViewer.open = false;
			}
		});
	});

	function closed(): void {
		if (entry) {
			const onEntry = page.state.terminal === entry;
			entry = 0;
			if (onEntry) history.back();
		}
		terminalViewer.closed();
	}

	function attach(box: HTMLElement): (() => void) | undefined {
		const feed = view?.feed;
		if (!feed) return undefined;
		const screen = new TerminalScreen(box, { fit: VIEWER_FIT, space: box.parentElement ?? box, scrollback: VIEWER_SCROLLBACK, keys: box.closest('dialog') ?? undefined });
		const detach = feed.attach(screen);
		return () => {
			detach();
			screen.dispose();
		};
	}
</script>

{#if view}
	<TerminalViewer bind:open={terminalViewer.open} title={view.title} live={view.live} status={view.status} {attach} onclose={closed} testid="terminal-viewer" />
{/if}
