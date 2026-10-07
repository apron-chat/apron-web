// @vitest-environment jsdom
import { flushSync, mount, tick, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { pausedUntilLabel, type PausedUntil } from '$lib/ui/pause';
import PauseNotifications from './PauseNotifications.svelte';

let instance: ReturnType<typeof mount> | undefined;

afterEach(() => {
	if (instance) unmount(instance);
	instance = undefined;
	document.body.innerHTML = '';
});

const button = (name: string) => [...document.querySelectorAll('button')].find((candidate) => candidate.textContent?.trim() === name);

describe('PauseNotifications', () => {
	it('moves focus to Resume once the pause is echoed, and back to Pause… after resuming', async () => {
		// The page's pause follows the server's echo, a moment after asking (`ChatClient.setMute`).
		const props = $state<{ until?: PausedUntil; onpause: (until: PausedUntil) => void; onresume: () => void }>({
			until: undefined,
			onpause: (until) => { queueMicrotask(() => { props.until = until; }); },
			onresume: () => { queueMicrotask(() => { props.until = undefined; }); }
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

	it('shows the pause the server echoed, not the one asked for', async () => {
		const asked: PausedUntil[] = [];
		const props = $state<{ until?: PausedUntil; onpause: (until: PausedUntil) => void; onresume: () => void }>({
			until: undefined,
			onpause: (until) => { asked.push(until); },
			onresume: () => undefined
		});
		instance = mount(PauseNotifications, { target: document.body, props });
		flushSync();
		button('Pause…')!.click();
		flushSync();
		await tick();
		[...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((item) => item.textContent === 'Until I resume')!.click();
		flushSync();
		await tick();
		// Asked, not yet echoed: still not paused.
		expect(asked).toEqual([true]);
		expect(document.body.textContent).not.toContain('Paused');
		expect(button('Pause…')).toBeDefined();
		// The server shortened it to an hour: that is what shows.
		const hour = Date.now() + 3_600_000;
		props.until = hour;
		flushSync();
		expect(document.body.textContent).toContain(`Paused ${pausedUntilLabel(hour)}`);
		expect(document.body.textContent).not.toContain('until you resume');
	});

	it('shows the server\'s error when a pause or resume is refused, and keeps the state it had', async () => {
		let refuse = true;
		const props = $state<{ until?: PausedUntil; onpause: (until: PausedUntil) => Promise<void>; onresume: () => Promise<void> }>({
			until: undefined,
			onpause: () => (refuse ? Promise.reject(new Error('Too Many Requests Try again in 5s.')) : Promise.resolve()),
			onresume: () => Promise.reject(new Error('Server busy'))
		});
		instance = mount(PauseNotifications, { target: document.body, props });
		flushSync();
		button('Pause…')!.click();
		flushSync();
		await tick();
		[...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((item) => item.textContent === 'Until I resume')!.click();
		flushSync();
		await tick();
		await tick();
		const alert = () => document.querySelector('[role="alert"]')?.textContent ?? '';
		expect(alert()).toContain('Notifications weren’t paused');
		expect(alert()).toContain('Try again in 5s.');
		expect(document.body.textContent).not.toContain('Paused until');
		expect(button('Pause…')).toBeDefined();
		// Asking again clears it.
		refuse = false;
		button('Pause…')!.click();
		flushSync();
		await tick();
		[...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((item) => item.textContent === 'Until I resume')!.click();
		flushSync();
		await tick();
		expect(alert()).toBe('');
		// Paused, then a refused resume: still paused, and why.
		props.until = true;
		flushSync();
		button('Resume')!.click();
		flushSync();
		await tick();
		await tick();
		expect(alert()).toContain('Notifications are still paused');
		expect(alert()).toContain('Server busy');
		expect(button('Resume')).toBeDefined();
	});
});
