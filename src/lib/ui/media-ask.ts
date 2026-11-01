/**
 * Media that waits for a click (Preferences' Media, `MediaGate.ask`): Load loads it on this page
 * (`directory.loadOnce`), Always load trusts its site from now on (`mediaSettings.trust`), Block blocks it
 * (`mediaSettings.block`). Components get them as props (`askProps`); markup gets them as buttons the sanitizer writes
 * (`data-media-load`, `data-media-trust`, `data-media-block`), which `mediaAskClick` answers for the whole page.
 */
import type { MediaAskProps } from '$lib/design/components/types';
import { directory } from './directory.svelte';
import type { MediaAsk } from './media-gate';
import { mediaSettings } from './media-settings.svelte';

/** What a component's MediaAsk does for `ask`. */
export function askProps(ask: MediaAsk): MediaAskProps {
	const { origin } = ask;
	return { url: ask.url, host: ask.host, onload: () => directory.loadOnce(ask.url), ...(origin ? { ontrust: () => mediaSettings.trust(origin), onblock: () => mediaSettings.block(origin) } : {}) };
}

/**
 * A click on Load, Always load or Block in markup the sanitizer wrote. Only it writes those attributes: DOMPurify keeps no
 * `data-` attribute it doesn't name, in a message or an embed.
 */
export function mediaAskClick(event: MouseEvent): void {
	const button = (event.target as Element | null)?.closest?.('button[data-media-load], button[data-media-trust], button[data-media-block]');
	if (!button) return;
	event.preventDefault();
	const load = button.getAttribute('data-media-load');
	if (load) directory.loadOnce(load);
	const trust = button.getAttribute('data-media-trust');
	if (trust) mediaSettings.trust(trust);
	const block = button.getAttribute('data-media-block');
	if (block) mediaSettings.block(block);
}
