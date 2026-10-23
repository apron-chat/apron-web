<script lang="ts">
	import type { HTMLAttributes } from 'svelte/elements';
	import { chain } from './util';

	/**
	 * The form for adding a member to a room (`room_join` with `user_id`, §4.2.2): a field for their `@user_id`, with
	 * suggestions, and Add. A <MemberList> shows it atop its list, raised like a popover in place, through its `addForm`
	 * snippet, which hands it the `id` the list's + controls. Other attributes go on the `<form>`, the caller's winning
	 * and its class added; its `onsubmit` runs first, and calling `preventDefault()` there skips the form's own (`onadd`).
	 */
	interface Props extends HTMLAttributes<HTMLFormElement> {
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
	}
	let { value = $bindable(''), candidates = [], onadd, ondismiss, busy = false, class: className, onsubmit, ...rest }: Props = $props();

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

<form aria-label="Add a member" {...rest} class={['ap-memberlist-add', className]} onsubmit={chain(submit, onsubmit)}>
	<label class="ap-sr" for={`${uid}-user`}>User to add</label>
	<div class="ap-memberlist-addrow">
		<input id={`${uid}-user`} bind:this={field} class="ap-field" list="member-candidates" placeholder="@user_id" bind:value disabled={busy} autocomplete="off" spellcheck="false" onkeydown={(event) => { if (event.key === 'Escape') { event.preventDefault(); ondismiss?.(); } }} />
		<button class="ap-btn ap-btn-primary ap-btn-sm" type="submit" disabled={busy || !value.trim()}>Add</button>
	</div>
	<datalist id="member-candidates">
		{#each candidates as user (user.user_id)}<option value={user.user_id}>{user.name} (@{user.user_id})</option>{/each}
	</datalist>
</form>
