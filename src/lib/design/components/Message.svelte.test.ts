// @vitest-environment jsdom
import { flushSync, tick } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Message from './Message.svelte';
import type { MessageCaps, MessageHandlers, MessageView } from './types';
import * as dom from '$lib/test/dom';
import { byText } from '$lib/test/queries';

const NONE: MessageCaps = { reply: false, edit: false, startThread: false, select: false, removeReply: false, react: false, link: false };
const ALL: MessageCaps = { reply: true, edit: true, startThread: true, select: true, removeReply: true, react: true, link: true };
const ada = { user_id: 'ada', name: 'Ada' };

function view(fields: Partial<MessageView> = {}): MessageView {
	return { id: '1', sender: ada, timestamp: 1710000000000, body: { html: 'hi' }, caps: NONE, ...fields };
}

function render(fields: Partial<MessageView> = {}, on: MessageHandlers = {}, props: Record<string, unknown> = {}) {
	dom.render(Message, { view: view(fields), on, ...props });
	return document.querySelector('article')!;
}

/** The toolbar is built once a pointer or focus reaches the row. */
function engage(row: Element): void {
	row.dispatchEvent(new Event('pointerenter'));
	flushSync();
}

const click = (target: Element, init: MouseEventInit = {}) => target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ...init }));

afterEach(() => {
	vi.useRealTimers();
});

describe('a message row', () => {
	it('shows its read receipts at the end of its first line, hidden from assistive tech, and not while editing', () => {
		const seen = render({ seenBy: [{ user_id: 'bob', name: 'Bob' }] }, {}, { testids: { receipts: 'seen' } }).querySelector('[data-testid="seen"]')!;
		expect(seen.classList.contains('ap-msg-receipts')).toBe(true);
		expect(seen.getAttribute('aria-hidden')).toBe('true');
		expect(seen.getAttribute('title')).toBe('Seen by Bob');
		dom.cleanup();
		expect(render({ seenBy: [{ user_id: 'bob', name: 'Bob' }], editing: true }).querySelector('.ap-msg-receipts')).toBeNull();
		dom.cleanup();
	});

	it('keeps its header to the name, handle, badges and time in that order', () => {
		const row = render({ sender: { user_id: 'bart', name: 'Bartholomew Maximilian Featherstonehaugh-Cholmondeley', handle: 'bart', roles: ['admin', 'bot'] } });
		const head = row.querySelector('header')!;
		expect([...head.children].map((part) => part.className)).toEqual(['ap-msg-sender ap-msg-who', 'ap-msg-handle', 'ap-roles', 'ap-msg-meta']);
		expect(dom.button('Bartholomew Maximilian Featherstonehaugh-Cholmondeley')).not.toBeNull();
		expect(byText('@bart')).not.toBeNull();
		// Every badge stays in the document, for screen readers, whether or not its row has room to show it.
		expect([...head.querySelectorAll('[title^="Role"]')].map((badge) => badge.textContent)).toEqual(['admin', 'bot']);
		expect(row.querySelector('time')?.getAttribute('datetime')).toBe(new Date(1710000000000).toISOString());
	});

	it('shows no handle unless the view says it tells people apart, and no badges without roles', () => {
		const row = render({ sender: { user_id: 'bart', name: 'Bart' } });
		expect(row.querySelector('header')!.textContent).not.toContain('@bart');
		expect(row.querySelector('[title^="Role"]')).toBeNull();
	});

	it('opens the sender from their name, and from their avatar for the pointer only, when it can show profiles', () => {
		const openProfile = vi.fn(() => true);
		const row = render({}, { openProfile });
		const name = dom.button('Ada');
		expect([name.dataset.userId, name.getAttribute('aria-haspopup'), name.title]).toEqual(['ada', 'dialog', 'Show profile']);
		const face = row.querySelector<HTMLElement>('button[aria-hidden="true"]')!;
		expect([face.dataset.userId, face.tabIndex]).toEqual(['ada', -1]);
		click(name);
		expect(openProfile).toHaveBeenCalledWith(name);
	});

	it('draws a follower of a group without avatar or header, its time on hover, but never a reply', () => {
		let row = render({ grouped: true });
		expect(row.querySelector('header')).toBeNull();
		expect(row.querySelector('time')?.textContent).toBeTruthy();
		dom.unmount();
		// A quote leads into the avatar, so a reply isn't grouped even when asked to be.
		row = render({ grouped: true, reply: {} });
		expect(row.querySelector('header')).not.toBeNull();
		expect(byText('Message unavailable')).not.toBeNull();
	});

	it('quotes the message it replies to, and jumps there', () => {
		const jump = vi.fn();
		render({ reply: { id: '7', name: 'Bob', snippet: ['ping ', { user_id: 'ada', name: 'Ada', me: true }, ' and ', { roomId: 'ops', name: 'Ops', hash: true }] } }, { jump });
		const quote = dom.button('Replying to Bob. Jump to their message');
		expect(quote.textContent).toContain('ping @Ada and #Ops');
		quote.click();
		expect(jump).toHaveBeenCalledWith('7');
		dom.unmount();
		render({ reply: { id: '7', name: 'Bob', deleted: true } });
		expect(dom.button('Replying to Bob. Jump to their message').textContent).toContain('Message deleted');
	});

	it('shows a card for each link to a message, room or thread under its text, each the link, and leaves a click on one to the link', () => {
		const href = 'https://link.apron.chat/#server=wss://chat.example/ws&room=ops&message=7';
		const beginSelect = vi.fn();
		const row = render({
			caps: { ...NONE, select: true },
			linkCards: [
				{ kind: 'message', href, server: 'chat.example', in: { id: 'ops', title: 'Ops' }, sender: { name: 'Bob' }, timestamp: 1710000000000, time: 'Yesterday 2:05 PM', snippet: ['ship it ', { user_id: 'ada', name: 'Ada', me: true }, '\nnow'] },
				{ kind: 'message', href: `${href}0`, server: 'chat.example', in: { id: 'r-8f2a', unknown: true } },
				{ kind: 'room', href: `${href}1`, server: 'chat.example', room: { id: 'ops', title: 'Ops' }, members: 1, private: true, description: 'All things ops' },
				{ kind: 'thread', href: `${href}2`, server: 'chat.example', in: { id: 'ops', title: 'Ops' }, room: { id: 't1', thread: true }, members: 1200 }
			]
		}, { beginSelect }, { testids: { linkCard: 'card' } });
		const cards = [...row.querySelectorAll<HTMLAnchorElement>('[data-testid="card"]')];
		const read = (card: Element) => [...card.querySelector('.ap-embed-cardtext')!.children].map((part) => part.textContent!.replace(/\s*›\s*/g, ' › ').replace(/\s+/g, ' ').trim());
		expect(cards[0].getAttribute('href')).toBe(href);
		// A link preview's card: its site line the path ending in the kind, the title, the description.
		expect(cards[0].classList.contains('ap-embed-ogcard')).toBe(true);
		expect(read(cards[0])).toEqual(['chat.example › #Ops › Message', 'BBobYesterday 2:05 PM', 'ship it @Ada now']);
		expect(cards[0].getAttribute('aria-label')).toBe('Message from Bob in #Ops on chat.example. Open it');
		// Not loaded here: the path alone, an unknown room as its ID.
		expect(read(cards[1])).toEqual(['chat.example › r-8f2a › Message']);
		expect(cards[1].querySelector('.ap-linkcard-id')!.textContent).toBe('r-8f2a');
		expect(read(cards[2])).toEqual(['chat.example › Room · 1 member', '#Ops', 'All things ops']);
		// Private as everywhere else a room is named: the lock beside its name.
		expect(cards[2].querySelector('.ap-linkcard-title .ap-lock')!.getAttribute('aria-label')).toBe('Private');
		expect(cards[2].getAttribute('aria-label')).toBe('Room #Ops on chat.example. Open it');
		// An untitled thread is "Untitled", its room_id in the tooltip.
		expect(read(cards[3])).toEqual(['chat.example › #Ops › Thread · 1,200 members', 'Untitled']);
		expect(cards[3].querySelector('.ap-linkcard-title .ap-linkcard-step')!.getAttribute('title')).toBe('t1');
		// After the body, before the embeds.
		expect(row.querySelector('.ap-msg-text + .ap-msg-linkcards')).not.toBeNull();
		// The page follows the link; here nothing does.
		const follow = (event: Event) => event.preventDefault();
		document.addEventListener('click', follow);
		click(cards[0].querySelector('.ap-linkcard-text')!, { shiftKey: true });
		document.removeEventListener('click', follow);
		expect(beginSelect).not.toHaveBeenCalled();
		dom.unmount();
		expect(render({ deleted: true, linkCards: [{ kind: 'room', href, server: 'h' }] }).querySelector('.ap-linkcard')).toBeNull();
		dom.unmount();
		expect(read(render({ linkCards: [{ kind: 'message', href, server: 'h', in: { id: 'ops' }, sender: { name: 'Bob' }, deleted: true }] }).querySelector('.ap-linkcard')!)).toEqual(['h › #ops › Message', 'BBob', 'Message deleted']);
	});

	it('hides the body and reactions of a tombstone', () => {
		render({ deleted: true, reactions: [{ emoji: '👍', count: 1 }] });
		expect(byText('Message deleted')).not.toBeNull();
		expect(document.body.textContent).not.toContain('hi');
		expect(dom.queryByRole('group', 'Reactions')).toBeNull();
	});

	it('toggles a reaction from its chip, and asks who reacted from a right-click', () => {
		const react = vi.fn();
		const reactors = vi.fn();
		render({ reactions: [{ emoji: '👍', count: 2, mine: true }], caps: { ...NONE, react: true } }, { react, reactors });
		const chip = dom.button('👍 2, including yours. Remove yours');
		chip.click();
		expect(react).toHaveBeenCalledWith(expect.objectContaining({ id: '1' }), '👍');
		chip.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
		expect(reactors).toHaveBeenCalledWith(expect.objectContaining({ id: '1' }), '👍', chip);
		// No + to add one without a picker to open (`pick`).
		expect(dom.queryByRole('button', 'Add a reaction')).toBeNull();
	});

	it('opens your picker beside the + after the chips, which says so while it is open', () => {
		const pick = vi.fn();
		render({ reactions: [{ emoji: '👍', count: 1, mine: false }], caps: { ...NONE, react: true } }, { pick, picking: () => true });
		const add = dom.button('Add a reaction');
		expect(add.getAttribute('aria-expanded')).toBe('true');
		add.click();
		expect(pick).toHaveBeenCalledWith(expect.objectContaining({ id: '1' }), add);
	});

	it('shows chips that do not toggle where you may not react', () => {
		const react = vi.fn();
		render({ reactions: [{ emoji: '👍', count: 1 }] }, { react });
		dom.button('👍 1. Add yours').click();
		expect(react).not.toHaveBeenCalled();
	});

	it('renders the editor in place of the body, for the row being edited, and no toolbar', () => {
		const row = render({ editing: true, caps: ALL }, {}, { editor: dom.html('<textarea aria-label="Edit message"></textarea>') });
		expect(dom.byRole('textbox', 'Edit message')).not.toBeNull();
		expect(document.body.textContent).not.toContain('hi');
		engage(row);
		expect(dom.queryByRole('toolbar', 'Message actions')).toBeNull();
	});

	it('leaves the keys and clicks of an editor\u2019s rich field to it: `x` is a letter, a shift-click and a room chip stay there', () => {
		const beginSelect = vi.fn();
		const openRoom = vi.fn();
		render({ editing: true, caps: ALL }, { beginSelect, openRoom }, { editor: dom.html('<div role="textbox" aria-label="Edit message" contenteditable="plaintext-only">hi <span contenteditable="false" data-room-id="ops">#ops</span></div>') });
		const field = dom.byRole('textbox', 'Edit message');
		expect(dom.press(field, 'x')).toBe(true);
		field.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, shiftKey: true }));
		field.querySelector('[data-room-id]')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
		expect(beginSelect).not.toHaveBeenCalled();
		expect(openRoom).not.toHaveBeenCalled();
	});

	it('decorates the code blocks of a body that has some, again when it changes', () => {
		const cleanup = vi.fn();
		const code = vi.fn(() => cleanup);
		const props = $state({ view: view({ body: { html: '<pre><code>a</code></pre>', markdown: true, code: true } }), on: { code } });
		dom.render(Message, props);
		expect(code).toHaveBeenCalledWith(document.querySelector('pre')!.parentElement, false);
		props.view = view({ body: { html: '<pre><code>b</code></pre>', markdown: true, code: true } });
		flushSync();
		expect(code).toHaveBeenCalledTimes(2);
		expect(cleanup).toHaveBeenCalledOnce();
	});

	it('says Writing… under a body still arriving, and nothing once it is whole', () => {
		const row = render({ body: { html: '<p>Here is the plan</p>', markdown: true }, writing: true });
		const writing = row.querySelector('.ap-msg-writing')!;
		expect([writing.getAttribute('role'), writing.textContent]).toEqual(['status', 'Writing…']);
		expect(row.querySelector('.ap-msg-text')?.nextElementSibling).toBe(writing);
		dom.unmount();
		expect(render({ body: { html: '<p>Here is the plan</p>', markdown: true } }).querySelector('.ap-msg-writing')).toBeNull();
	});

	it('leaves bodies without code blocks alone', () => {
		const code = vi.fn();
		render({ body: { html: 'plain' } }, { code });
		expect(code).not.toHaveBeenCalled();
	});
});

describe('a message row’s toolbar', () => {
	it('is built only once a pointer or focus reaches the row', () => {
		const row = render({ caps: { ...NONE, reply: true } });
		expect(dom.queryByRole('toolbar', 'Message actions')).toBeNull();
		row.querySelector('header')!.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
		flushSync();
		expect(dom.byRole('toolbar', 'Message actions')).not.toBeNull();
	});

	it('offers what the caps allow, the rarer actions behind ⋯, each calling its handler', () => {
		const on = { reply: vi.fn(), startThread: vi.fn(), edit: vi.fn(), delete: vi.fn(), beginSelect: vi.fn(), removeReply: vi.fn() };
		const row = render({ caps: ALL, reply: { id: '7', name: 'Bob' } }, on);
		engage(row);
		const toolbar = dom.byRole('toolbar', 'Message actions');
		expect([...toolbar.querySelectorAll('button')].map(dom.nameOf)).toEqual(['React', 'Reply to message', 'Start thread', 'Edit message', 'More actions']);
		dom.button('Reply to message').click();
		dom.button('Start thread').click();
		dom.button('Edit message').click();
		expect([on.reply, on.startThread, on.edit].map((handler) => handler.mock.calls.length)).toEqual([1, 1, 1]);
		dom.button('More actions').click();
		flushSync();
		expect([...toolbar.querySelectorAll('button')].map(dom.nameOf)).toEqual(['React', 'Reply to message', 'Start thread', 'Edit message', 'Remove reply reference', 'Select message', 'Copy link to message', 'Delete message']);
		// Using one puts the rest away again.
		dom.button('Delete message').click();
		flushSync();
		expect(on.delete).toHaveBeenCalledOnce();
		expect(dom.queryByRole('button', 'Select message')).toBeNull();
		dom.button('More actions').click();
		flushSync();
		dom.button('Select message').click();
		flushSync();
		dom.button('More actions').click();
		flushSync();
		dom.button('Remove reply reference').click();
		expect([on.beginSelect, on.removeReply].map((handler) => handler.mock.calls.length)).toEqual([1, 1]);
	});

	it('offers the quick reactions first, set apart, each toggling yours and pressed where it is already yours', () => {
		const react = vi.fn();
		const row = render({ caps: { ...NONE, react: true, reply: true }, reactions: [{ emoji: '❤', count: 1, mine: true }] }, { react, quick: () => ['👍', '❤️', '😂'] });
		engage(row);
		const toolbar = dom.byRole('toolbar', 'Message actions');
		expect([...toolbar.querySelectorAll('button')].map(dom.nameOf)).toEqual(['React with 👍', 'React with ❤️', 'React with 😂', 'React', 'Reply to message']);
		expect(dom.byRole('group', 'Quick reactions').querySelectorAll('[aria-pressed="true"]').length).toBe(1);
		expect(dom.button('React with ❤️').getAttribute('aria-pressed')).toBe('true');
		dom.button('React with 😂').click();
		expect(react).toHaveBeenCalledWith(expect.objectContaining({ id: '1' }), '😂');
	});

	it('reads the quick reactions as the pointer arrives, so a press doesn’t reorder them under it', () => {
		let recent = ['👍', '❤️', '😂'];
		const row = render({ caps: { ...NONE, react: true } }, { react: (_, emoji) => (recent = [emoji, ...recent.filter((it) => it !== emoji)]), quick: () => recent });
		engage(row);
		const names = () => [...dom.byRole('group', 'Quick reactions').querySelectorAll('button')].map(dom.nameOf);
		dom.button('React with 😂').click();
		flushSync();
		expect(names()).toEqual(['React with 👍', 'React with ❤️', 'React with 😂']);
		engage(row);
		expect(names()).toEqual(['React with 😂', 'React with 👍', 'React with ❤️']);
	});

	it('offers no quick reactions where you may not react, or on a tombstone', () => {
		let row = render({ caps: { ...NONE, reply: true } }, { quick: () => ['👍'] });
		engage(row);
		expect(dom.queryByRole('group', 'Quick reactions')).toBeNull();
		dom.unmount();
		row = render({ deleted: true, caps: { ...NONE, react: true, removeReply: true } }, { quick: () => ['👍'] });
		engage(row);
		expect(dom.queryByRole('group', 'Quick reactions')).toBeNull();
	});

	it('shows each action as its icon, named in its tooltip with its key, its words there for the keyboard', () => {
		const row = render({ caps: { ...NONE, reply: true, edit: true, startThread: true } });
		engage(row);
		const reply = dom.button('Reply to message');
		expect(reply.querySelector('svg')).not.toBeNull();
		expect([reply.title, reply.getAttribute('aria-keyshortcuts'), reply.dataset.key, reply.querySelector('.ap-actions-label')?.textContent]).toEqual(['Reply (R)', 'r', 'R', 'Reply']);
		expect(dom.button('Edit message').title).toBe('Edit (E)');
		// Its words say Thread, a verb as Reply and Edit are; what a screen reader hears (Start thread) still holds them.
		expect([dom.button('Start thread').title, dom.button('Start thread').querySelector('.ap-actions-label')?.textContent, dom.button('Start thread').dataset.key]).toEqual(['Thread', 'Thread', undefined]);
	});

	it('offers Remove reply under ⋯ only on a reply', () => {
		const row = render({ caps: ALL });
		engage(row);
		dom.button('More actions').click();
		flushSync();
		expect(dom.queryByRole('button', 'Remove reply reference')).toBeNull();
		expect(dom.button('Delete message')).not.toBeNull();
	});

	it('offers nothing but what applies to a tombstone, and nothing in select mode', () => {
		let row = render({ deleted: true, caps: { ...NONE, removeReply: true } });
		engage(row);
		expect([...dom.byRole('toolbar', 'Message actions').querySelectorAll('button')].map(dom.nameOf)).toEqual(['Remove reply reference']);
		dom.unmount();
		row = render({ selecting: true, caps: ALL });
		engage(row);
		expect(dom.queryByRole('toolbar', 'Message actions')).toBeNull();
		dom.unmount();
		row = render({ caps: NONE });
		engage(row);
		expect(dom.queryByRole('toolbar', 'Message actions')).toBeNull();
	});

	it('says Copied for a moment once the link is copied, then puts the rarer actions away', async () => {
		vi.useFakeTimers();
		const copyLink = vi.fn(async () => true);
		const row = render({ caps: { ...NONE, link: true } }, { copyLink });
		engage(row);
		dom.button('More actions').click();
		flushSync();
		dom.button('Copy link to message').click();
		await vi.waitFor(() => expect(dom.queryByRole('button', 'Link copied')).not.toBeNull());
		// In the menu ⋯ opened, its row's icon turns to a check (ActionIcons') and its words to Copied.
		expect(dom.byRole('toolbar', 'Message actions').getAttribute('aria-orientation')).toBe('vertical');
		expect(dom.button('Link copied').querySelector('path[d="M20 6 9 17l-5-5"]')).not.toBeNull();
		expect(dom.button('Link copied').textContent).toBe('Copied');
		vi.advanceTimersByTime(1200);
		flushSync();
		expect(dom.queryByRole('button', 'Link copied')).toBeNull();
		expect(dom.button('More actions')).not.toBeNull();
	});

	it('puts the rarer actions away when the link could not be copied', async () => {
		const copyLink = vi.fn(async () => false);
		const row = render({ caps: { ...NONE, link: true } }, { copyLink });
		engage(row);
		dom.button('More actions').click();
		flushSync();
		dom.button('Copy link to message').click();
		await tick();
		await tick();
		flushSync();
		expect(dom.queryByRole('button', 'Copy link to message')).toBeNull();
		expect(dom.button('More actions')).not.toBeNull();
	});

	it('puts the rarer actions away on a press anywhere else, not one inside the toolbar', () => {
		const row = render({ caps: ALL });
		engage(row);
		dom.button('More actions').click();
		flushSync();
		dom.button('Select message').dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
		flushSync();
		expect(dom.queryByRole('button', 'Select message')).not.toBeNull();
		document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
		flushSync();
		expect([dom.queryByRole('button', 'Select message'), dom.queryByRole('button', 'More actions')]).toEqual([null, expect.anything()]);
	});

	it('opens your picker beside React, says whether it is open, and lets the button go with the picker', () => {
		let open = $state(false);
		const release = vi.fn();
		const pickAnchor = vi.fn(() => release);
		const pick = vi.fn((_view: MessageView, _anchor: HTMLElement) => (open = true));
		const row = render({ caps: { ...NONE, react: true } }, { pick, picking: () => open, pickAnchor });
		engage(row);
		const react = dom.button('React');
		expect([react.getAttribute('aria-haspopup'), react.getAttribute('aria-expanded')]).toEqual(['dialog', 'false']);
		expect(pickAnchor).toHaveBeenCalledWith(react);
		react.click();
		flushSync();
		expect(pick).toHaveBeenCalledWith(expect.objectContaining({ id: '1' }), react);
		expect(react.getAttribute('aria-expanded')).toBe('true');
		dom.unmount();
		// The toolbar is the dock's, its own root: it empties as that root next settles.
		flushSync();
		expect(release).toHaveBeenCalledOnce();
	});
});

describe('keys on a focused message', () => {
	it('replies with `r` and edits with `e`, as their buttons do, where the message offers them', () => {
		const reply = vi.fn();
		const edit = vi.fn();
		const row = render({ caps: { ...NONE, reply: true } }, { reply, edit });
		expect(dom.press(row, 'r')).toBe(false);
		expect(reply).toHaveBeenCalledOnce();
		// Not someone else's to edit, and not with a modifier.
		expect(dom.press(row, 'e')).toBe(true);
		expect(dom.press(row, 'r', { metaKey: true })).toBe(true);
		expect(edit).not.toHaveBeenCalled();
		expect(reply).toHaveBeenCalledOnce();
		dom.unmount();

		const mine = render({ caps: ALL }, { reply, edit });
		expect(dom.press(mine, 'e')).toBe(false);
		expect(edit).toHaveBeenCalledOnce();
	});

	it('leaves `r` and `e` alone in select mode and while the message is edited', () => {
		const reply = vi.fn();
		const edit = vi.fn();
		const selecting = render({ selecting: true, caps: ALL }, { reply, edit });
		expect(dom.press(selecting, 'r')).toBe(true);
		expect(dom.press(selecting, 'e')).toBe(true);
		dom.unmount();
		const editing = render({ editing: true, caps: ALL }, { reply, edit });
		expect(dom.press(editing, 'r')).toBe(true);
		expect(reply).not.toHaveBeenCalled();
		expect(edit).not.toHaveBeenCalled();
	});
});

describe('select gestures', () => {
	it('starts select mode from a shift-click, or `x` on the focused row', () => {
		const beginSelect = vi.fn();
		const row = render({ caps: { ...NONE, select: true } }, { beginSelect });
		click(row.querySelector('.ap-msg-text')!);
		expect(beginSelect).not.toHaveBeenCalled();
		click(row.querySelector('.ap-msg-text')!, { shiftKey: true });
		expect(dom.press(row, 'x')).toBe(false);
		expect(beginSelect).toHaveBeenCalledTimes(2);
		// Not from a field, nor with a modifier.
		expect(dom.press(row, 'x', { ctrlKey: true })).toBe(true);
	});

	it('picks the row in select mode, a shift-click filling the range, its check by Space too, and lets controls be', () => {
		const select = vi.fn();
		const openProfile = vi.fn(() => true);
		const row = render({ selecting: true, caps: { ...NONE, select: true } }, { select, openProfile });
		expect(row.getAttribute('class')).toContain('ap-msg-selectable');
		click(row.querySelector('.ap-msg-text')!);
		click(row.querySelector('.ap-msg-text')!, { shiftKey: true });
		// The sender's name picks it too: no profile in select mode.
		click(dom.button('Ada'));
		expect(openProfile).not.toHaveBeenCalled();
		dom.press(dom.byRole('checkbox', 'Select message'), 'a');
		dom.press(dom.byRole('checkbox', 'Select message'), ' ');
		expect(select.mock.calls.map(([, range]) => range)).toEqual([false, true, false, false]);
		dom.press(row, 'x');
		expect(select).toHaveBeenCalledTimes(5);
	});

	it('checks a picked row, and leaves rows you may not pick as they are', () => {
		let row = render({ selecting: true, selected: true, caps: { ...NONE, select: true } });
		expect(dom.byRole('checkbox', 'Select message').getAttribute('aria-checked')).toBe('true');
		expect(row.getAttribute('class')).toContain('ap-msg-selected');
		dom.unmount();
		const select = vi.fn();
		row = render({ selecting: true, caps: NONE }, { select });
		expect(dom.queryByRole('checkbox', 'Select message')).toBeNull();
		click(row.querySelector('.ap-msg-text')!);
		expect(select).not.toHaveBeenCalled();
	});

	/** A finger held on `target` from (x, y) for the long press's length. */
	function hold(target: Element, x = 0, y = 0): void {
		dom.touch('pointerdown', target, x, y);
		vi.advanceTimersByTime(500);
		flushSync();
	}
	const held = (row: Element) => row.classList.contains('ap-msg-held');
	const buttons = () => [...dom.byRole('toolbar', 'Message actions').querySelectorAll('button')].map(dom.nameOf);

	it('moves touch’s menu to the row a new long press is on, though the other’s was open', () => {
		vi.useFakeTimers();
		render({ id: 'a', caps: { ...NONE, reply: true } });
		render({ id: 'b', caps: { ...NONE, reply: true, edit: true } });
		const [a, b] = [...document.querySelectorAll('article')];
		hold(a.querySelector('.ap-msg-text')!);
		expect(a.querySelector('[role="toolbar"]')).not.toBeNull();
		hold(b.querySelector('.ap-msg-text')!);
		expect([a.querySelector('[role="toolbar"]'), b.querySelector('[role="toolbar"]') !== null, held(b)]).toEqual([null, true, true]);
	});

	it('opens a larger menu from a long touch press, React and Reply up front and the rest behind ⋯ as rows, Select on anyone’s', () => {
		vi.useFakeTimers();
		const copyText = vi.fn(async () => true);
		// Not yours: Select is still there.
		const row = render({ caps: { ...ALL, edit: false, removeReply: false } }, { copyText });
		const text = row.querySelector('.ap-msg-text')!;
		hold(text);
		expect(held(row)).toBe(true);
		expect(dom.byRole('toolbar', 'Message actions').classList.contains('ap-actions-touch')).toBe(true);
		expect(buttons()).toEqual(['React', 'Reply to message', 'More actions']);
		// Icons up front, their words there only for the keyboard, which touch's bar doesn't box; as rows, each icon beside its words.
		expect(dom.button('Reply to message').classList.contains('ap-actions-icon')).toBe(true);
		expect(dom.button('Reply to message').dataset.key).toBeUndefined();
		// The click that ends the press does nothing else.
		click(text);
		flushSync();
		expect(held(row)).toBe(true);
		dom.button('More actions').click();
		flushSync();
		expect(dom.byRole('toolbar', 'Message actions').getAttribute('aria-orientation')).toBe('vertical');
		expect(buttons()).toEqual(['React', 'Reply to message', 'Start thread', 'Select message', 'Copy text', 'Copy link to message']);
		expect(dom.button('Reply to message').textContent).toBe('Reply');
		expect(dom.button('Reply to message').classList.contains('ap-actions-row')).toBe(true);
		expect(dom.button('Reply to message').querySelector('svg')).not.toBeNull();
		dom.button('Copy text').click();
		expect(copyText).toHaveBeenCalledOnce();
	});

	it('puts its menu away when Select or Edit is chosen from it, so it isn\u2019t back when they end, nor opens from a press held into them', () => {
		vi.useFakeTimers();
		const props: { view: MessageView; on: MessageHandlers } = $state({ view: view({ caps: ALL }), on: {} });
		props.on = { beginSelect: () => (props.view = { ...props.view, selecting: true }), edit: () => (props.view = { ...props.view, editing: true }) };
		dom.render(Message, props);
		const row = () => document.querySelector('article')!;
		for (const [choice, mode] of [['Select message', 'selecting'], ['Edit message', 'editing']] as const) {
			hold(row().querySelector('.ap-msg-text')!);
			expect(held(row())).toBe(true);
			dom.button('More actions').click();
			flushSync();
			dom.button(choice).click();
			flushSync();
			props.view = { ...props.view, [mode]: false };
			flushSync();
			expect(held(row())).toBe(false);
		}
		// A press under way when the row goes into select mode opens nothing.
		dom.touch('pointerdown', row().querySelector('.ap-msg-text')!);
		props.view = { ...props.view, selecting: true };
		flushSync();
		vi.advanceTimersByTime(500);
		flushSync();
		props.view = { ...props.view, selecting: false };
		flushSync();
		expect(held(row())).toBe(false);
	});

	it('opens the menu only from a press held still, never a tap, nor on a chip, a link or a row gone', () => {
		vi.useFakeTimers();
		const row = render({ caps: ALL, reactions: [{ emoji: '👍', count: 1 }] });
		const text = row.querySelector('.ap-msg-text')!;
		// A tap: no menu, and no hover toolbar left behind.
		dom.touch('pointerdown', text);
		click(text);
		flushSync();
		expect([held(row), row.classList.contains('ap-msg-dismissed')]).toEqual([false, true]);
		// A finger drifts a little while held; past the slop it's a scroll.
		dom.touch('pointerdown', text, 0, 0);
		dom.touch('pointermove', text, 6, 6);
		vi.advanceTimersByTime(500);
		flushSync();
		expect(held(row)).toBe(true);
		dom.unmount();
		const again = render({ caps: ALL, reactions: [{ emoji: '👍', count: 1 }], body: { html: 'see <a href="https://example.com">this</a>', markdown: false } });
		dom.touch('pointerdown', again.querySelector('.ap-msg-text')!, 0, 0);
		dom.touch('pointermove', again.querySelector('.ap-msg-text')!, 20, 0);
		hold(dom.button('👍 1. Add yours'));
		hold(again.querySelector('a')!);
		expect(held(again)).toBe(false);
		// One that ends after its row has gone does nothing.
		dom.touch('pointerdown', again.querySelector('.ap-msg-text')!);
		dom.unmount();
		vi.advanceTimersByTime(500);
	});

	it('opens at once on Android’s own long press, in its place', () => {
		const row = render({ caps: ALL });
		const text = row.querySelector('.ap-msg-text')!;
		dom.touch('pointerdown', text);
		const menu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
		text.dispatchEvent(menu);
		flushSync();
		expect([held(row), menu.defaultPrevented]).toEqual([true, true]);
		// A mouse's right-click stays the browser's.
		row.dispatchEvent(new Event('pointerenter'));
		const right = new MouseEvent('pointerdown', { bubbles: true });
		Object.defineProperty(right, 'pointerType', { value: 'mouse' });
		text.dispatchEvent(right);
		const native = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
		text.dispatchEvent(native);
		expect(native.defaultPrevented).toBe(false);
	});

	it('puts its menu away on a tap on the row, Escape or focus leaving, and a mouse brings back the hover toolbar', async () => {
		vi.useFakeTimers();
		const row = render({ caps: ALL });
		const text = row.querySelector('.ap-msg-text')!;
		hold(text);
		click(text);
		dom.touch('pointerdown', text);
		click(text);
		flushSync();
		expect([held(row), row.classList.contains('ap-msg-dismissed')]).toEqual([false, true]);
		hold(text);
		dom.press(row, 'Escape');
		await Promise.resolve();
		flushSync();
		expect(held(row)).toBe(false);
		hold(text);
		// ⋯ goes as the rest show: the focus it held moves on to them, and the menu stays.
		dom.button('More actions').focus();
		dom.button('More actions').click();
		await tick();
		flushSync();
		expect([held(row), dom.nameOf(document.activeElement!)]).toEqual([true, 'Start thread']);
		(document.activeElement as HTMLElement).blur();
		await Promise.resolve();
		flushSync();
		expect(held(row)).toBe(false);
		const mouse = new MouseEvent('pointerenter');
		Object.defineProperty(mouse, 'pointerType', { value: 'mouse' });
		row.dispatchEvent(mouse);
		flushSync();
		expect(row.classList.contains('ap-msg-dismissed')).toBe(false);
	});

	it('opens a mentioned room from its link, before anything else', () => {
		const openRoom = vi.fn();
		const select = vi.fn();
		render({ body: { html: '<button data-room-id="ops">Ops</button>' }, selecting: true, caps: { ...NONE, select: true } }, { openRoom, select });
		click(dom.button('Ops'));
		expect(openRoom).toHaveBeenCalledWith('ops');
		expect(select).not.toHaveBeenCalled();
	});
});

describe('system messages', () => {
	it('draws a quiet line with its sender and time, and no actions', () => {
		const row = render({ system: true, sender: { user_id: '~server', name: 'Server' }, body: { html: 'Dana joined' }, caps: ALL });
		expect(row.textContent).toContain('Server');
		expect(row.textContent).toContain('Dana joined');
		engage(row);
		expect(dom.queryByRole('toolbar', 'Message actions')).toBeNull();
	});

	it('draws a scoped one as a card titled by its sender, its code blocks with Copy buttons', () => {
		const code = vi.fn();
		const row = render({ system: true, scope: 'private', sender: { user_id: '~private', name: 'System message to you (~private)' }, body: { html: '<pre><code>t</code></pre>', code: true } }, { code });
		expect([row.dataset.scope, byText('System message to you (~private)') !== null]).toEqual(['private', true]);
		expect(code).toHaveBeenCalledWith(expect.any(HTMLElement), true);
	});
});

describe('embeds', () => {
	it('lists them through your renderer, with an (x) on the removable ones', () => {
		const removeEmbed = vi.fn();
		const a = { kind: 'upload', title: 'a.log' };
		const b = { kind: 'upload', title: 'b.log' };
		render({ embeds: [{ key: '0', embed: a, removable: true }, { key: '1', embed: b }] }, { removeEmbed }, { embed: dom.html('<span>file</span>') });
		expect(document.querySelectorAll('.ap-embed-slot')).toHaveLength(2);
		expect(byText('file')).not.toBeNull();
		const remove = [...document.querySelectorAll('button')].filter((button) => dom.nameOf(button) === 'Remove embed');
		expect(remove).toHaveLength(1);
		remove[0].click();
		expect(removeEmbed).toHaveBeenCalledWith(expect.objectContaining({ id: '1' }), a);
	});
});

describe('test ids', () => {
	it('puts each id it is given on the part it names', () => {
		const row = render({ sender: { ...ada, handle: 'ada' }, reply: {}, reactions: [{ emoji: '👍', count: 1 }], caps: ALL, writing: true }, {}, {
			testids: { row: 'row', handle: 'handle', reply: 'reply', reactions: 'reactions', chip: 'chip', select: 'select', writing: 'writing' }
		});
		engage(row);
		dom.button('More actions').click();
		flushSync();
		const ids = (id: string) => [...document.querySelectorAll(`[data-testid="${id}"]`)];
		expect(ids('row')).toEqual([row]);
		expect(ids('handle')).toEqual([byText('@ada')]);
		expect(ids('reply')).toEqual([byText('Message unavailable').closest('.ap-reply')]);
		expect(ids('reactions')).toEqual([dom.byRole('group', 'Reactions')]);
		expect(ids('chip')).toEqual([dom.button('👍 1. Add yours')]);
		expect(ids('select')).toEqual([dom.button('Select message')]);
		expect(ids('writing')).toEqual([row.querySelector('.ap-msg-writing')]);
	});
});

describe('task list checkboxes', () => {
	// As `renderMarkdown` writes it.
	const html = '<ul class="ap-task-list"><li class="ap-task-item"><input type="checkbox" class="ap-task" data-task-line="0" disabled="">Foo</li></ul>';
	const box = () => document.querySelector<HTMLInputElement>('input.ap-task')!;

	it('stay disabled where you may not tick them, even on one you may edit', () => {
		render({ body: { html, markdown: true, tasks: true }, caps: ALL }, { toggleTask: () => true });
		expect(box().disabled).toBe(true);
		dom.cleanup();
	});

	it('follow select mode without decorating the code blocks again', () => {
		const code = vi.fn();
		const body = { html: `<pre><code>a</code></pre>${html}`, markdown: true, code: true, tasks: true };
		const props = $state({ view: view({ body, caps: { ...NONE, check: true } }), on: { code, toggleTask: () => true } });
		dom.render(Message, props);
		expect(box().disabled).toBe(false);
		props.view = view({ body, caps: { ...NONE, check: true }, selecting: true });
		flushSync();
		expect(box().disabled).toBe(true);
		expect(code).toHaveBeenCalledOnce();
		dom.cleanup();
	});

	it('save a check where you may tick them, and go back when it fails', async () => {
		let result = true;
		const toggled: Array<[number, boolean]> = [];
		render({ body: { html, markdown: true, tasks: true }, caps: { ...NONE, check: true } }, { toggleTask: (_view, line, checked) => (toggled.push([line, checked]), Promise.resolve(result)) });
		expect(box().disabled).toBe(false);
		box().click();
		await tick();
		expect(toggled).toEqual([[0, true]]);
		expect(box().checked).toBe(true);
		expect(box().closest('.ap-task-item')!.classList.contains('ap-task-done')).toBe(true);
		result = false;
		box().click();
		await Promise.resolve();
		await tick();
		expect(toggled).toEqual([[0, true], [0, false]]);
		expect(box().checked).toBe(true);
		expect(box().closest('.ap-task-item')!.classList.contains('ap-task-done')).toBe(true);
		dom.cleanup();
	});
});

describe('the toolbar the rows share (the dock)', () => {
	/** Two rows, each with its own view and handlers. */
	function rows(first: Partial<MessageView>, second: Partial<MessageView>, on: MessageHandlers = {}) {
		render({ id: 'a', ...first }, on);
		render({ id: 'b', ...second }, on);
		const [a, b] = [...document.querySelectorAll('article')];
		return { a, b };
	}
	const toolbars = () => [...document.querySelectorAll('[role="toolbar"][aria-label="Message actions"]')];
	const names = (row: Element) => [...row.querySelectorAll('[role="toolbar"] button')].map(dom.nameOf);

	it('moves one toolbar into whichever row is reached, drawing that row’s actions', () => {
		const reply = vi.fn();
		const { a, b } = rows({ caps: { ...NONE, reply: true, edit: true } }, { caps: { ...NONE, reply: true } }, { reply });
		engage(a);
		const toolbar = toolbars()[0];
		expect([toolbars().length, a.contains(toolbar), names(a)]).toEqual([1, true, ['Reply to message', 'Edit message', 'More actions']]);
		engage(b);
		// The same toolbar, now in the other row, with that row's actions.
		expect([toolbars().length, toolbars()[0], b.contains(toolbar), a.contains(toolbar), names(b)]).toEqual([1, toolbar, true, false, ['Reply to message']]);
		dom.button('Reply to message').click();
		expect(reply).toHaveBeenCalledWith(expect.objectContaining({ id: 'b' }));
		// Back again: into the slot that row kept, its markup unchanged by the moves.
		const slot = a.querySelector('.ap-msg-dock');
		engage(a);
		expect([a.querySelector('.ap-msg-dock'), a.contains(toolbar), b.contains(toolbar), names(a)]).toEqual([slot, true, false, ['Reply to message', 'Edit message', 'More actions']]);
	});

	it('stays with the row whose menu is open, the row reached meanwhile showing none, and moves on once it shuts', () => {
		const { a, b } = rows({ caps: { ...NONE, link: true, reply: true } }, { caps: { ...NONE, link: true, reply: true } });
		engage(a);
		dom.button('More actions').click();
		flushSync();
		expect(names(a)).toContain('Copy link to message');
		engage(b);
		expect([toolbars().length, names(b)]).toEqual([1, []]);
		// Escape shuts it; the next row reached takes the toolbar, its own shut.
		toolbars()[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
		flushSync();
		engage(b);
		expect(names(b)).toEqual(['Reply to message', 'More actions']);
	});

	it('stays with the row whose picker is open, the row reached meanwhile showing none', () => {
		const { a, b } = rows({ caps: { ...NONE, react: true } }, { caps: { ...NONE, react: true } }, { pick: vi.fn(), picking: (view) => view.id === 'a' });
		engage(a);
		const toolbar = toolbars()[0];
		expect(toolbar.querySelector('[aria-expanded="true"]')).not.toBeNull();
		engage(b);
		expect([toolbars().length, a.contains(toolbar), b.querySelector('[role="toolbar"]')]).toEqual([1, true, null]);
	});
});
