<script lang="ts">
	import { count99, cx } from './util';

	interface Props {
		/** Default: the round `fab`, or the rust `bar` when there are `mentions`. */
		variant?: 'bar' | 'fab';
		count?: number;
		onjump?: () => void;
		/** unread mentions below the fold */
		mentions?: number;
		onjumpmention?: () => void;
	}
	let { variant, count, onjump, mentions = 0, onjumpmention }: Props = $props();
	const fab = $derived(variant ? variant === 'fab' : !mentions);
	const label = $derived(
		mentions
			? (mentions === 1 ? 'You were mentioned' : `You were mentioned ${mentions} times`) + (count ? ` · ${count} new` : '')
			: count ? (count === 1 ? '1 new message' : `${count} new messages`) : 'You’re viewing older messages'
	);
</script>

{#if fab}
	<button type="button" class="ap-jumpfab" onclick={onjump} aria-label={count ? `${count} new messages, jump to latest` : 'Jump to latest'}>
		<span aria-hidden="true">↓</span>{#if count}<span class="ap-count ap-jumpfab-count">{count99(count)}</span>{/if}
	</button>
{:else}
	<div class={cx('ap-jumpbar', mentions && 'ap-jumpbar-at')} role="status">
		{#if mentions}<span class="ap-count ap-count-at" aria-hidden="true">@</span>{/if}
		<span class="ap-jumpbar-text">{label}</span>
		<button type="button" class="ap-jumpbar-btn" onclick={mentions && onjumpmention ? onjumpmention : onjump}>{mentions ? 'Jump to mention' : count ? 'Jump to new' : 'Jump to latest'}</button>
	</div>
{/if}
