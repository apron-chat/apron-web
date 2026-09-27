<script lang="ts">
	import Avatar from './Avatar.svelte';
	import Button from './Button.svelte';
	import TypingDots from './TypingDots.svelte';
	import { cx } from './util';

	interface Props {
		userId: string;
		/** Display name — sent as `me` `{name}` (§3.3); `you.name` in the result is the answer. `bind:name` in Svelte. */
		name?: string;
		oninput?: (name: string) => void;
		avatar?: string;
		/** Caps `command` and `embed:upload`: a `/avatar` command with one `upload` embed (§4.6.6). */
		canUpload?: boolean;
		onchangeavatar?: () => void;
		/** Sends `me` `{avatar: ""}`. */
		onremoveavatar?: () => void;
		/** The request went out but `you.avatar` didn't change. */
		avatarKept?: boolean;
		/** saving · altered: `you.name` differs from what you asked (`serverName`) · declined */
		status?: 'idle' | 'saving' | 'altered' | 'declined';
		serverName?: string;
		onsave?: () => void;
		oncancel?: () => void;
		/** `server.auth` lists `webauthn` and this session isn't one: "Add passkey" runs `auth` action "register" (§4.9). */
		canPasskey?: boolean;
		onaddpasskey?: () => void;
		passkey?: 'idle' | 'waiting' | 'done' | 'declined' | 'cancelled';
	}
	let { userId, name = $bindable(''), oninput, avatar, canUpload, onchangeavatar, onremoveavatar, avatarKept, status = 'idle', serverName, onsave, oncancel, canPasskey, onaddpasskey, passkey }: Props = $props();
	const saving = $derived(status === 'saving');
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role -->
<form class="ap-profedit" role="dialog" aria-label="Edit profile" onsubmit={(e) => { e.preventDefault(); onsave?.(); }}>
	<div class="ap-profedit-top">
		<Avatar name={name || userId} src={avatar} size="lg" />
		<div class="ap-profedit-av">
			{#if canUpload}
				<span class="ap-profedit-avbtns">
					<Button size="sm" onclick={onchangeavatar} disabled={saving} label={avatar ? 'Change avatar' : 'Add avatar'} />
					{#if avatar && onremoveavatar}<button type="button" class="ap-link ap-profedit-remove" onclick={onremoveavatar} disabled={saving}>Remove</button>{/if}
				</span>
			{:else if avatar && onremoveavatar}
				<button type="button" class="ap-link ap-profedit-remove" onclick={onremoveavatar} disabled={saving}>Remove avatar</button>
			{:else}
				<span class="ap-profedit-hint">This backend doesn’t take avatar uploads, so your avatar can’t be set here.</span>
			{/if}
			{#if avatarKept}<span class="ap-profedit-hint">The server kept your previous avatar.</span>{/if}
		</div>
	</div>
	<label class="ap-fieldlabel">Handle
		<input class="ap-field" bind:value={name} oninput={() => oninput?.(name)} disabled={saving} maxlength="64" autocomplete="nickname" spellcheck="false" />
	</label>
	<p class="ap-profedit-hint">ID <code>{userId}</code> · set by the server, can’t be changed</p>
	{#if status === 'altered'}<p class="ap-profedit-note" role="status">The server saved your handle as “{serverName}”.</p>{/if}
	{#if status === 'declined'}<p class="ap-profedit-note ap-profedit-err" role="alert">The server declined this handle. Your old one is still in use.</p>{/if}
	{#if canPasskey}
		<div class="ap-profedit-signin">
			<span class="ap-fieldlabel">Sign-in</span>
			{#if passkey === 'done'}<span class="ap-profedit-hint ap-profedit-ok">Passkey saved · this backend will ask your device next time</span>
			{:else if passkey === 'waiting'}<span class="ap-profedit-hint"><TypingDots />{' Confirm on your device…'}</span>
			{:else}
				<span class="ap-profedit-row">
					<Button size="sm" onclick={onaddpasskey} disabled={saving} label="Add passkey" />
					<span class={cx('ap-profedit-hint', passkey === 'declined' && 'ap-profedit-err')}>{passkey === 'declined' ? 'The server didn’t accept it. Your token still works.' : passkey === 'cancelled' ? 'Cancelled. Your token still works.' : 'Signed in with a token'}</span>
				</span>
			{/if}
		</div>
	{/if}
	<div class="ap-profedit-actions">
		<Button variant="ghost" size="sm" onclick={oncancel} disabled={saving} label={status === 'altered' ? 'Close' : 'Cancel'} />
		<Button type="submit" variant="primary" size="sm" disabled={saving} label={saving ? 'Saving…' : 'Save'} />
	</div>
</form>
