<script lang="ts">
	import Button from './Button.svelte';

	interface Props {
		/** Title: a `room_set` (cap `rooms`, §4.3.4). `bind:name`. */
		name?: string;
		/** Summary: a `message` save of the intro (cap `edit`, §4.2). `bind:summary`. */
		summary?: string;
		status?: 'idle' | 'saving' | 'declined';
		onsave?: () => void;
		oncancel?: () => void;
	}
	let { name = $bindable(''), summary = $bindable(''), status = 'idle', onsave, oncancel }: Props = $props();
	const saving = $derived(status === 'saving');
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role -->
<form class="ap-tedit" role="dialog" aria-label="Edit thread" onsubmit={(e) => { e.preventDefault(); onsave?.(); }}>
	<label class="ap-fieldlabel">Name
		<input class="ap-field" bind:value={name} disabled={saving} maxlength="120" spellcheck="true" />
	</label>
	<label class="ap-fieldlabel"><span class="ap-fieldlabel-row">Summary<span class="ap-fieldlabel-hint">Markdown</span></span>
		<textarea class="ap-field ap-field-multi" rows="6" bind:value={summary} disabled={saving} spellcheck="true" placeholder="What this thread settled. Lists, links and code are fine."></textarea>
	</label>
	{#if status === 'declined'}<p class="ap-profedit-note ap-profedit-err" role="alert">The server declined the change.</p>{/if}
	<div class="ap-profedit-actions">
		<Button variant="ghost" size="sm" onclick={oncancel} disabled={saving} label="Cancel" />
		<Button type="submit" variant="primary" size="sm" disabled={saving} label={saving ? 'Saving…' : 'Save'} />
	</div>
</form>
