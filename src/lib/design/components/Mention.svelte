<script lang="ts">
	import { roomName, roomNameTip } from './util';

	/** A mention chip (Appendix A.3). Whether a message mentions someone is `body.mentions` (§3.5), not the chip. Without `onopen` it only reads, such as inside a reply quote, which is itself a control. */
	interface Props {
		user_id?: string;
		name?: string;
		me?: boolean;
		roomId?: string;
		title?: string;
		/** A room written `#room_id`: its title shows after a #. */
		hash?: boolean;
		/** The room is a thread: without a title it's called "Untitled", and its `room_id` joins the tooltip. */
		thread?: boolean;
		onopen?: () => void;
		unknown?: boolean;
	}
	let { user_id, name, me, roomId, title, hash, thread, onopen, unknown }: Props = $props();
	const id = $derived(roomId || user_id);
	const shown = $derived(roomId ? roomName(name || title, roomId, { thread }) : name || id);
	const tip = $derived(roomId ? roomNameTip(name || title, roomId, { thread }) : undefined);
	const roomClass = $derived(['ap-mention', 'ap-mention-room', hash && 'ap-mention-hash-room']);
	// A room's chip that only reads carries no data-room-id: a click delegated on its ID would open the room.
</script>

{#if roomId && onopen}<button type="button" class={roomClass} data-room-id={id} onclick={onopen} title={tip ? `Open ${shown} (#${tip})` : `Open ${shown}`}>{hash ? '#' : ''}{shown}</button>
{:else if roomId}<span class={roomClass} title="#{id}">{hash ? '#' : ''}{shown}</span>
{:else if unknown}<span class="ap-mention-unknown">@{id}</span>
{:else if onopen}<button type="button" class={['ap-mention', me && 'ap-mention-me']} data-user-id={id} onclick={onopen} title={id !== shown ? '@' + id : undefined}>@{shown}</button>
{:else}<span class={['ap-mention', me && 'ap-mention-me']} data-user-id={id} title={id !== shown ? '@' + id : undefined}>@{shown}</span>{/if}
