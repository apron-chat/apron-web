<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { ClassValue } from 'svelte/elements';
	import Avatar from './Avatar.svelte';
	import Popover from './Popover.svelte';
	import type { PopoverPlacement, Reactor } from './types';

	/**
	 * Who reacted with an emoji (§4.7), in a Popover, for a reaction chip
	 * long-pressed or right-clicked: the emoji and how many, then each
	 * person's avatar and name, with their `@user_id` where it tells them
	 * apart (`handle`), in the order given (you first, usually). The list scrolls past a few rows.
	 */
	interface Props extends PopoverPlacement {
		emoji: string;
		reactors: Reactor[];
		/** Replaces each row's avatar, such as with your own that tints initials by `user_id`. */
		avatar?: Snippet<[Reactor]>;
		/** The Popover's `<div>`, bindable. */
		element?: HTMLDivElement;
		/** The Popover's rendered height in px, bindable. */
		offsetHeight?: number;
		/** A `data-testid` for each person's row, which also carries their `data-user-id`. */
		rowTestid?: string;
		/** Classes for the Popover, added to its own. */
		class?: ClassValue;
		/** A `data-testid` for the Popover. */
		testid?: string;
		/** Keys in it, such as Escape to close it. */
		onkeydown?: (event: KeyboardEvent) => void;
		/** Focus leaving something in it, such as to close it when focus leaves it altogether. */
		onfocusout?: (event: FocusEvent) => void;
	}
	let { emoji, reactors, avatar, element = $bindable(), offsetHeight = $bindable(0), rowTestid, mode, top, left, width, height, class: className, testid, onkeydown, onfocusout }: Props = $props();
	const count = $derived(`${reactors.length} ${reactors.length === 1 ? 'reaction' : 'reactions'}`);
</script>

<Popover label={`${count} with ${emoji}`} {mode} {top} {left} {width} {height} class={['ap-reactors', className]} {testid} {onkeydown} {onfocusout} bind:element bind:offsetHeight>
	<div class="ap-reactors-head"><span class="ap-reactors-emoji" aria-hidden="true">{emoji}</span><span>{count}</span></div>
	<ul class="ap-reactors-list">
		{#each reactors as reactor (reactor.user_id)}
			{@const name = reactor.name || reactor.user_id}
			<li class="ap-reactors-row" data-testid={rowTestid} data-user-id={reactor.user_id}>
				{#if avatar}{@render avatar(reactor)}{:else}<Avatar {name} user_id={reactor.user_id} src={reactor.avatar} />{/if}
				<div class="ap-reactors-names">
					<div class="ap-reactors-nameline"><span class="ap-reactors-name">{name}</span>{#if reactor.you}<span class="ap-reactors-muted">(you)</span>{/if}</div>
					{#if reactor.handle}<div class="ap-reactors-muted ap-reactors-handle">@{reactor.user_id}</div>{/if}
				</div>
			</li>
		{/each}
	</ul>
</Popover>
