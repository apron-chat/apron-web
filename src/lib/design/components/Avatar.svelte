<script lang="ts">
	import { initials } from './util';

	interface Props {
		name?: string;
		user_id?: string;
		src?: string;
		size?: 'lg' | 'md' | 'sm';
	}
	let { name, user_id, src, size = 'md' }: Props = $props();
	const shown = $derived(name || user_id || '?');
</script>

{#if src}
	<img class="ap-avatar ap-avatar-{size}" {src} alt="" />
{:else}
	<span class="ap-avatar ap-avatar-{size}" aria-hidden="true">{initials(shown)}</span>
{/if}
