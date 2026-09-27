<script lang="ts">
	import Button from './Button.svelte';
	import TypingDots from './TypingDots.svelte';

	interface Props {
		count: number;
		threads?: Array<{ thread: string; name?: string }>;
		onmove?: (thread: string) => void;
		onnewthread?: () => void;
		oncancel?: () => void;
		onselectrange?: () => void;
		status?: 'idle' | 'saving';
	}
	let { count, threads = [], onmove, onnewthread, oncancel, onselectrange, status = 'idle' }: Props = $props();
	let open = $state(false);
	const saving = $derived(status === 'saving');
</script>

<div class="ap-selbar" role="toolbar" aria-label="Selected messages">
	<span class="ap-selbar-info">
		<span class="ap-selbar-count">{count === 1 ? '1 message selected' : `${count} messages selected`}</span>
		{#if onselectrange}<button type="button" class="ap-link" onclick={onselectrange} disabled={saving}>Select between</button>{/if}
	</span>
	<span class="ap-selbar-actions">
		{#if saving}
			<span class="ap-selbar-status"><TypingDots />{` Moving ${count}…`}</span>
		{:else}
			<Button size="sm" variant="ghost" onclick={oncancel} label="Cancel" />
			{#if threads.length}
				<span class="ap-selbar-pick">
					<Button size="sm" onclick={() => (open = !open)} aria-haspopup="listbox" aria-expanded={open} disabled={!count} label="Move to thread ▾" />
					{#if open}
						<ul class="ap-menu" role="listbox">
							{#each threads as t (t.thread)}
								<li><button type="button" class="ap-menu-item" role="option" aria-selected="false" onclick={() => { open = false; onmove?.(t.thread); }}>{t.name || t.thread}</button></li>
							{/each}
						</ul>
					{/if}
				</span>
			{/if}
			<Button size="sm" variant="primary" onclick={onnewthread} disabled={!count} label="New thread" />
		{/if}
	</span>
</div>
