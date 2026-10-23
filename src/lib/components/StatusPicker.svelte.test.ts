// @vitest-environment jsdom
import { flushSync, tick } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import StatusPicker from './StatusPicker.svelte';
import * as dom from '$lib/test/dom';

// Which statuses are offered is `statusChoices`' decision (`user-status.test.ts`); here, the picker around it.

const LABELS = ['Online', 'Do not disturb', 'Invisible', 'None'];
const trigger = () => dom.byRole<HTMLButtonElement>('button', /^Status: /);
/** The menu's choice whose name starts with `label` (its hint follows). */
const choice = (label: string) => dom.queryByRole<HTMLButtonElement>('menuitemradio', new RegExp(`^${label}`));
const offered = () => LABELS.filter((label) => choice(label));
const checked = () => offered().filter((label) => choice(label)!.getAttribute('aria-checked') === 'true');
const note = () => dom.queryByRole('note');

async function open(): Promise<void> {
	trigger().click();
	flushSync();
	await tick();
}

async function pick(label: string): Promise<void> {
	await open();
	choice(label)!.click();
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
	dom.render(StatusPicker, props);
	return props;
}

describe('StatusPicker', () => {
	it('offers the choices with the current one checked, each with its dot, and follows a replacing server frame', async () => {
		const props = render('online', (asked) => asked, null);
		expect(trigger().textContent).toBe('Online');
		await open();
		expect([offered(), checked()]).toEqual([['Online', 'None'], ['Online']]);
		props.accepted = ['dnd', 'invisible'];
		flushSync();
		expect([offered(), checked()]).toEqual([LABELS, ['Online']]);
		// Each with its dot; None has none.
		expect(LABELS.map((label) => choice(label)!.querySelector('.ap-presence')?.className.match(/ap-presence-(online|dnd|invisible)/)?.[1] ?? '')).toEqual(['online', 'dnd', 'invisible', '']);
	});

	it('shows an absent status as Online, and an unknown one as itself, with nothing checked', async () => {
		render(undefined, (asked) => asked);
		expect(trigger().getAttribute('aria-label')).toBe('Status: Online');
		dom.cleanup();
		render('busy-coding', (asked) => asked);
		expect(trigger().textContent).toBe('“busy-coding”');
		expect(trigger().getAttribute('aria-label')).toBe('Status: busy-coding');
		expect(document.querySelector('.ap-status-pick-dot .ap-presence-unknown')).not.toBeNull();
		await open();
		expect(checked()).toEqual([]);
	});

	it('sets the chosen status, and says what it means', async () => {
		const props = render('online', (asked) => asked);
		await pick('Do not disturb');
		expect(props.onchoose).toHaveBeenCalledWith('dnd');
		expect(trigger().textContent).toBe('Do not disturb');
		expect(document.body.textContent).toContain('Your notifications are silenced.');
		expect(note()).toBeNull();
		await pick('None');
		expect(props.onchoose).toHaveBeenLastCalledWith('');
		expect(trigger().textContent).toBe('None');
		expect(document.body.textContent).toContain('Others see no status.');
		// Its own dot beside the button goes with it.
		expect(document.querySelector('.ap-status-pick-dot .ap-presence')).toBeNull();
	});

	it('shows what the server answered for a listed optional status it substituted, through the dialog’s live region, and stops offering it', async () => {
		const props = render('online', (asked) => (asked === 'invisible' ? '' : asked));
		await pick('Invisible');
		expect(props.onchoose).toHaveBeenCalledWith('invisible');
		expect(trigger().textContent).toBe('None');
		expect(note()?.textContent).toContain('This server doesn’t offer Invisible');
		expect(note()?.textContent).toContain('Your status is None.');
		expect(props.unsupported).toEqual(['invisible']);
		// Said through the dialog's live region, not one of its own.
		expect(props.announced.at(-1)).toBe('This server doesn’t offer Invisible. Your status is None.');
		expect(document.querySelector('[role="status"], [aria-live]')).toBeNull();
		await open();
		expect(offered()).toEqual(['Online', 'Do not disturb', 'None']);
		// A choice that works clears it.
		choice('Online')!.click();
		flushSync();
		await tick();
		await tick();
		expect(props.announced.at(-1)).toBeUndefined();
	});

	it('says when the server declined', async () => {
		render('online', () => new Error('denied'));
		await pick('Do not disturb');
		expect(note()?.textContent).toContain('The server declined Do not disturb (denied).');
		expect(trigger().textContent).toBe('Online');
	});

});
