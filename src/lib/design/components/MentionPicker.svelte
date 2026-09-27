<script lang="ts">
	import Avatar from './Avatar.svelte';
	import type { Sender } from './types';
	import { uid } from './util';

	interface Props {
		query?: string;
		people: Sender[];
		active?: number;
		onpick?: (p: Sender) => void;
		onhover?: (i: number) => void;
	}
	let { query = '', people, active = 0, onpick, onhover }: Props = $props();
	const q = $derived(query.toLowerCase());
	function split(text: string): [string, string, string] | null {
		const i = q ? text.toLowerCase().indexOf(q) : -1;
		return i < 0 ? null : [text.slice(0, i), text.slice(i, i + q.length), text.slice(i + q.length)];
	}
</script>

{#snippet mark(text: string)}{@const m = split(text)}{#if m}{m[0]}<mark class="ap-mpick-hit">{m[1]}</mark>{m[2]}{:else}{text}{/if}{/snippet}

{#if !people.length}
	<div class="ap-mpick" role="listbox" aria-label="Mention someone"><div class="ap-mpick-empty">{q ? `No one here matches “${q}”` : 'People in this room'}</div></div>
{:else}
	<ul class="ap-mpick" role="listbox" aria-label="Mention someone">
		{#each people as p, i (uid(p) ?? i)}
			{@const pid = uid(p) || ''}
			{@const name = p.name || pid}
			<li role="option" aria-selected={i === active} class={['ap-mpick-item', i === active && 'ap-mpick-active']} onmousedown={(e) => { e.preventDefault(); onpick?.(p); }} onmouseenter={() => onhover?.(i)}>
				<Avatar {name} src={p.avatar} size="sm" />
				<span class="ap-mpick-name">{@render mark(name)}</span>
				{#if pid !== name}<span class="ap-mpick-id">@{@render mark(pid)}</span>{/if}
				{#if i === active}<kbd class="ap-mpick-kbd">Tab</kbd>{/if}
			</li>
		{/each}
	</ul>
{/if}
