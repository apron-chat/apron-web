// @vitest-environment jsdom
import type { Component } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import Composer from './Composer.svelte';
import Mention from './Mention.svelte';
import RoomHeader from './RoomHeader.svelte';
import RoomItem from './RoomItem.svelte';
import SelectionBar from './SelectionBar.svelte';
import ThreadItem from './ThreadItem.svelte';
import ThreadMarker from './ThreadMarker.svelte';
import * as dom from '$lib/test/dom';
import { byText } from '$lib/test/queries';

/** What the element showing exactly `text` shows, and its tooltip. */
function shown(text: string): [string, string | null] {
	const element = byText(text);
	return [element.textContent!, element.getAttribute('title')];
}

/** Where a component reads the name: its text and tooltip. */
type Read = () => [text: string, tip: string | null];

/**
 * Every component that names a room or thread uses the one rule (`roomName` and `roomNameTip`, whose own table test
 * is naming.test.ts): a blank title is no title, so a thread reads "Untitled" with its room_id on hover, and a room reads its
 * room_id, with no tooltip. Each row renders a blank title where the component shows a name, and reads what it shows.
 */
const rows: Array<[where: string, component: Component<any>, props: Record<string, unknown>, read: Read, expected: [string, string | null]]> = [
	['ThreadMarker, its card', ThreadMarker, { thread: 't1', name: '' }, () => shown('Untitled'), ['Untitled', 't1']],
	['ThreadMarker, its Moved to line', ThreadMarker, { thread: 't1', name: '  ', moved: true }, () => shown('Untitled'), ['Untitled', 't1']],
	['ThreadItem', ThreadItem, { thread: 't1', name: '   ' }, () => shown('Untitled'), ['Untitled', 't1']],
	['SelectionBar, a thread to move to', SelectionBar, { count: 1, threads: [{ thread: 't1', name: ' ' }], open: true }, () => shown('Untitled'), ['Untitled', 't1']],
	['RoomHeader, the open thread', RoomHeader, { room: 'ops', name: 'Ops', thread: 't1', threadName: '', onroom: vi.fn() }, () => shown('Untitled'), ['Untitled', 't1']],
	['Mention, a thread', Mention, { roomId: 't1', thread: true, hash: true, onopen: vi.fn() }, () => {
		const chip = dom.button('#Untitled');
		return [chip.textContent!, chip.title];
	}, ['#Untitled', 'Open Untitled (#t1)']],
	['Composer, replying in a thread', Composer, { room: 'Ops', thread: { thread: 't1', name: '' } }, () => {
		const field = dom.byRole<HTMLTextAreaElement>('textbox', 'Message');
		return [field.placeholder, field.getAttribute('title')];
	}, ['Reply in Untitled', null]],
	['RoomItem', RoomItem, { room: 'ops', name: '  ' }, () => shown('ops'), ['ops', null]],
	['RoomHeader, the room above a thread', RoomHeader, { room: 'ops', name: ' ', thread: 't1', threadName: 'Deploy', onroom: vi.fn() }, () => {
		const crumb = dom.button('Back to room');
		return [crumb.textContent!, crumb.getAttribute('title')];
	}, ['ops', null]],
	['Mention, a room', Mention, { roomId: 'ops', onopen: vi.fn() }, () => {
		const chip = dom.button('ops');
		return [chip.textContent!, chip.title];
	}, ['ops', 'Open ops']]
];

describe('naming a room or thread', () => {
	it('names one with a blank title by the one rule wherever it shows, and gives a titled thread no tooltip', () => {
		for (const [where, component, props, read, expected] of rows) {
			dom.render(component, props);
			expect(read(), where).toEqual(expected);
			dom.unmount();
		}
		dom.render(RoomHeader, { room: 'ops', name: 'Ops', thread: 't1', threadName: 'Deploy', onroom: vi.fn() });
		expect(shown('Deploy')).toEqual(['Deploy', null]);
	});
});
