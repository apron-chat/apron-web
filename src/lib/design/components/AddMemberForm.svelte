<script lang="ts">
	import type { ClassValue } from 'svelte/elements';

	/**
	 * The form for adding a member to a room (`room_join` with `user_id`, §4.2.2): a field for their `@user_id`, with
	 * suggestions, and Add. A <MemberList> shows it atop its list, raised like a popover in place, through its `addForm`
	 * snippet, which hands it the `id` the list's + controls: give it to the form.
	 */
	interface Props {
		/** The form's id: the one MemberList's `addForm` hands over, which its + names in `aria-controls`. */
		id?: string;
		/** The field's text. `bind:value` works. */
		value?: string;
		/** People to suggest, by `user_id`. */
		candidates?: { user_id: string; name: string }[];
		/** Add pressed (or Enter in the field), with what was typed. */
		onadd?: (value: string) => void;
		/** Escape in the field. */
		ondismiss?: () => void;
		/** An add is under way: the field and Add wait. */
		busy?: boolean;
		/** Classes for the `<form>`, added to its own. */
		class?: ClassValue;
	}
	let { id, value = $bindable(''), candidates = [], onadd, ondismiss, busy = false, class: className }: Props = $props();

	const uid = $props.id();
	let field = $state<HTMLInputElement | undefined>();

	/** Focus its field, such as once it has opened. */
	export function focus(): void {
		field?.focus();
	}

	function submit(event: SubmitEvent): void {
		event.preventDefault();
		onadd?.(value);
	}
</script>

<form {id} aria-label="Add a member" class={['ap-memberlist-add', className]} onsubmit={submit}>
	<label class="ap-sr" for={`${uid}-user`}>User to add</label>
	<div class="ap-memberlist-addrow">
		<input id={`${uid}-user`} bind:this={field} class="ap-field" list="member-candidates" placeholder="@user_id" bind:value disabled={busy} autocomplete="off" spellcheck="false" onkeydown={(event) => { if (event.key === 'Escape') { event.preventDefault(); ondismiss?.(); } }} />
		<button class="ap-btn ap-btn-primary ap-btn-sm" type="submit" disabled={busy || !value.trim()}>Add</button>
	</div>
	<datalist id="member-candidates">
		{#each candidates as user (user.user_id)}<option value={user.user_id}>{user.name} (@{user.user_id})</option>{/each}
	</datalist>
</form>
