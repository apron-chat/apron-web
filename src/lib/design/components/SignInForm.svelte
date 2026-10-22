<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';
	import Button from './Button.svelte';
	import TypingDots from './TypingDots.svelte';

	const LABELS: Record<string, string> = { guest: 'Guest', webauthn: 'Passkey', email: 'Email', external: 'External', token: 'Token' };
	/** On Passkey, the two paths: each a title and what it does. */
	const PASSKEY_CHOICES = [
		['login', 'Sign in', 'I have a passkey'],
		['register', 'Create account', 'I’m new here']
	] as const;

	interface Props extends HTMLAttributes<HTMLFormElement> {
		/** Shown at the top of the card, such as ConnectScreen's title and Server field. */
		header?: Snippet;
		/** The sign-in schemes to offer (§3.1 `auth`, then the rest of `signup`), in order; an unknown one shows by its name. */
		schemes: string[];
		/** The scheme shown; its fields follow (Token a token, Email an address). */
		scheme: string;
		onscheme?: (scheme: string) => void;
		/** On Passkey, where passkeys both sign in and create accounts: asks which (`passkeyMode`), never a guess. */
		passkeyChoice?: boolean;
		passkeyMode?: 'login' | 'register';
		onpasskeymode?: (mode: 'login' | 'register') => void;
		/** `bind:token`, `bind:email`, `bind:code` and `bind:name` (the display name). */
		token?: string;
		email?: string;
		code?: string;
		name?: string;
		/** Asks a display name; not where it isn't used, such as signing in with a passkey or a token. */
		askName?: boolean;
		/**
		 * The code asked for (§4.11): its field shows, and the hint says where it went: emailed to `email`,
		 * or shown on the external sign-in `page` (§4.11.5), linked here to open in a new tab.
		 */
		sent?: { scheme: 'email' | 'external'; email?: string; page?: string };
		/** Gives up the code asked for: Use another address (email), or Start again. */
		onrestart?: () => void;
		/** What the chosen scheme does, or what to do next. */
		hint?: string;
		/** The hint is news, said as a status (such as "Connected. Tap again…"). */
		hintStatus?: boolean;
		/** The server's error `message` when it gave one (§1.1). */
		error?: string;
		/** Something is under way: the controls wait, and dots show by the submit. */
		busy?: boolean;
		/** The submit's label, such as Connect or Email me a code. */
		submit: string;
		/** `data-testid` on the submit. */
		submitTestid?: string;
		/** A quiet action before the submit, such as Cancel or Stay a guest. */
		secondary?: { label: string; onclick: () => void };
	}
	let {
		header, schemes, scheme, onscheme, passkeyChoice = false, passkeyMode = 'login', onpasskeymode, token = $bindable(''), email = $bindable(''), code = $bindable(''), name = $bindable(''),
		askName = true, sent, onrestart, hint, hintStatus = false, error, busy = false, submit, submitTestid, secondary, ...rest
	}: Props = $props();
</script>

<form {...rest} class="ap-connect-card">
	{@render header?.()}
	<div class="ap-fieldlabel">Sign in with
		<div class="ap-seg" role="radiogroup" aria-label="Sign in with">
			{#each schemes as candidate (candidate)}
				<button class="ap-seg-item" class:ap-seg-on={scheme === candidate} type="button" role="radio" aria-checked={scheme === candidate} disabled={busy} onclick={() => onscheme?.(candidate)}>{LABELS[candidate] ?? candidate}</button>
			{/each}
		</div>
	</div>
	{#if passkeyChoice}
		<div class="ap-choice" role="radiogroup" aria-label="Passkey" data-testid="passkey-choice">
			{#each PASSKEY_CHOICES as [value, title, text] (value)}
				<button class="ap-choice-item" class:ap-choice-on={passkeyMode === value} type="button" role="radio" aria-checked={passkeyMode === value} data-testid="passkey-choice-{value}" disabled={busy} onclick={() => onpasskeymode?.(value)}>
					<span class="ap-choice-title">{title}</span>
					<span class="ap-choice-text">{text}</span>
				</button>
			{/each}
		</div>
	{/if}
	{#if scheme === 'token'}
		<label class="ap-fieldlabel">Token
			<input class="ap-field ap-field-mono" data-testid="connect-token-input" type="password" bind:value={token} placeholder="apron_bot_…" disabled={busy} autocomplete="off" spellcheck="false" />
		</label>
		{#if askName}
			{@render nameField()}
		{/if}
	{:else}
		{#if scheme === 'email'}
			<label class="ap-fieldlabel">Email
				<input class="ap-field" data-testid="connect-email-input" type="email" bind:value={email} placeholder="you@example.com" disabled={busy || Boolean(sent)} autocomplete="email" spellcheck="false" />
			</label>
		{/if}
		{#if sent}
			<label class="ap-fieldlabel">Code
				<!-- svelte-ignore a11y_autofocus -->
				<input class="ap-field ap-field-mono" data-testid="connect-code-input" bind:value={code} placeholder={sent.scheme === 'email' ? 'From the email' : 'From the sign-in page'} disabled={busy} inputmode={sent.scheme === 'email' ? 'numeric' : 'text'} autocomplete="one-time-code" spellcheck="false" autofocus />
			</label>
		{/if}
		{#if askName}
			{@render nameField()}
		{/if}
	{/if}
	{#if sent?.scheme === 'email'}
		<p class="ap-profedit-hint" role="status">If {sent.email} can sign in here, a code is on its way. Enter it, or open the link in the email.</p>
		<button class="ap-link ap-connect-other" type="button" disabled={busy} onclick={onrestart}>Use another address, or send a new code</button>
	{:else if sent?.page}
		<!-- The server won't send the viewer back here (§4.11.5): its page shows a code to type here instead. -->
		<p class="ap-profedit-hint" role="status">
			<a href={sent.page} target="_blank" rel="noopener noreferrer" data-testid="external-page-link">Open the sign-in page</a>, sign in there, then enter the code it shows you.
		</p>
		<button class="ap-link ap-connect-other" type="button" disabled={busy} onclick={onrestart}>Start again</button>
	{:else}
		<p class="ap-profedit-hint" role={hintStatus ? 'status' : undefined}>{hint}</p>
	{/if}
	{#if error}<p class="ap-profedit-note ap-profedit-err" role="alert">{error}</p>{/if}
	<div class="ap-connect-actions">
		{#if busy}<TypingDots />{/if}
		{#if secondary}
			<Button variant="ghost" label={secondary.label} onclick={secondary.onclick} />
		{/if}
		<Button type="submit" variant="primary" data-testid={submitTestid} disabled={busy} label={submit} />
	</div>
</form>

{#snippet nameField()}
	<label class="ap-fieldlabel">Display name
		<input class="ap-field" data-testid="connect-name-input" bind:value={name} placeholder={scheme === 'webauthn' ? 'Names your account and its passkey' : 'How others see you'} disabled={busy} maxlength="64" autocomplete="nickname" spellcheck="false" />
	</label>
{/snippet}
