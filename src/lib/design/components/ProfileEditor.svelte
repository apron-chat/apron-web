<script lang="ts">
	import type { MediaSrc } from './types';
	import type { Snippet } from 'svelte';
	import type { ClassValue } from 'svelte/elements';
	import Avatar from './Avatar.svelte';
	import Button from './Button.svelte';

	/** The profile form. */
	interface Props {
		userId: string;
		/** Display name — sent as `me` `{name}` (§3.3); `you.name` in the result is the answer. `bind:name` in Svelte. */
		name?: string;
		/** Change notification for callers that can't bind (plain pages); fires after `name` updates. */
		oninput?: (name: string) => void;
		avatar?: MediaSrc;
		/** You have an avatar, shown or not (where it may not load, it isn't): Change and Remove are offered. Default: `avatar` is set. */
		hasAvatar?: boolean;
		/** Replaces the large avatar, such as with one tinted by the `user_id` and showing your status. */
		face?: Snippet;
		/** Caps `command` and `embed:upload`: a `/avatar` command with one `upload` embed (§4.8.6). */
		canUpload?: boolean;
		/** Change avatar opens a file picker for an image; this gets the one picked (the picker is cleared for the next). */
		onavatarfile?: (file: File) => void;
		/** Sends `me` `{avatar: ""}`. */
		onremoveavatar?: () => void;
		/** An avatar on its way: uploading says so on its button; either keeps both avatar buttons disabled. */
		avatarBusy?: 'uploading' | 'removing';
		/** Why the avatar couldn't be uploaded or removed. */
		avatarError?: string;
		/** Not connected: the avatar buttons can't be used. */
		offline?: boolean;
		/**
		 * Your bio (`ext:bio`), plain text, sent as `me` `{ext: {bio}}`, `""` clearing it. `bind:bio` in Svelte.
		 * Shown only with `maxBio`.
		 */
		bio?: string;
		/** The longest bio, in characters: a Bio field with a count, and Save waits while it's over. Without it, no Bio field. */
		maxBio?: number;
		/** Why the server didn't keep the bio. */
		bioError?: string;
		/** saving · saved: kept as asked · altered: `you.name` differs from what you asked (`serverName`) · declined (`declinedNote`) */
		status?: 'idle' | 'saving' | 'saved' | 'altered' | 'declined';
		/**
		 * The name or bio differs from what the server keeps: Save (and `onrevert`'s Revert) show only then, or while
		 * saving. Default: always, as a dialog has them.
		 */
		dirty?: boolean;
		/** Revert, beside Save: back to what the server keeps. */
		onrevert?: () => void;
		serverName?: string;
		/**
		 * The declined note's words, in place of “The server declined this handle. Your old one is still in use.”,
		 * such as with what the server said, or what happens to the handle next.
		 */
		declinedNote?: string;
		onsave?: () => void;
		/** A Cancel beside Save (Close once the server altered the handle); without it, only Save. */
		oncancel?: () => void;
		/**
		 * A Sign-in group under the handle: how this session signs in, and the ways to add or switch, such as
		 * buttons for the schemes the server offers with a line saying how it stands.
		 */
		signin?: Snippet;
		/** A last group, at the end: how this session is signed in, and Sign out. */
		signout?: Snippet;
		/** A Server group at the foot: Connect to a server…, the way to the connect screen, for another server or another way to sign in. */
		onconnect?: () => void;
		/** The form is the dialog (the default); off inside another, such as Preferences' Profile. */
		dialog?: boolean;
		/** `data-testid` on the Change avatar button, its Remove, the file picker and the Handle field. */
		changeAvatarTestid?: string;
		removeAvatarTestid?: string;
		avatarFileTestid?: string;
		nameTestid?: string;
		/** `data-testid` on the Bio field. */
		bioTestid?: string;
		/** Classes for the form, added to its own. */
		class?: ClassValue;
	}
	let {
		userId, name = $bindable(''), oninput, avatar, hasAvatar = Boolean(avatar), face, canUpload, onavatarfile, onremoveavatar, avatarBusy, avatarError, offline,
		bio = $bindable(''), maxBio, bioError, status = 'idle', dirty = true, onrevert, serverName, declinedNote, onsave, oncancel, signin, signout, onconnect, dialog = true,
		changeAvatarTestid, removeAvatarTestid, avatarFileTestid, nameTestid, bioTestid, class: className
	}: Props = $props();
	const saving = $derived(status === 'saving');
	/** The bio's length in characters (code points, so an emoji is one). */
	const bioLength = $derived([...bio.trim()].length);
	const bioOver = $derived(maxBio !== undefined && bioLength > maxBio);
	let fileInput = $state<HTMLInputElement | undefined>();

	function save(event: SubmitEvent): void {
		event.preventDefault();
		onsave?.();
	}

	function picked(input: HTMLInputElement): void {
		const file = input.files?.[0];
		input.value = '';
		if (file) onavatarfile?.(file);
	}
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role -->
<form role={dialog ? 'dialog' : undefined} aria-label={dialog ? 'Edit profile' : undefined} class={['ap-profedit', className]} onsubmit={save}>
	<div class="ap-profedit-group ap-profedit-top">
		{#if face}{@render face()}{:else}<Avatar name={name || userId} src={avatar} size="lg" />{/if}
		<div class="ap-profedit-av">
			{#if canUpload}
				<span class="ap-profedit-avbtns">
					<Button size="sm" data-testid={changeAvatarTestid} disabled={saving || Boolean(avatarBusy) || offline} onclick={() => fileInput?.click()} label={avatarBusy === 'uploading' ? 'Uploading…' : hasAvatar ? 'Change avatar' : 'Add avatar'} />
					{#if hasAvatar && onremoveavatar}
						<button type="button" class="ap-link ap-profedit-remove" data-testid={removeAvatarTestid} disabled={Boolean(avatarBusy) || offline} onclick={onremoveavatar}>Remove</button>
					{/if}
				</span>
				{#if onavatarfile}<input class="ap-sr" type="file" accept="image/*" tabindex="-1" aria-hidden="true" data-testid={avatarFileTestid} bind:this={fileInput} onchange={(e) => picked(e.currentTarget)} />{/if}
			{:else if avatar && onremoveavatar}
				<button type="button" class="ap-link ap-profedit-remove" disabled={Boolean(avatarBusy) || offline} onclick={onremoveavatar}>Remove avatar</button>
			{:else}
				<span class="ap-form-hint">This server doesn’t support profile pictures.</span>
			{/if}
			{#if avatarError}<span class="ap-form-hint ap-tone-danger" role="alert">{avatarError}</span>{/if}
		</div>
	</div>
	<div class="ap-profedit-group ap-profedit-fields">
		<div class="ap-profedit-field">
			<label class="ap-fieldlabel">Display name
				<input class="ap-field" data-testid={nameTestid} bind:value={() => name, (v) => { name = v; oninput?.(v); }} disabled={saving} maxlength="64" autocomplete="nickname" spellcheck="false" dir="auto" />
			</label>
			<!-- ap-profedit-hint: apron-server-go's interop suite reads your ID by `.ap-profedit-hint code`: the code holds the ID alone, its @ drawn before it. -->
			<p class="ap-form-hint ap-profedit-hint">Your ID is <code>{userId}</code>. It’s permanent.</p>
		</div>
		{#if status === 'altered'}<p class="ap-form-note" role="status">The server saved your name as “{serverName}”.</p>{/if}
		{#if status === 'declined'}<p class="ap-form-note ap-tone-danger" role="alert">{declinedNote ?? 'The server declined this name. Your old one is still in use.'}</p>{/if}
		{#if maxBio !== undefined}
			<label class="ap-fieldlabel"><span class="ap-fieldlabel-row"><span>Bio</span><span class={['ap-fieldlabel-hint', bioOver && 'ap-tone-danger']}>{bioLength}/{maxBio}</span></span>
				<textarea class="ap-field ap-field-multi" aria-label="Bio" aria-invalid={bioOver} data-testid={bioTestid} rows="4" bind:value={bio} disabled={saving} spellcheck="true" dir="auto" placeholder="A few words about you, in plain text"></textarea>
			</label>
			{#if bioError}<p class="ap-form-note ap-tone-danger" role="alert">{bioError}</p>{/if}
		{/if}
		{#if dirty || saving || oncancel}
			<div class="ap-profedit-actions">
				{#if oncancel}<Button variant="ghost" size="sm" onclick={oncancel} disabled={saving} label={status === 'altered' ? 'Close' : 'Cancel'} />{/if}
				{#if onrevert && dirty}<Button variant="ghost" size="sm" onclick={onrevert} disabled={saving} label="Revert" />{/if}
				<Button type="submit" variant="primary" size="sm" disabled={saving || !name.trim() || bioOver} label={saving ? 'Saving…' : 'Save'} />
			</div>
		{:else if status === 'saved'}
			<p class="ap-form-note ap-tone-ok ap-profedit-saved" role="status">Saved.</p>
		{/if}
	</div>
	{#if signin}
		<div class="ap-profedit-group ap-profedit-signin" role="group" aria-label="Sign-in">
			<span class="ap-fieldlabel">Sign-in</span>
			{@render signin()}
		</div>
	{/if}
	{#if signout}<div class="ap-profedit-group ap-profedit-signout">{@render signout()}</div>{/if}
	{#if onconnect}
		<div class="ap-profedit-group ap-profedit-server" role="group" aria-label="Server">
			<span class="ap-fieldlabel">Server</span>
			<span class="ap-profedit-buttons">
				<button class="ap-btn ap-btn-sm" type="button" onclick={onconnect}>Connect to a server…</button>
			</span>
		</div>
	{/if}
</form>
