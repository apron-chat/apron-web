<script lang="ts">
	import Button from './Button.svelte';
	import TypingDots from './TypingDots.svelte';

	interface Props {
		count: number;
		threads?: Array<{ thread: string; name?: string }>;
		/** In a thread: its parent room's ID, offered first in the menu as Move to room. */
		room?: string;
		/** Called with the chosen thread's ID, or with `room`. */
		onmove?: (thread: string) => void;
		/** Shows New thread; leave out when you can't create threads (capability `rooms`). */
		onnewthread?: () => void;
		oncancel?: () => void;
		/** Shows Select between, which fills the gap between the outermost picks; leave out when there's no gap to fill. */
		onselectrange?: () => void;
		status?: 'idle' | 'saving';
		/** After a move the server partly refused: how many of the picked messages it refused, of how many. */
		denied?: { failed: number; total: number };
		/** Whether the Move to thread menu is open. Bindable, so you can close it yourself (on Escape, or once a move starts). */
		open?: boolean;
		/** `data-testid` on the bar. */
		testid?: string;
		/** `data-testid` on New thread. */
		newThreadTestid?: string;
	}
	let { count, threads = [], room, onmove, onnewthread, oncancel, onselectrange, status = 'idle', denied, open = $bindable(false), testid, newThreadTestid }: Props = $props();
	const saving = $derived(status === 'saving');
	const hasMenu = $derived(threads.length > 0 || room !== undefined);

	function move(target: string) {
		open = false;
		onmove?.(target);
	}
</script>

<div class="ap-selbar" role="toolbar" aria-label="Selected messages" data-testid={testid}>
	<span class="ap-selbar-info">
		<span class="ap-selbar-count">{count === 1 ? '1 message selected' : `${count} messages selected`}</span>
		{#if onselectrange}<button type="button" class="ap-link" onclick={onselectrange} disabled={saving}>Select between</button>{/if}
		{#if denied}<span class="ap-selbar-denied" role="alert">{denied.failed} of {denied.total} couldn’t be moved</span>{/if}
	</span>
	<span class="ap-selbar-actions">
		{#if saving}
			<span class="ap-selbar-status" role="status"><TypingDots />{` Moving ${count}…`}</span>
		{:else}
			<Button size="sm" variant="ghost" onclick={oncancel} label="Cancel" />
			{#if hasMenu}
				<span class="ap-selbar-pick">
					<Button size="sm" onclick={() => (open = !open)} aria-haspopup="listbox" aria-expanded={open} disabled={!count} label="Move to thread ▾" />
					{#if open}
						<ul class="ap-menu" role="listbox" aria-label="Move to thread">
							{#if room !== undefined}
								<li><button type="button" class="ap-menu-item" role="option" aria-selected="false" onclick={() => move(room)}>Move to room</button></li>
							{/if}
							{#each threads as t (t.thread)}
								<li><button type="button" class="ap-menu-item" role="option" aria-selected="false" data-thread={t.thread} onclick={() => move(t.thread)}>{t.name || t.thread}</button></li>
							{/each}
						</ul>
					{/if}
				</span>
			{/if}
			{#if onnewthread}<Button size="sm" variant="primary" onclick={onnewthread} disabled={!count} data-testid={newThreadTestid} label="New thread" />{/if}
		{/if}
	</span>
</div>
