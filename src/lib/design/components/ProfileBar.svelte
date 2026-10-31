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
		/** Something to do, such as "add a sign-in": the line under your name says it, unless notifications are paused. */
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
		/** Notifications are paused (§4.5 `mute`), and until when, in words ("until 14:30"): the line under your name says so, and a small bell-off marks the gear. */
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
	/**
	 * Its one line under your name, the most useful thing to say, not the server the head above already names:
	 * notifications paused, else what to do (`note`), else your status, else your `@user_id`; the server only
	 * before there is a you.
	 */
	const sub = $derived.by((): { kind: 'paused' | 'note' | 'status' | 'id' | 'backend'; text: string } | undefined => {
		if (paused) return { kind: 'paused', text: `Paused ${paused}` };
		if (note) return { kind: 'note', text: note.charAt(0).toUpperCase() + note.slice(1) };
		const words = status ? (statusLabel ?? presenceLabel(status)) : undefined;
		if (words) return { kind: 'status', text: words };
		if (uid(you)) return { kind: 'id', text: `@${uid(you)}` };
		return backend ? { kind: 'backend', text: `on ${backend}` } : undefined;
	});
</script>

<!-- Your identity, and the one way to your profile and the preferences: the gear says where it leads. -->
<div class={['ap-profile', className]}>
	{@render children?.()}
	<button type="button" class={['ap-profile-me', open && 'ap-profile-open']} bind:this={button} aria-haspopup="dialog"
		aria-label="{paused ? `Open preferences. Notifications paused ${paused}.` : 'Open preferences.'} Your profile on {backend || 'this server'}: {label}{statusWords ? `, ${statusWords}` : ''}"
		title={paused ? `Profile and preferences · notifications paused ${paused}` : 'Profile and preferences'} onclick={onopen}>
		{#if avatar}{@render avatar()}{:else}<Avatar name={you?.name || uid(you) || '?'} src={you?.avatar} {status} {statusLabel} />{/if}
		<span class="ap-profile-text">
			<span class="ap-profile-name">{name}</span>
			{#if sub}<span class={['ap-profile-sub', `ap-profile-sub-${sub.kind}`]}>{#if sub.kind === 'paused'}<BellOff size={12} strokeWidth={2} aria-hidden="true" />{/if}<bdi>{sub.text}</bdi></span>{/if}
		</span>
		<span class="ap-profile-gear" aria-hidden="true">
			<Settings size={18} strokeWidth={1.6} />
			{#if paused}<span class="ap-profile-paused"><BellOff size={10} strokeWidth={2.2} /></span>{/if}
		</span>
	</button>
</div>
