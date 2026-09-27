<script lang="ts">
	/** A mention chip (Appendix A.3). Whether a message mentions someone is `body.mentions` (§3.5), not the chip. */
	interface Props {
		user_id?: string;
		name?: string;
		me?: boolean;
		roomId?: string;
		title?: string;
		onopen?: () => void;
		unknown?: boolean;
	}
	let { user_id, name, me, roomId, title, onopen, unknown }: Props = $props();
	const id = $derived(roomId || user_id);
	const shown = $derived(name || title || id);
</script>

{#if roomId}<button type="button" class="ap-mention ap-mention-room" data-room-id={id} onclick={onopen} title="Open {shown}">{shown}</button>
{:else if unknown}<span class="ap-mention-unknown">@{id}</span>
{:else}<span class={['ap-mention', me && 'ap-mention-me']} data-user-id={id} title={id !== shown ? '@' + id : undefined}>@{shown}</span>{/if}
