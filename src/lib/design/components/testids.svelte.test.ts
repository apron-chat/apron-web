// @vitest-environment jsdom
import { flushSync, tick, type Component } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AttachmentTile from './AttachmentTile.svelte';
import Composer from './Composer.svelte';
import Attachments from './Attachments.svelte';
import ConnectHeader from './ConnectHeader.svelte';
import EmbedTerminal from './EmbedTerminal.svelte';
import EmojiPopover from './EmojiPopover.svelte';
import FloatingDay from './FloatingDay.svelte';
import JumpBar from './JumpBar.svelte';
import MemberList from './MemberList.svelte';
import MentionPicker from './MentionPicker.svelte';
import MenuButton from './MenuButton.svelte';
import MessageEditor from './MessageEditor.svelte';
import Nudge from './Nudge.svelte';
import Popover from './Popover.svelte';
import ProfileCard from './ProfileCard.svelte';
import ProfileEditor from './ProfileEditor.svelte';
import ReactionBar from './ReactionBar.svelte';
import ReactorsPopover from './ReactorsPopover.svelte';
import RoomHeader from './RoomHeader.svelte';
import RoomItem from './RoomItem.svelte';
import SelectionBar from './SelectionBar.svelte';
import SettingRow from './SettingRow.svelte';
import SidebarSection from './SidebarSection.svelte';
import FoldHeading from './FoldHeading.svelte';
import FoldPill from './FoldPill.svelte';
import SignInForm from './SignInForm.svelte';
import StatusBanner from './StatusBanner.svelte';
import SystemLine from './SystemLine.svelte';
import ThreadItem from './ThreadItem.svelte';
import ThreadList from './ThreadList.svelte';
import ThreadMarker from './ThreadMarker.svelte';
import TimelineDivider from './TimelineDivider.svelte';
import UnreadCount from './UnreadCount.svelte';
import * as dom from '$lib/test/dom';
import { byLabel, byText } from '$lib/test/queries';

beforeEach(() => {
	// Popovers bind their height.
	dom.stubResizeObserver();
});

afterEach(() => {
	vi.unstubAllGlobals();
});

/** The element named `name` by `aria-label` alone, as a count bubble or a region without a role is. */
const labelled = (name: string) => document.querySelector<HTMLElement>(`[aria-label="${name}"]`)!;
/** The part a line of text sits in: its parent. */
const around = (text: string) => byText(text).parentElement!;

/** Opens a MenuButton by its trigger, so its items show. */
async function open(name: string): Promise<void> {
	dom.button(name).click();
	flushSync();
	await tick();
}

type Row = [component: string, Component<any>, props: Record<string, unknown>, parts: Record<string, () => Element | Element[]>, act?: () => Promise<void>];

/**
 * A component's named test-id props (`sendTestid`, …) put `data-testid` on the part they name, and nowhere else: the
 * app passes the ids the interop suite queries (tests/interop's README). Each row gives every test-id prop of one
 * component a distinct id and finds each part as a person would, by role and name, label or text.
 */
const rows: Row[] = [
	['Composer', Composer, {
		room: 'Ops', value: '/me', canCommand: true, canUpload: true, onfiles: vi.fn(), onemoji: vi.fn(),
		reply: { name: 'Ada', text: 'hi' }, attachments: dom.html('<div>tile</div>'), previews: [{ kind: 'link', url: 'https://a.test/1' }],
		replyTestid: 'reply', attachmentsTestid: 'files', previewsTestid: 'previews', fileInputTestid: 'file-input', commandTestid: 'command', emojiTestid: 'emoji', sendTestid: 'send'
	}, {
		reply: () => dom.byRole('status', /^Replying to Ada/), files: () => labelled('Files to send'), previews: () => labelled('Link previews to send'),
		'file-input': () => document.querySelector('input[type="file"]')!, command: () => byText('Command'), emoji: () => dom.button('Insert emoji'), send: () => dom.button('Run command')
	}],
	['MemberList', MemberList, {
		room: 'General', count: 5, sections: [{ key: 'online', label: 'Online', people: [{ user_id: 'ada', status: 'online' }, { user_id: 'bo', status: 'online' }] }],
		countTestid: 'count', bodyTestid: 'body', truncatedTestid: 'truncated'
	}, {
		count: () => byText('5'), truncated: () => byText('Showing 2 of 5: the most recently active'), body: () => labelled('Online in General').closest('section')!.parentElement!
	}],
	['MenuButton', MenuButton, {
		label: 'Room actions', icon: dom.html('<svg aria-hidden="true"></svg>'), buttonTestid: 'actions', choices: [{ value: 'edit', label: 'Edit room', testid: 'edit' }, { value: 'leave', label: 'Leave room' }], onselect: vi.fn()
	}, {
		actions: () => dom.button('Room actions'), edit: () => dom.byRole('menuitem', 'Edit room')
	}, () => open('Room actions')],
	['RoomHeader', RoomHeader, {
		room: 'ops', name: 'Ops', topic: 'Deploys', onback: vi.fn(), unreadElsewhere: 12, canJoin: true, onjoin: vi.fn(), ondescription: vi.fn(), onedit: vi.fn(), onleave: vi.fn(),
		tagTestid: 'tag', topicTestid: 'topic', joinTestid: 'join', descriptionTestid: 'description', actionsTestid: 'actions', editTestid: 'edit', leaveTestid: 'leave'
	}, {
		tag: () => byText('12'), topic: () => byText('Deploys'), join: () => dom.button('Join room'), description: () => dom.button('Show the room description'),
		actions: () => dom.button('Room actions'), edit: () => dom.byRole('menuitem', 'Edit room'), leave: () => dom.byRole('menuitem', 'Leave room')
	}, () => open('Room actions')],
	['RoomItem', RoomItem, { room: 'general', name: 'General', unread: 2, active: true, onnewthread: vi.fn(), onexpand: vi.fn(), unreadTestid: 'unread', newThreadTestid: 'new-thread', expandTestid: 'expand' }, {
		unread: () => labelled('2 unread messages'), 'new-thread': () => dom.button('New thread in General'), expand: () => dom.button('Show all threads in General')
	}],
	['ThreadItem', ThreadItem, {
		thread: 'deploy', name: 'Deploy', unread: 2, ago: { text: '2h', datetime: '2026-10-22T10:00:00.000Z' }, description: 'What to check', latest: { sender: 'Dana', text: 'Done' },
		agoTestid: 'ago', unreadTestid: 'unread', linesTestid: 'lines'
	}, {
		ago: () => byText('2h'), unread: () => labelled('2 unread replies'), 'lines-description': () => around('What to check'), 'lines-latest': () => around('Dana Done')
	}],
	['ThreadMarker', ThreadMarker, {
		thread: 't1', name: 'Deploy', unread: 2, lastReply: '9h', lastReplyAt: Date.UTC(2026, 8, 14, 9, 30), description: 'Lock held', latest: { sender: 'Ada', text: 'done' },
		unreadTestid: 'unread', lastReplyTestid: 'last-reply', descriptionTestid: 'description', latestTestid: 'latest', testid: 'card'
	}, {
		card: () => dom.button(/^Deploy/), unread: () => labelled('2 unread replies'), 'last-reply': () => byText('9h'), description: () => around('Lock held'), latest: () => around('Ada done')
	}],
	['ThreadList', ThreadList, { room: 'General', others: 4, otherRows: dom.html('<div>Offsite</div>'), more: 3, onmore: vi.fn(), othersToggleTestid: 'others', moreTestid: 'more', testid: 'list' }, {
		list: () => dom.byRole('group', 'Threads in General'), others: () => dom.button(/Other Threads/), more: () => dom.button('3 more…')
	}],
	['ThreadList, folded', ThreadList, { room: 'General', others: 4, othersFolded: true, othersExpandTestid: 'others-expand' }, {
		'others-expand': () => dom.button('Show all Other Threads')
	}],
	['SelectionBar', SelectionBar, { count: 2, onnewthread: vi.fn(), newThreadTestid: 'new-thread', testid: 'bar' }, {
		bar: () => dom.byRole('toolbar', 'Selected messages'), 'new-thread': () => dom.button('New thread')
	}],
	['ReactionBar', ReactionBar, { reactions: [{ emoji: '👍', count: 2, mine: true }, { emoji: '🎉', count: 1 }], ontoggle: vi.fn(), chipTestid: 'chip' }, {
		chip: () => [dom.button('👍 2, including yours. Remove yours'), dom.button('🎉 1. Add yours')]
	}],
	['ReactorsPopover', ReactorsPopover, { emoji: '👍', reactors: [{ user_id: 'ada' }, { user_id: 'bo' }], rowTestid: 'reactor', testid: 'reactors' }, {
		reactors: () => dom.byRole('dialog', '2 reactions with 👍'), reactor: () => [...dom.byRole('dialog', '2 reactions with 👍').querySelectorAll('li')]
	}],
	['ProfileCard', ProfileCard, { userId: 'ada', status: 'dnd', roles: ['admin'], bio: 'Counts things.', statusTestid: 'status', rolesTestid: 'roles', bioTestid: 'bio', testid: 'card' }, {
		card: () => dom.byRole('dialog', 'Profile of ada'), status: () => byText('Do not disturb'), roles: () => around('admin'), bio: () => byText('Counts things.')
	}],
	['ProfileEditor', ProfileEditor, {
		userId: 'ada', name: 'Ada', avatar: 'data:image/png;base64,iVBORw0KGgo=', canUpload: true, onavatarfile: vi.fn(), onremoveavatar: vi.fn(), dialog: false,
		maxBio: 250, changeAvatarTestid: 'change', removeAvatarTestid: 'remove', avatarFileTestid: 'file', nameTestid: 'name', bioTestid: 'bio'
	}, {
		change: () => dom.button('Change avatar'), remove: () => dom.button('Remove'), file: () => document.querySelector('input[type="file"]')!, name: () => byLabel('Handle'),
		bio: () => document.querySelector('textarea[aria-label="Bio"]')!
	}],
	['SignInForm, email', SignInForm, {
		schemes: ['email'], scheme: 'email', submit: 'Connect', askName: true, email: 'ada@example.com', sent: { scheme: 'email', email: 'ada@example.com' },
		emailTestid: 'email', codeTestid: 'code', nameTestid: 'name', submitTestid: 'submit', tokenTestid: 'token'
	}, {
		email: () => byLabel('Email'), code: () => byLabel('Code'), name: () => byLabel('Display name'), submit: () => dom.button('Connect')
	}],
	['SignInForm, token', SignInForm, { schemes: ['token'], scheme: 'token', submit: 'Connect', tokenTestid: 'token', emailTestid: 'email' }, { token: () => byLabel('Token') }],
	['SignInForm, external', SignInForm, { schemes: ['external'], scheme: 'external', submit: 'Connect', sent: { scheme: 'external', page: 'https://sso.example/' }, pageLinkTestid: 'page', codeTestid: 'code' }, {
		page: () => dom.byRole('link', 'Open the sign-in page'), code: () => byLabel('Code')
	}],
	['SignInForm, passkey', SignInForm, { schemes: ['webauthn'], scheme: 'webauthn', submit: 'Continue', passkeyChoice: true, passkeyChoiceTestid: 'passkey' }, {
		passkey: () => dom.byRole('radiogroup', 'Passkey'), 'passkey-login': () => dom.byRole('radio', /^Sign in/), 'passkey-register': () => dom.byRole('radio', /^Create account/)
	}],
	['ConnectHeader', ConnectHeader, { urlTestid: 'url' }, { url: () => byLabel('Server') }],
	['SettingRow', SettingRow, { title: 'Status', hint: 'Online.', hintTestid: 'hint' }, { hint: () => byText('Online.') }],
	['SidebarSection', SidebarSection, { title: 'Rooms', children: dom.html('<p>General</p>'), folded: true, toggleTestid: 'toggle', expandTestid: 'expand', bodyTestid: 'body' }, {
		toggle: () => dom.button(/Rooms$/), expand: () => dom.button('Show all Rooms'), body: () => around('General')
	}],
	['FoldHeading', FoldHeading, { label: 'Offline', count: 3, folded: true, toggleTestid: 'toggle', expandTestid: 'expand' }, {
		toggle: () => dom.button(/^Offline/), expand: () => dom.button('Show all Offline')
	}],
	['FoldPill', FoldPill, { label: 'Show all threads in general', testid: 'pill' }, { pill: () => dom.button('Show all threads in general') }],
	['StatusBanner', StatusBanner, { state: 'offline', textTestid: 'text' }, { text: () => byText('Offline') }],
	['JumpBar', JumpBar, { count: 3, onjump: vi.fn(), buttonTestid: 'jump' }, { jump: () => dom.button('3 new messages, jump to latest') }],
	['AttachmentTile, renamable', AttachmentTile, { name: 'a.png', onrename: vi.fn(), labelTestid: 'label' }, { label: () => dom.button('Rename a.png') }],
	['AttachmentTile', AttachmentTile, { name: 'a.png', labelTestid: 'label' }, { label: () => around('a.png') }],
	// A root's own test id, where the app gives one.
	['Popover', Popover, { label: 'Hello', children: dom.html('<p>Hello</p>'), testid: 'pop' }, { pop: () => dom.byRole('dialog', 'Hello') }],
	['EmojiPopover', EmojiPopover, { testid: 'picker' }, { picker: () => dom.byRole('dialog', 'Emoji picker') }],
	['EmbedTerminal', EmbedTerminal, { kind: 'terminal', text: 'ok', testid: 'terminal' }, { terminal: () => document.querySelector('.ap-embed-terminal')! }],
	['SystemLine', SystemLine, { text: 'Ada joined', testid: 'line' }, { line: () => around('Ada joined') }],
	['TimelineDivider', TimelineDivider, { kind: 'new', testid: 'divider' }, { divider: () => dom.byRole('separator', 'New') }],
	['FloatingDay', FloatingDay, { label: 'Today', testid: 'day' }, { day: () => around('Today') }],
	['UnreadCount', UnreadCount, { unread: 2, mentions: 0, testid: 'count' }, { count: () => labelled('2 unread messages') }],
	['Attachments', Attachments, { files: [{ name: 'a.png' }], testid: 'files' }, { files: () => labelled('Files to send') }],
	['MentionPicker', MentionPicker, { people: [{ user_id: 'ada' }], testid: 'picker' }, { picker: () => dom.byRole('listbox', 'Mention someone') }],
	['MessageEditor', MessageEditor, { value: 'hi', testid: 'editor' }, { editor: () => byLabel('Edit message').parentElement! }],
	['Nudge', Nudge, { title: 'Get notified?', testid: 'nudge' }, { nudge: () => dom.byRole('dialog', 'Get notified?') }]
];

describe('test-id props', () => {
	it('put each id on the part it names (`testid` on the root), and nowhere else, in every component that takes them', async () => {
		for (const [name, component, props, parts, act] of rows) {
			dom.render(component, props);
			await act?.();
			for (const [id, part] of Object.entries(parts)) expect([...document.querySelectorAll(`[data-testid="${id}"]`)], `${name}: ${id}`).toEqual([part()].flat());
			const ids = new Set([...document.querySelectorAll('[data-testid]')].map((element) => element.getAttribute('data-testid')));
			expect([...ids].sort(), name).toEqual(Object.keys(parts).sort());
			dom.unmount();
			document.body.innerHTML = '';
		}
		// It renders 35 rows in turn: give a loaded machine room past the 5 s default.
	}, 30_000);
});
