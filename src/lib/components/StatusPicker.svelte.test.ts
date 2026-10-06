// @vitest-environment jsdom
import { flushSync, mount, tick, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import StatusPicker from './StatusPicker.svelte';

let instance: ReturnType<typeof mount> | undefined;

afterEach(() => {
	if (instance) unmount(instance);
	instance = undefined;
	document.body.innerHTML = '';
});

const trigger = () => document.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!;
const radios = () => [...document.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')];
const labels = () => radios().map((item) => item.querySelector('.ap-menu-label')?.textContent);

async function open(): Promise<void> {
	trigger().click();
	flushSync();
	await tick();
}

async function pick(label: string): Promise<void> {
	await open();
	radios().find((item) => item.querySelector('.ap-menu-label')?.textContent === label)!.click();
	flushSync();
	// The `me` request settles.
	await tick();
	await tick();
	flushSync();
}

/**
 * The picker as the profile bar mounts it: `status` follows what `onchoose`
 * resolves with, like `you` does. `accepted` is `server.status`; null leaves it out.
 */
function render(initial: string | undefined, answer: (asked: string) => string | undefined | Error | Promise<string | undefined>, accepted: string[] | null = ['dnd', 'invisible']) {
	const props = $state<{ status?: string; accepted?: string[]; unsupported: string[]; onchoose: (status: string) => Promise<string | undefined>; onunsupported: (status: string) => void; onannounce: (text: string | undefined) => void; announced: Array<string | undefined> }>({
		status: initial,
		...(accepted ? { accepted } : {}),
		unsupported: [],
		onchoose: vi.fn(async (asked: string) => {
			const kept = await answer(asked);
			if (kept instanceof Error) throw kept;
			props.status = kept;
			return kept;
		}),
		onunsupported: (status) => props.unsupported.push(status),
		onannounce: (text) => props.announced.push(text),
		announced: []
	});
	instance = mount(StatusPicker, { target: document.body, props });
	flushSync();
	return props;
}

describe('StatusPicker', () => {
	it('offers Online, Do not disturb, Invisible and None where server.status lists both, with the current one checked', async () => {
		render('online', (asked) => asked);
		expect(trigger().textContent).toBe('Online');
		expect(trigger().getAttribute('aria-label')).toBe('Status: Online');
		await open();
		expect(radios().map((item) => item.querySelector('.ap-menu-label')?.textContent)).toEqual(['Online', 'Do not disturb', 'Invisible', 'None']);
		expect(radios().map((item) => item.getAttribute('aria-checked'))).toEqual(['true', 'false', 'false', 'false']);
		// Each with its dot; None has none.
		expect(radios().map((item) => item.querySelector('.ap-presence')?.className.match(/ap-presence-(online|dnd|invisible)/)?.[1] ?? '')).toEqual(['online', 'dnd', 'invisible', '']);
	});

	it('offers only Online and None without server.status', async () => {
		render('online', (asked) => asked, null);
		await open();
		expect(labels()).toEqual(['Online', 'None']);
	});

	it('offers only Online and None for an empty server.status', async () => {
		render('online', (asked) => asked, []);
		await open();
		expect(labels()).toEqual(['Online', 'None']);
	});

	it('offers just the optional statuses server.status lists', async () => {
		render('online', (asked) => asked, ['dnd']);
		await open();
		expect(labels()).toEqual(['Online', 'Do not disturb', 'None']);
		document.body.innerHTML = '';
		if (instance) unmount(instance);
		render('online', (asked) => asked, ['invisible', 'busy']);
		await open();
		expect(labels()).toEqual(['Online', 'Invisible', 'None']);
	});

	it('follows a replacing server frame', async () => {
		const props = render('online', (asked) => asked, []);
		props.accepted = ['dnd', 'invisible'];
		flushSync();
		await open();
		expect(labels()).toEqual(['Online', 'Do not disturb', 'Invisible', 'None']);
	});

	it('keeps an unlisted current status listed and checked', async () => {
		render('dnd', (asked) => asked, []);
		expect(trigger().textContent).toBe('Do not disturb');
		await open();
		expect(labels()).toEqual(['Online', 'Do not disturb', 'None']);
		expect(radios().map((item) => item.getAttribute('aria-checked'))).toEqual(['false', 'true', 'false']);
	});

	it('takes the absent status as the default, online', () => {
		render(undefined, (asked) => asked);
		expect(trigger().textContent).toBe('Online');
	});

	it('sets the chosen status, and says what it means', async () => {
		const props = render('online', (asked) => asked);
		await pick('Do not disturb');
		expect(props.onchoose).toHaveBeenCalledWith('dnd');
		expect(trigger().textContent).toBe('Do not disturb');
		expect(document.querySelector('[data-testid="status-hint"]')?.textContent).toContain('notifications are silenced');
		expect(document.querySelector('.ap-callout')).toBeNull();
		await pick('None');
		expect(props.onchoose).toHaveBeenLastCalledWith('');
		expect(trigger().textContent).toBe('None');
		expect(document.querySelector('.ap-status-pick-dot .ap-presence')).toBeNull();
	});

	it('shows what the server answered for a listed optional status it substituted, and stops offering it', async () => {
		const props = render('online', (asked) => (asked === 'invisible' ? '' : asked));
		await pick('Invisible');
		expect(props.onchoose).toHaveBeenCalledWith('invisible');
		expect(trigger().textContent).toBe('None');
		const callout = document.querySelector('.ap-callout')!;
		expect(callout.querySelector('.ap-callout-title')?.textContent).toBe('This server doesn’t offer Invisible');
		expect(callout.textContent).toContain('Your status is None.');
		expect(props.unsupported).toEqual(['invisible']);
		await open();
		expect(labels()).toEqual(['Online', 'Do not disturb', 'None']);
	});

	it('says when the server declined', async () => {
		render('online', () => new Error('denied'));
		await pick('Do not disturb');
		expect(document.querySelector('.ap-callout')?.textContent).toContain('The server declined Do not disturb (denied).');
		expect(trigger().textContent).toBe('Online');
	});

	it('shows an unknown status as itself, with nothing checked', async () => {
		render('busy-coding', (asked) => asked);
		expect(trigger().textContent).toBe('“busy-coding”');
		expect(document.querySelector('.ap-status-pick-dot .ap-presence-unknown')).not.toBeNull();
		await open();
		expect(radios().every((item) => item.getAttribute('aria-checked') === 'false')).toBe(true);
	});

	it('keeps focus on the button while the choice is saved, and after', async () => {
		let reply!: (kept: string) => void;
		render('online', () => new Promise<string>((resolve) => (reply = resolve)));
		await open();
		radios().find((item) => item.querySelector('.ap-menu-label')?.textContent === 'Do not disturb')!.click();
		flushSync();
		await tick();
		// Saving: the button says so and can't open, but isn't disabled, which would drop focus.
		expect(trigger().textContent).toBe('Saving…');
		expect(trigger().disabled).toBe(false);
		expect(trigger().getAttribute('aria-disabled')).toBe('true');
		expect(document.activeElement).toBe(trigger());
		reply('dnd');
		await tick();
		await tick();
		flushSync();
		expect(trigger().textContent).toBe('Do not disturb');
		expect(trigger().hasAttribute('aria-disabled')).toBe(false);
		expect(document.activeElement).toBe(trigger());
	});

	it('says the server\'s answer through the dialog\'s live region, not one of its own', async () => {
		const props = render('online', (asked) => (asked === 'invisible' ? '' : asked));
		await pick('Invisible');
		expect(props.announced.at(-1)).toBe('This server doesn’t offer Invisible. Your status is None.');
		expect(document.querySelector('.ap-status-pick [role="status"], .ap-status-pick [aria-live]')).toBeNull();
		// A choice that works clears it.
		await pick('Online');
		expect(props.announced.at(-1)).toBeUndefined();
	});
});

