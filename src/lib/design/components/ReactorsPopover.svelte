<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';
	import Avatar from './Avatar.svelte';
	import Popover from './Popover.svelte';
	import type { PopoverPlacement, Reactor } from './types';

	/**
	 * Who reacted with an emoji (§4.7), in a Popover, for a reaction chip
	 * long-pressed or right-clicked: the emoji and how many, then each
	 * person's avatar, name and `@user_id`, in the order given (you first,
	 * usually). The list scrolls past a few rows. Other attributes (`data-*`,
	 * event handlers) go on the Popover.
	 */
	interface Props extends HTMLAttributes<HTMLDivElement>, PopoverPlacement {
		emoji: string;
		reactors: Reactor[];
		/** Replaces each row's avatar, such as with your own that tints initials by `user_id`. */
		avatar?: Snippet<[Reactor]>;
		/** The Popover's `<div>`, bindable. */
		element?: HTMLDivElement;
		/** The Popover's rendered height in px, bindable. */
		offsetHeight?: number;
	}
	let { emoji, reactors, avatar, element = $bindable(), offsetHeight = $bindable(0), class: className, ...rest }: Props = $props();
	const count = $derived(`${reactors.length} ${reactors.length === 1 ? 'reaction' : 'reactions'}`);
</script>

<Popover aria-label={`${count} with ${emoji}`} {...rest} class={['ap-reactors', className]} bind:element bind:offsetHeight>
	<div class="ap-reactors-head"><span class="ap-reactors-emoji" aria-hidden="true">{emoji}</span><span>{count}</span></div>
	<ul class="ap-reactors-list">
		{#each reactors as reactor, i (i)}
			{@const name = reactor.name || reactor.user_id}
			<li class="ap-reactors-row" data-testid="reactor" data-user-id={reactor.user_id}>
				{#if avatar}{@render avatar(reactor)}{:else}<Avatar {name} user_id={reactor.user_id} src={reactor.avatar} />{/if}
				<div class="ap-reactors-names">
					<div class="ap-reactors-nameline"><span class="ap-reactors-name">{name}</span>{#if reactor.you}<span class="ap-reactors-muted">(you)</span>{/if}</div>
					{#if reactor.handle ?? reactor.user_id !== name}<div class="ap-reactors-muted ap-reactors-handle">@{reactor.user_id}</div>{/if}
				</div>
			</li>
		{/each}
	</ul>
</Popover>
