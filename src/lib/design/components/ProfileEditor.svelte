<script lang="ts">
	import type { Snippet } from 'svelte';
	import Avatar from './Avatar.svelte';
	import Button from './Button.svelte';
	import TypingDots from './TypingDots.svelte';

	interface Props {
		userId: string;
		/** Display name — sent as `me` `{name}` (§3.3); `you.name` in the result is the answer. `bind:name` in Svelte. */
		name?: string;
		/** Change notification for callers that can't bind (plain pages); fires after `name` updates. */
		oninput?: (name: string) => void;
		avatar?: string;
		/** Replaces the large avatar, such as with one tinted by the `user_id` and showing your status. */
		face?: Snippet;
		/** Caps `command` and `embed:upload`: a `/avatar` command with one `upload` embed (§4.8.6). */
		canUpload?: boolean;
		onchangeavatar?: () => void;
		/** Given, Change avatar opens a file picker for an image, and this gets its input once one is picked. */
		onavatarfile?: (input: HTMLInputElement) => void;
		/** Sends `me` `{avatar: ""}`. */
		onremoveavatar?: () => void;
		/** An avatar on its way: uploading says so on its button; either keeps both avatar buttons disabled. */
		avatarBusy?: 'uploading' | 'removing';
		/** The request went out but `you.avatar` didn't change. */
		avatarKept?: boolean;
		/** Why the avatar couldn't be uploaded or removed. */
		avatarError?: string;
		/** Not connected: the avatar buttons can't be used. */
		offline?: boolean;
		/** saving · altered: `you.name` differs from what you asked (`serverName`) · declined */
		status?: 'idle' | 'saving' | 'altered' | 'declined';
		serverName?: string;
		/** What the server said in declining the handle, in parentheses after the note. */
		declinedReason?: string;
		/** The declined note's second sentence, in place of "Your old one is still in use.", such as that signing in applies it. */
		declinedHint?: string;
		onsave?: () => void;
		oncancel?: () => void;
		/** `server.auth` lists `webauthn` and this session isn't one: "Add passkey" runs `auth` action "register" (§4.10). */
		canPasskey?: boolean;
		onaddpasskey?: () => void;
		passkey?: 'idle' | 'waiting' | 'done' | 'declined' | 'cancelled';
		/** Replaces the Sign-in group's contents under its label, such as with the ways in this server offers. */
		signin?: Snippet;
		/** The form is the dialog (the default); off inside a <ProfileBar>, whose popover is. */
		dialog?: boolean;
	}
	let {
		userId, name = $bindable(''), oninput, avatar, face, canUpload, onchangeavatar, onavatarfile, onremoveavatar, avatarBusy, avatarKept, avatarError, offline,
		status = 'idle', serverName, declinedReason, declinedHint, onsave, oncancel, canPasskey, onaddpasskey, passkey, signin, dialog = true
	}: Props = $props();
	const saving = $derived(status === 'saving');
	let fileInput = $state<HTMLInputElement | undefined>();

	function changeAvatar(): void {
		onchangeavatar?.();
		fileInput?.click();
	}
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role -->
<form class="ap-profedit" role={dialog ? 'dialog' : undefined} aria-label={dialog ? 'Edit profile' : undefined} onsubmit={(e) => { e.preventDefault(); onsave?.(); }}>
	<div class="ap-profedit-top">
		{#if face}{@render face()}{:else}<Avatar name={name || userId} src={avatar} size="lg" />{/if}
		<div class="ap-profedit-av">
			{#if canUpload}
				<span class="ap-profedit-avbtns">
					<Button size="sm" data-testid="change-avatar" disabled={saving || Boolean(avatarBusy) || offline} onclick={changeAvatar} label={avatarBusy === 'uploading' ? 'Uploading…' : avatar ? 'Change avatar' : 'Add avatar'} />
					{#if avatar && onremoveavatar}
						<button type="button" class="ap-link ap-profedit-remove" data-testid="remove-avatar" disabled={Boolean(avatarBusy) || offline} onclick={onremoveavatar}>Remove</button>
					{/if}
				</span>
				{#if onavatarfile}<input class="ap-sr" type="file" accept="image/*" tabindex="-1" aria-hidden="true" data-testid="avatar-input" bind:this={fileInput} onchange={(e) => onavatarfile(e.currentTarget)} />{/if}
			{:else if avatar && onremoveavatar}
				<button type="button" class="ap-link ap-profedit-remove" disabled={Boolean(avatarBusy) || offline} onclick={onremoveavatar}>Remove avatar</button>
			{:else}
				<span class="ap-profedit-hint">This backend doesn’t take uploads, so your avatar can’t be set here.</span>
			{/if}
			{#if avatarKept}<span class="ap-profedit-hint">The server kept your previous avatar.</span>{/if}
			{#if avatarError}<span class="ap-profedit-hint ap-profedit-err" role="alert">{avatarError}</span>{/if}
		</div>
	</div>
	<label class="ap-fieldlabel">Handle
		<input class="ap-field" data-testid="display-name-input" bind:value={() => name, (v) => { name = v; oninput?.(v); }} disabled={saving} maxlength="64" autocomplete="nickname" spellcheck="false" />
	</label>
	<p class="ap-profedit-hint">ID <code>{userId}</code> · set by the server, can’t be changed</p>
	{#if status === 'altered'}<p class="ap-profedit-note" role="status">The server saved your handle as “{serverName}”.</p>{/if}
	{#if status === 'declined'}<p class="ap-profedit-note ap-profedit-err" role="alert">The server declined this handle{declinedReason ? ` (${declinedReason})` : ''}. {declinedHint ?? 'Your old one is still in use.'}</p>{/if}
	{#if canPasskey || signin}
		<div class="ap-profedit-signin" role="group" aria-label="Sign-in">
			<span class="ap-fieldlabel">Sign-in</span>
			{#if signin}{@render signin()}
			{:else if passkey === 'done'}<span class="ap-profedit-hint ap-profedit-ok">Passkey saved · this backend will ask your device next time</span>
			{:else if passkey === 'waiting'}<span class="ap-profedit-hint"><TypingDots />{' Confirm on your device…'}</span>
			{:else}
				<span class="ap-profedit-row">
					<Button size="sm" onclick={onaddpasskey} disabled={saving} label="Add passkey" />
					<span class={['ap-profedit-hint', passkey === 'declined' && 'ap-profedit-err']}>{passkey === 'declined' ? 'The server didn’t accept it. Your token still works.' : passkey === 'cancelled' ? 'Cancelled. Your token still works.' : 'Signed in with a token'}</span>
				</span>
			{/if}
		</div>
	{/if}
	<div class="ap-profedit-actions">
		<Button variant="ghost" size="sm" onclick={oncancel} disabled={saving} label={status === 'altered' ? 'Close' : 'Cancel'} />
		<Button type="submit" variant="primary" size="sm" disabled={saving || !name.trim()} label={saving ? 'Saving…' : 'Save'} />
	</div>
</form>
