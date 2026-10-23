<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';

	/** Extra attributes go on the row (with `below`, on its box, the row and what's below it). */
	interface Props extends HTMLAttributes<HTMLDivElement> {
		/** What it sets, in bold. */
		title: string;
		/** The control's id: the title becomes its `<label>`. */
		for?: string;
		/** A small tag beside the title, such as Experimental. */
		badge?: string;
		/** What it does, under the title; leave it out to say something else there (`children`). */
		hint?: string;
		/** A `data-testid` for the hint. */
		hintTestid?: string;
		/** More under the hint: how it stands now, a test button, a callout. */
		children?: Snippet;
		/** The control at the row's end, such as a Switch or a MenuButton; with `stacked`, what follows the title, full width. */
		control?: Snippet;
		/** The control goes under the title rather than beside it, such as a form of several fields. */
		stacked?: boolean;
		/** Under the whole row, full width, such as what the server answered. */
		below?: Snippet;
	}
	let { title, for: forId, badge, hint, hintTestid, children, control, stacked = false, below, class: className, ...rest }: Props = $props();
</script>

<!-- A row of a settings section (SettingsSections): the title and what it does, with its control at the end. -->
{#snippet row()}
	<div class="ap-pref-setting-text">
		{#if forId}<label class="ap-pref-setting-title" for={forId}>{title}</label>{:else}<strong class="ap-pref-setting-title">{title}</strong>{/if}{#if badge}{' '}<span class="ap-pref-experimental">{badge}</span>{/if}
		{#if hint}<p class="ap-profedit-hint" data-testid={hintTestid}>{hint}</p>{/if}
		{@render children?.()}
	</div>
	{@render control?.()}
{/snippet}
{#if below}
	<div {...rest} class={['ap-pref-setting-below', className]}>
		<div class="ap-pref-setting-row">{@render row()}</div>
		{@render below()}
	</div>
{:else}
	<div {...rest} class={['ap-pref-setting', stacked && 'ap-pref-setting-stacked', className]}>{@render row()}</div>
{/if}
