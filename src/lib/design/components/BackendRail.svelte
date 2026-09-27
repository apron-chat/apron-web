<script lang="ts">
	import type { BackendEntry } from './types';
	import { count99, initials } from './util';

	interface Props {
		backends: BackendEntry[];
		active?: string;
		onselect?: (id: string) => void;
		onadd?: () => void;
	}
	let { backends, active, onselect, onadd }: Props = $props();
</script>

<nav class="ap-rail" aria-label="Backends">
	{#each backends as b (b.id)}
		<button
			type="button"
			class={['ap-rail-item', b.id === active && 'ap-rail-active', b.unread && 'ap-rail-unread', b.state === 'offline' && 'ap-rail-offline']}
			onclick={() => onselect?.(b.id)}
			aria-current={b.id === active ? 'true' : undefined}
			title={b.label}
			aria-label={b.label + (b.unread ? ', unread' : '') + (b.state === 'offline' ? ', offline' : '')}
		>
			<span class="ap-rail-pip" aria-hidden="true"></span>
			{#if b.icon}<img class="ap-rail-tile" src={b.icon} alt="" />{:else}<span class="ap-rail-tile">{initials(b.label)}</span>{/if}
			{#if b.mentions}<span class="ap-count ap-rail-count">{count99(b.mentions)}</span>{/if}
		</button>
	{/each}
	{#if onadd}
		<button type="button" class="ap-rail-item ap-rail-add" onclick={onadd} aria-label="Connect a backend" title="Connect a backend"><span class="ap-rail-pip" aria-hidden="true"></span><span class="ap-rail-tile">+</span></button>
	{/if}
</nav>
