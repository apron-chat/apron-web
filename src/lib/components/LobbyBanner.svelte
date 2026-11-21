<script lang="ts">
	import DoorOpen from '@lucide/svelte/icons/door-open';
	import PartyPopper from '@lucide/svelte/icons/party-popper';
	import type { LobbyLimit } from '$lib/protocol/types';
	import ActionBanner from '$lib/design/components/ActionBanner.svelte';
	import Button from '$lib/design/components/Button.svelte';
	import { lobbyBanner } from '$lib/ui/lobby';

	/**
	 * Under the header of the room open while you're limited to the server's lobby (`ext:permissions` `lobby`): where
	 * you are and what happens next, with the way into the sign-up flow that keeps your place (a waiting guest) or
	 * finishes joining (an invited guest, prominently). Once let out of it, a short welcome in, until put away.
	 */
	interface Props {
		/** How you're limited to the lobby; absent once let out of it. */
		limit?: LobbyLimit;
		/** You're a guest, not signed in to an account. */
		guest: boolean;
		/** The lobby's title. */
		room: string;
		/** This browser can create a passkey for the server, and the server signs up with one. */
		passkey: boolean;
		/** The server signs up another way this app can use. */
		signUp: boolean;
		/** The way into signing up: a passkey created on this connection, or the sign-up screen. */
		onsignup: (kind: 'passkey' | 'signup') => void;
		/** Let out of the lobby (and not put away yet): says so. */
		welcome?: boolean;
		/** The server's name, for the welcome. */
		server?: string;
		ondismiss?: () => void;
	}
	let { limit, guest, room, passkey, signUp, onsignup, welcome = false, server, ondismiss }: Props = $props();

	let text = $derived(limit ? lobbyBanner(limit, { guest, room, passkey, signUp }) : undefined);
</script>

{#snippet doorIcon()}<DoorOpen size={18} />{/snippet}
{#snippet partyIcon()}<PartyPopper size={18} />{/snippet}
{#snippet signUpAction()}
	{#if text?.action}{@const action = text.action}<Button variant={text.invited ? 'primary' : undefined} size="sm" onclick={() => onsignup(action.kind)} label={action.label} />{/if}
{/snippet}
{#snippet dismissAction()}<Button variant="ghost" size="sm" onclick={() => ondismiss?.()} label="Dismiss" />{/snippet}

{#if text}
	<div class="ap-shell-banner" data-testid="lobby-banner">
		<ActionBanner title={text.title} detail={text.detail} icon={text.invited ? doorIcon : undefined} action={text.action ? signUpAction : undefined} class={['ap-lobby-banner', text.invited && 'ap-lobby-banner-invited']} />
	</div>
{:else if welcome}
	<div class="ap-shell-banner" data-testid="welcome-banner">
		<ActionBanner title="Welcome in" detail={`You’re a member${server ? ` of ${server}` : ''} now: its rooms are listed with yours.`} icon={partyIcon} action={ondismiss ? dismissAction : undefined} class="ap-lobby-banner" />
	</div>
{/if}
