<script lang="ts">
	import type { ClassValue } from 'svelte/elements';
	import { roomName, roomNameTip } from './util';

	/**
	 * A mention chip (Appendix A.3), or with `role` a role's (`@&role`): everyone in the room who held it when it was sent. Whether a message mentions someone is `body.mentions` (§3.5), not the chip. Without `onopen` it only reads, such as inside a reply quote, which is itself a control.
	 */
	interface Props {
		user_id?: string;
		/** A role (§3.3.4), shown `@role`. */
		role?: string;
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
		/** Classes for the chip, added to its own. */
		class?: ClassValue;
	}
	let { user_id, role, name, me, roomId, title, hash, thread, onopen, unknown, class: className }: Props = $props();
	const id = $derived(roomId || user_id);
	const shown = $derived(roomId ? roomName(name || title, roomId, { thread }) : name || id);
	const tip = $derived(roomId ? roomNameTip(name || title, roomId, { thread }) : undefined);
	const roomClass = $derived(['ap-mention', 'ap-mention-room', hash && 'ap-mention-hash-room', className]);
	const userClass = $derived(['ap-mention', me && 'ap-mention-me', className]);
	// A room's chip that only reads carries no data-room-id: a click delegated on its ID would open the room.
</script>

{#if role}<span title="Everyone with the role {role}" class={['ap-mention', 'ap-mention-role', className]}>@{role}</span>
{:else if roomId && onopen}<button type="button" data-room-id={id} title={tip ? `Open ${shown} (#${tip})` : `Open ${shown}`} class={roomClass} onclick={onopen}>{hash ? '#' : ''}{shown}</button>
{:else if roomId}<span title="#{id}" class={roomClass}>{hash ? '#' : ''}{shown}</span>
{:else if unknown}<span class={['ap-mention-unknown', className]}>@{id}</span>
{:else if onopen}<button type="button" data-user-id={id} title={id !== shown ? '@' + id : undefined} class={userClass} onclick={onopen}>@{shown}</button>
{:else}<span data-user-id={id} title={id !== shown ? '@' + id : undefined} class={userClass}>@{shown}</span>{/if}
