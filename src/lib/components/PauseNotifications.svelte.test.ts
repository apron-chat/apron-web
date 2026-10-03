// @vitest-environment jsdom
import { flushSync, mount, tick, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import type { PausedUntil } from '$lib/ui/pause';
import PauseNotifications from './PauseNotifications.svelte';

let instance: ReturnType<typeof mount> | undefined;

afterEach(() => {
	if (instance) unmount(instance);
	instance = undefined;
	document.body.innerHTML = '';
});

const button = (name: string) => [...document.querySelectorAll('button')].find((candidate) => candidate.textContent?.trim() === name);

describe('PauseNotifications', () => {
	it('moves focus to Resume after pausing, and back to Pause… after resuming', async () => {
		// The page applies a pause at once, as `ChatClient.setMute` does.
		const props = $state<{ until?: PausedUntil; onpause: (until: PausedUntil) => void; onresume: () => void }>({
			until: undefined,
			onpause: (until) => { props.until = until; },
			onresume: () => { props.until = undefined; }
		});
		instance = mount(PauseNotifications, { target: document.body, props });
		flushSync();
		button('Pause…')!.click();
		flushSync();
		await tick();
		const forever = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((item) => item.textContent === 'Until I resume')!;
		forever.click();
		flushSync();
		await tick();
		await tick();
		expect(props.until).toBe(true);
		expect(document.body.textContent).toContain('Paused until you resume');
		expect(document.activeElement).toBe(button('Resume'));
		button('Resume')!.click();
		flushSync();
		await tick();
		await tick();
		expect(props.until).toBeUndefined();
		expect(document.activeElement).toBe(button('Pause…'));
	});
});
