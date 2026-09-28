<script lang="ts">
	import type { Snippet } from 'svelte';
	import Avatar from './Avatar.svelte';
	import type { Sender } from './types';
	import { uid } from './util';

	interface Props {
		/** Your identity on the active backend: `you` from `auth`, merged with every later `user` notification carrying `you` (§3.3). */
		you: Sender;
		backend?: string;
		open?: boolean;
		onedit?: () => void;
		/** Usually a <ProfileEditor>; shown in a popover above the bar while `open`. */
		editor?: Snippet;
	}
	let { you, backend, open, onedit, editor }: Props = $props();
	const name = $derived(you?.name || uid(you));
</script>

<div class="ap-profile">
	{#if open && editor}<div class="ap-profile-pop">{@render editor()}</div>{/if}
	<button type="button" class={['ap-profile-me', open && 'ap-profile-open']} onclick={onedit} aria-haspopup="dialog" aria-expanded={!!open} aria-label="Your profile on {backend || 'this backend'}: {name}. Edit">
		<Avatar {name} src={you?.avatar} />
		<span class="ap-profile-text"><span class="ap-profile-name">{name}</span><span class="ap-profile-sub">{backend ? `on ${backend}` : uid(you)}</span></span>
		<span class="ap-profile-edit" aria-hidden="true">Edit</span>
	</button>
</div>
