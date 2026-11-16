<script lang="ts">
	import { untrack } from 'svelte';
	import { profilePreferences } from './lazy';
	import { pushState, replaceState } from '$app/navigation';
	import { page } from '$app/state';
	import { preferencesOpener, preferencesUrl, readPreferences } from '$lib/ui/preferences.svelte';
	import { pausedUntilLabel } from '$lib/ui/pause';
	import { shownPerson } from '$lib/protocol/plain-text';
	import { statusLabel, wayBackNudge } from '$lib/ui/connection';
	import { directory } from '$lib/ui/directory.svelte';
	import DesignProfileBar from '$lib/design/components/ProfileBar.svelte';
	import { ownStatusLabel } from '$lib/ui/user-status';
	import Avatar from '$lib/design/components/Avatar.svelte';
	import { hueOf } from '$lib/ui/messages';
	import type { PreferencesProps } from './ProfilePreferences.svelte';

	/** The bar, and Preferences, which comes with the code that loads on demand (`ProfilePreferences`) when it first opens. */
	let { client, session, backendLabel, displayName = $bindable(), passkeyUnavailable, notificationsEnabled, notificationsSupported, notificationPermission, notifyScopes, onnotifications, onnotifyscopes, ontestnotifications, webPush, onwebpush, oninstallapp, pause, onpause, onresume, onsignout, keptHistory, onsignin }: PreferencesProps = $props();

	let preferencesOpen = $state(false);
	/** Preferences mounts the first time it opens and then stays, so nothing of it renders or runs on a page that never opens it. */
	let preferencesMounted = $state(false);
	/** The section Preferences shows: Profile from the bar, the one last chosen, or the one asked for (`preferencesOpener`). */
	let preferencesSection = $state('profile');
	let preferencesTrigger = $state<HTMLButtonElement | undefined>();
	/** Preferences, once mounted: each later opening starts its Profile form afresh. */
	let preferences = $state<{ resetProfile(): void }>();
	let you = $derived(session.you);
	/** You as the bar shows you: your name without bidi embeddings and overrides (§3.5.2). */
	let shownYou = $derived(shownPerson(you));
	/** While notifications are paused, when that ends in words ("until 14:30"). */
	let paused = $derived(pause?.until !== undefined ? pausedUntilLabel(pause.until) : undefined);
	let avatar = $derived(directory.avatar(you));
	/** You as the bar shows you: your avatar only where avatars may load from. */
	let barYou = $derived(shownYou && { ...shownYou, avatar });
	/** Your `status` as you chose it (§4.5), from `you`: no dot without one. */
	let ownStatus = $derived(typeof you?.status === 'string' && you.status !== '' ? you.status : undefined);
	/** Not connected (connecting, or reconnecting): the dot isn't your status yet, so it says so, quietly. */
	let away = $derived(session.connection !== 'connected');
	/** The dot: your status once connected; until then, a placeholder ring, never online's green. */
	let shownStatus = $derived(ownStatus !== undefined && away ? 'unknown' : ownStatus);
	/** Its tooltip: invisible says how others see you; while not connected, what's happening. */
	let ownLabel = $derived(ownStatus !== undefined && away ? statusLabel(session.snapshot, session.stalled) : ownStatusLabel(ownStatus));
	/** No way back into the account but this browser's (see Preferences' Profile): the bar says to add a sign-in. */
	let wayBack = $derived(session.passkeySession ? wayBackNudge(session.server, session.signInMethods) : undefined);

	/** The bar's button: Preferences, at your profile. */
	function openProfile(): void {
		preferencesSection = 'profile';
		showPreferences();
	}

	function showPreferences(): void {
		preferences?.resetProfile();
		preferencesMounted = true;
		preferencesOpen = true;
	}

	// Asked from elsewhere on the page, such as Search's link to History: Preferences opens at that section.
	$effect(() => {
		const asked = preferencesOpener.asked;
		if (!asked) return;
		untrack(() => {
			preferencesOpener.asked = undefined;
			preferencesSection = asked.section;
			showPreferences();
		});
	});

	// The address names the open section (`#preferences=notifications`): a link to it opens Preferences there, and
	// Back and Forward, through the sections opened, change it.
	$effect(() => {
		const follow = () => {
			const section = readPreferences(window.location.hash);
			if (!section) {
				preferencesOpen = false;
				return;
			}
			preferencesSection = section;
			if (!preferencesOpen) showPreferences();
		};
		untrack(follow);
		window.addEventListener('hashchange', follow);
		return () => window.removeEventListener('hashchange', follow);
	});

	// Opening Preferences, and each section chosen, is a history entry; closing it returns to where it opened from.
	$effect(() => {
		const section = preferencesOpen ? preferencesSection : undefined;
		untrack(() => recordPreferences(section));
	});
	// Leaving with it open (Sign in opens the connect screen in its place) closes it in the address too.
	$effect(() => () => recordPreferences(undefined));

	function recordPreferences(section: string | undefined): void {
		if (readPreferences(window.location.hash) === section) return;
		/** How many entries Preferences has added since it opened. */
		const depth = page.state.preferences ?? 0;
		try {
			if (section) pushState(preferencesUrl(window.location.href, section), { ...page.state, preferences: depth + 1 });
			// Back past the entries it added; one opened by a link has none, so it closes in place.
			else if (depth) window.history.go(-depth);
			else replaceState(preferencesUrl(window.location.href, undefined), { ...page.state, preferences: undefined });
		} catch {
			// The router isn't started yet (in development): Preferences just isn't in the address.
		}
	}
</script>

<!-- The design system's ProfileBar draws it; the app fills in its avatar. -->
{#snippet barAvatar()}
	<Avatar name={shownYou?.name || you?.user_id || '?'} hue={hueOf(you?.user_id)} src={avatar} status={shownStatus} statusLabel={ownLabel} />
{/snippet}

<DesignProfileBar
	you={barYou}
	placeholder={session.starting ? 'Signing in…' : 'Not signed in'}
	backend={backendLabel}
	note={wayBack ? 'add a sign-in' : undefined}
	status={ownStatus}
	statusLabel={ownLabel}
	avatar={barAvatar}
	open={preferencesOpen}
	onopen={openProfile}
	{paused}
	bind:button={preferencesTrigger}
>
	{#if preferencesMounted && profilePreferences.component}
		{@const ProfilePreferences = profilePreferences.component}
		<ProfilePreferences
			bind:this={preferences}
			bind:open={preferencesOpen}
			bind:section={preferencesSection}
			onclosed={() => preferencesTrigger?.focus()}
			bind:displayName
			{client} {session} {backendLabel} {passkeyUnavailable} {notificationsEnabled} {notificationsSupported} {notificationPermission} {notifyScopes}
			{onnotifications} {onnotifyscopes} {ontestnotifications} {webPush} {onwebpush} {oninstallapp} {pause} {onpause} {onresume} {onsignout} {keptHistory} {onsignin}
		/>
	{/if}
</DesignProfileBar>
