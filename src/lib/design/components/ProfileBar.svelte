<script lang="ts">
	import BellOff from '@lucide/svelte/icons/bell-off';
	import Settings from '@lucide/svelte/icons/settings';
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';
	import Avatar from './Avatar.svelte';
	import type { Sender } from './types';
	import { presenceLabel, uid } from './util';

	/** Extra attributes go on the bar. */
	interface Props extends HTMLAttributes<HTMLDivElement> {
		/** Your identity on the active backend: `you` from `auth`, merged with every later `user` notification carrying `you` (§3.3). */
		you?: Sender;
		/** Shown in place of your name before there is a `you`, such as "Signing in…" or "Not signed in". */
		placeholder?: string;
		backend?: string;
		/** After the backend's name: something to do, such as "add a sign-in". */
		note?: string;
		/** Your `status` (§4.5) as you chose it: a dot on your avatar, and said in the button's label. `statusLabel` replaces its words. */
		status?: string;
		statusLabel?: string;
		/** Replaces the avatar, such as with one tinted by your `user_id`. */
		avatar?: Snippet;
		open?: boolean;
		onedit?: () => void;
		/** Usually a <ProfileEditor> (`dialog: false`); shown in a dialog popover above the bar while `open`. */
		editor?: Snippet;
		/** A gear beside the bar that opens the preferences. */
		onpreferences?: () => void;
		/** Notifications are paused (§4.5 `mute`), and until when, in words ("until 14:30"): a small bell-off on the gear's corner. */
		paused?: string;
		/** The gear, to return focus to as its dialog closes; bindable. */
		preferencesButton?: HTMLButtonElement;
		/** Rendered in the bar, such as the dialog the gear opens. */
		children?: Snippet;
	}
	let { you, placeholder, backend, note, status, statusLabel, avatar, open, onedit, editor, onpreferences, paused, preferencesButton = $bindable(), children, class: className, ...rest }: Props = $props();
	const name = $derived(you?.name || uid(you) || placeholder || '');
	/** The placeholder in a sentence: "Signing in…" says "signing in". */
	const label = $derived(you?.name || uid(you) || (placeholder ?? '').replace(/…$/, '').toLowerCase());
	const statusWords = $derived(status ? (statusLabel ?? presenceLabel(status) ?? '').toLowerCase() : '');
</script>

<div {...rest} class={['ap-profile', className]}>
	{#if open && editor}<div class="ap-profile-pop" role="dialog" aria-label="Edit profile">{@render editor()}</div>{/if}
	{@render children?.()}
	<button type="button" class={['ap-profile-me', open && 'ap-profile-open']} aria-haspopup="dialog" aria-expanded={!!open} aria-label="Your profile on {backend || 'this backend'}: {label}{statusWords ? `, ${statusWords}` : ''}. Edit" onclick={onedit}>
		{#if avatar}{@render avatar()}{:else}<Avatar name={you?.name || uid(you) || '?'} src={you?.avatar} {status} {statusLabel} />{/if}
		<span class="ap-profile-text">
			<span class="ap-profile-name">{name}</span>
			<!-- The separator is an expression: a space leading an {#if} block's text would be trimmed. -->
			<span class="ap-profile-sub">{#if backend}{'on '}<bdi>{backend}</bdi>{:else}{uid(you)}{/if}{#if note}{' · '}{note}{/if}</span>
		</span>
		<span class="ap-profile-edit" aria-hidden="true">Edit</span>
	</button>
	{#if onpreferences}
		<button class="ap-profile-settings" bind:this={preferencesButton} type="button" aria-label={paused ? `Open preferences. Notifications paused ${paused}` : 'Open preferences'} aria-haspopup="dialog" title={paused ? `Preferences · notifications paused ${paused}` : 'Preferences'} onclick={onpreferences}>
			<Settings size={18} strokeWidth={1.6} aria-hidden="true" />
			{#if paused}<span class="ap-profile-paused" aria-hidden="true"><BellOff size={10} strokeWidth={2.2} /></span>{/if}
		</button>
	{/if}
</div>
