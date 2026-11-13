<script lang="ts">
	import UserPlus from '@lucide/svelte/icons/user-plus';
	import { listNames } from '$lib/ui/membership';

	/**
	 * The line over the composer while the draft mentions people who aren't in the room or thread (by name, or by a
	 * role no one here holds): they won't see it unless they're added. Its checkbox says whether Send adds them first
	 * (ticked), or sends as it is. It leaves the focus in the composer; the page reads it out as it arrives.
	 */
	interface Props {
		/** Who isn't in it, as mentioned: "Margaret Hamilton (moderator)" for one a role names. */
		names: string[];
		thread?: boolean;
		/** Send is adding them: the checkbox waits. */
		busy?: boolean;
		/** Whether Send adds them first. */
		add?: boolean;
		onchange: (add: boolean) => void;
	}
	let { names, thread = false, busy = false, add = false, onchange }: Props = $props();

	const uid = $props.id();
	let where = $derived(thread ? 'thread' : 'room');
</script>

<div class="ap-mention-outside" data-testid="mention-outside-hint">
	<span class="ap-mention-outside-icon" aria-hidden="true"><UserPlus size={14} strokeWidth={2} /></span>
	<span class="ap-mention-outside-text" id="{uid}-text">Not in this {where}, add them so they’ll see the mention? <strong class="ap-mention-outside-names">{listNames(names)}</strong></span>
	<!-- Named for what it does, and described by the line, which says whom. -->
	<label class="ap-pref-check ap-mention-outside-add"><input class="ap-checklist-box" type="checkbox" checked={add} disabled={busy} aria-describedby="{uid}-text" onchange={(event) => onchange(event.currentTarget.checked)} data-testid="mention-outside-add" /><span>Add to {where} on send</span></label>
	{#if busy}<span class="ap-mention-outside-busy">Adding…</span>{/if}
</div>
