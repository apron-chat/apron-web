<script lang="ts">
	import type { HTMLAttributes } from 'svelte/elements';
	import { chain, roomName, roomNameTip } from './util';

	/**
	 * A mention chip (Appendix A.3). Whether a message mentions someone is `body.mentions` (§3.5), not the chip. Without `onopen` it only reads, such as inside a reply quote, which is itself a control.
	 * Other attributes (`data-*`, `class`, …) go on the chip; `onclick` runs before `onopen`.
	 */
	interface Props extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
		user_id?: string;
		name?: string;
		me?: boolean;
		roomId?: string;
		/** The room's title, where `name` doesn't give it. */
		title?: string;
		/** A room written `#room_id`: its title shows after a #. */
		hash?: boolean;
		/** The room is a thread: without a title it's called "Untitled", and its `room_id` joins the tooltip. */
		thread?: boolean;
		onopen?: () => void;
		unknown?: boolean;
	}
	let { user_id, name, me, roomId, title, hash, thread, onopen, unknown, class: className, ...rest }: Props = $props();
	const id = $derived(roomId || user_id);
	const shown = $derived(roomId ? roomName(name || title, roomId, { thread }) : name || id);
	const tip = $derived(roomId ? roomNameTip(name || title, roomId, { thread }) : undefined);
	const roomClass = $derived(['ap-mention', 'ap-mention-room', hash && 'ap-mention-hash-room', className]);
	const userClass = $derived(['ap-mention', me && 'ap-mention-me', className]);
	const onclick = $derived(chain(onopen, rest.onclick));
	// A room's chip that only reads carries no data-room-id: a click delegated on its ID would open the room.
</script>

{#if roomId && onopen}<button type="button" data-room-id={id} title={tip ? `Open ${shown} (#${tip})` : `Open ${shown}`} {...rest} class={roomClass} {onclick}>{hash ? '#' : ''}{shown}</button>
{:else if roomId}<span title="#{id}" {...rest} class={roomClass}>{hash ? '#' : ''}{shown}</span>
{:else if unknown}<span {...rest} class={['ap-mention-unknown', className]}>@{id}</span>
{:else if onopen}<button type="button" data-user-id={id} title={id !== shown ? '@' + id : undefined} {...rest} class={userClass} {onclick}>@{shown}</button>
{:else}<span data-user-id={id} title={id !== shown ? '@' + id : undefined} {...rest} class={userClass}>@{shown}</span>{/if}
