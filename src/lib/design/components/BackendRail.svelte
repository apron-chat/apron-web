<script lang="ts">
	import type { HTMLAttributes } from 'svelte/elements';
	import type { BackendEntry } from './types';
	import { count99, initials } from './util';

	/** Other attributes (`data-testid`, `data-*`) go on its `<nav>`, the caller's winning and its class added. */
	interface Props extends Omit<HTMLAttributes<HTMLElement>, 'onselect'> {
		backends: BackendEntry[];
		active?: string;
		/** A backend's tile picked, by its `id`. */
		onselect?: (id: string) => void;
		onadd?: () => void;
	}
	let { backends, active, onselect, onadd, class: className, ...rest }: Props = $props();
</script>

<nav aria-label="Backends" {...rest} class={['ap-rail', className]}>
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
