<script lang="ts">
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
		avatar?: string;
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
		/** saving · altered: `you.name` differs from what you asked (`serverName`) · declined (`declinedNote`) */
		status?: 'idle' | 'saving' | 'altered' | 'declined';
		serverName?: string;
		/**
		 * The declined note's words, in place of “The server declined this handle. Your old one is still in use.”,
		 * such as with what the server said, or what happens to the handle next.
		 */
		declinedNote?: string;
		onsave?: () => void;
		oncancel?: () => void;
		/**
		 * A Sign-in group under the handle: how this session signs in, and the ways to add or switch, such as
		 * buttons for the schemes the server offers with a line saying how it stands.
		 */
		signin?: Snippet;
		/** The form is the dialog (the default); off inside a <ProfileBar>, whose popover is. */
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
		userId, name = $bindable(''), oninput, avatar, face, canUpload, onavatarfile, onremoveavatar, avatarBusy, avatarError, offline,
		bio = $bindable(''), maxBio, bioError, status = 'idle', serverName, declinedNote, onsave, oncancel, signin, dialog = true,
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
	<div class="ap-profedit-top">
		{#if face}{@render face()}{:else}<Avatar name={name || userId} src={avatar} size="lg" />{/if}
		<div class="ap-profedit-av">
			{#if canUpload}
				<span class="ap-profedit-avbtns">
					<Button size="sm" data-testid={changeAvatarTestid} disabled={saving || Boolean(avatarBusy) || offline} onclick={() => fileInput?.click()} label={avatarBusy === 'uploading' ? 'Uploading…' : avatar ? 'Change avatar' : 'Add avatar'} />
					{#if avatar && onremoveavatar}
						<button type="button" class="ap-link ap-profedit-remove" data-testid={removeAvatarTestid} disabled={Boolean(avatarBusy) || offline} onclick={onremoveavatar}>Remove</button>
					{/if}
				</span>
				{#if onavatarfile}<input class="ap-sr" type="file" accept="image/*" tabindex="-1" aria-hidden="true" data-testid={avatarFileTestid} bind:this={fileInput} onchange={(e) => picked(e.currentTarget)} />{/if}
			{:else if avatar && onremoveavatar}
				<button type="button" class="ap-link ap-profedit-remove" disabled={Boolean(avatarBusy) || offline} onclick={onremoveavatar}>Remove avatar</button>
			{:else}
				<span class="ap-profedit-hint">This backend doesn’t take uploads, so your avatar can’t be set here.</span>
			{/if}
			{#if avatarError}<span class="ap-profedit-hint ap-tone-danger" role="alert">{avatarError}</span>{/if}
		</div>
	</div>
	<label class="ap-fieldlabel">Handle
		<input class="ap-field" data-testid={nameTestid} bind:value={() => name, (v) => { name = v; oninput?.(v); }} disabled={saving} maxlength="64" autocomplete="nickname" spellcheck="false" dir="auto" />
	</label>
	<p class="ap-profedit-hint">ID <code>{userId}</code> · set by the server, can’t be changed</p>
	{#if status === 'altered'}<p class="ap-profedit-note" role="status">The server saved your handle as “{serverName}”.</p>{/if}
	{#if status === 'declined'}<p class="ap-profedit-note ap-tone-danger" role="alert">{declinedNote ?? 'The server declined this handle. Your old one is still in use.'}</p>{/if}
	{#if maxBio !== undefined}
		<label class="ap-fieldlabel"><span class="ap-fieldlabel-row"><span>Bio</span><span class={['ap-fieldlabel-hint', bioOver && 'ap-tone-danger']}>{bioLength}/{maxBio}</span></span>
			<textarea class="ap-field ap-field-multi" aria-label="Bio" aria-invalid={bioOver} data-testid={bioTestid} rows="4" bind:value={bio} disabled={saving} spellcheck="true" dir="auto" placeholder="A few words about you, in plain text"></textarea>
		</label>
		{#if bioError}<p class="ap-profedit-note ap-tone-danger" role="alert">{bioError}</p>{/if}
	{/if}
	{#if signin}
		<div class="ap-profedit-signin" role="group" aria-label="Sign-in">
			<span class="ap-fieldlabel">Sign-in</span>
			{@render signin()}
		</div>
	{/if}
	<div class="ap-profedit-actions">
		<Button variant="ghost" size="sm" onclick={oncancel} disabled={saving} label={status === 'altered' ? 'Close' : 'Cancel'} />
		<Button type="submit" variant="primary" size="sm" disabled={saving || !name.trim() || bioOver} label={saving ? 'Saving…' : 'Save'} />
	</div>
</form>
