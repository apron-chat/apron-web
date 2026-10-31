<script lang="ts">
	import BellOff from '@lucide/svelte/icons/bell-off';
	import Settings from '@lucide/svelte/icons/settings';
	import type { Snippet } from 'svelte';
	import type { ClassValue } from 'svelte/elements';
	import Avatar from './Avatar.svelte';
	import type { Sender } from './types';
	import { presenceLabel, uid } from './util';

	interface Props {
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
		/** The bar's one button: your profile and the preferences, such as a dialog that opens at Profile. */
		onopen?: () => void;
		/** What it opens is open: the bar shows pressed. */
		open?: boolean;
		/** Notifications are paused (§4.5 `mute`), and until when, in words ("until 14:30"): a small bell-off on the gear's corner. */
		paused?: string;
		/** The button, to return focus to as what it opened closes; bindable. */
		button?: HTMLButtonElement;
		/** Rendered in the bar, such as the dialog the button opens. */
		children?: Snippet;
		/** Classes for the bar, added to its own. */
		class?: ClassValue;
	}
	let { you, placeholder, backend, note, status, statusLabel, avatar, onopen, open, paused, button = $bindable(), children, class: className }: Props = $props();
	const name = $derived(you?.name || uid(you) || placeholder || '');
	/** The placeholder in a sentence: "Signing in…" says "signing in". */
	const label = $derived(you?.name || uid(you) || (placeholder ?? '').replace(/…$/, '').toLowerCase());
	const statusWords = $derived(status ? (statusLabel ?? presenceLabel(status) ?? '').toLowerCase() : '');
</script>

<!-- Your identity, and the one way to your profile and the preferences: the gear says where it leads. -->
<div class={['ap-profile', className]}>
	{@render children?.()}
	<button type="button" class={['ap-profile-me', open && 'ap-profile-open']} bind:this={button} aria-haspopup="dialog"
		aria-label="Open preferences.{paused ? ` Notifications paused ${paused}.` : ''} Your profile on {backend || 'this backend'}: {label}{statusWords ? `, ${statusWords}` : ''}"
		title={paused ? `Profile and preferences · notifications paused ${paused}` : 'Profile and preferences'} onclick={onopen}>
		{#if avatar}{@render avatar()}{:else}<Avatar name={you?.name || uid(you) || '?'} src={you?.avatar} {status} {statusLabel} />{/if}
		<span class="ap-profile-text">
			<span class="ap-profile-name">{name}</span>
			<!-- The separator is an expression: a space leading an {#if} block's text would be trimmed. -->
			<span class="ap-profile-sub">{#if backend}{'on '}<bdi>{backend}</bdi>{:else}{uid(you)}{/if}{#if note}{' · '}{note}{/if}</span>
		</span>
		<span class="ap-profile-gear" aria-hidden="true">
			<Settings size={18} strokeWidth={1.6} />
			{#if paused}<span class="ap-profile-paused"><BellOff size={10} strokeWidth={2.2} /></span>{/if}
		</span>
	</button>
</div>
