// The app's main states, on desktop, tablet and phone, light and dark: the shell, timeline, threads, dialogs,
// popovers, composer and message actions. Also holds the perf probes `qa perf` and `qa ab --perf` run.
import {
	VIEWPORTS,
	button,
	composer,
	hoverMessage,
	lastMessage,
	memberList,
	openRoom,
	press,
	pressButton,
	react,
	roomList,
	roomsPane,
	scrollTimeline,
	send,
	timeline,
	typeInComposer,
	wait
} from '../lib/helpers.js';

const own = async (p) => {
	await send(p, 'A message of my own, to select and edit.');
	return lastMessage(p);
};

/** Scrolls the open dialog's scrolling part to its end. */
const scrollDialogToEnd = (p) =>
	p
		.locator('dialog[open], [role=dialog]')
		.first()
		.evaluate((d) => {
			const s = [d, ...d.querySelectorAll('*')].find((e) => e.scrollHeight > e.clientHeight + 4 && getComputedStyle(e).overflowY !== 'visible');
			if (s) s.scrollTop = s.scrollHeight;
		});

export default {
	description: 'Main UI states across desktop, tablet and phone, light and dark.',
	viewports: { desktop: VIEWPORTS.desktop, tablet: VIEWPORTS.tablet, phone: VIEWPORTS.phone },
	themes: ['light', 'dark'],
	scenes: [
		{ name: 'room' },
		{ name: 'room-top', steps: (p) => scrollTimeline(p, 'top') },
		{ name: 'room-mid', viewports: ['desktop'], steps: (p) => scrollTimeline(p, 'middle') },
		{ name: 'thread', steps: (p) => openRoom(p, 'Deploy checklist') },
		{
			name: 'members-hidden',
			viewports: ['desktop'],
			steps: async (p) => {
				await pressButton(p, 'Hide member list');
				await wait(p, 400);
			}
		},
		{
			name: 'members-overlay',
			viewports: ['tablet', 'phone'],
			steps: async (p) => {
				await press(p.getByRole('button', { name: /member list/i }).first());
				await wait(p, 400);
			}
		},
		{
			name: 'sidebar-collapsed',
			viewports: ['desktop', 'tablet'],
			steps: async (p) => {
				await pressButton(p, 'Collapse sidebar');
				await wait(p, 400);
			}
		},
		{
			name: 'rooms-pane',
			viewports: ['phone'],
			steps: async (p) => {
				await pressButton(p, 'Back to rooms');
				await wait(p, 400);
			}
		},
		{
			name: 'preferences',
			steps: async (p) => {
				await roomsPane(p);
				await pressButton(p, 'Open preferences');
				await wait(p, 400);
			}
		},
		{
			name: 'preferences-scrolled',
			viewports: ['desktop'],
			steps: async (p) => {
				await pressButton(p, 'Open preferences');
				await wait(p, 300);
				await scrollDialogToEnd(p);
				await wait(p, 200);
			}
		},
		{
			name: 'new-room',
			viewports: ['desktop', 'phone'],
			steps: async (p) => {
				await roomsPane(p);
				await pressButton(p, 'Create room');
				await wait(p, 400);
			}
		},
		{
			name: 'new-thread',
			viewports: ['desktop'],
			steps: async (p) => {
				await pressButton(p, 'New thread in general');
				await wait(p, 400);
			}
		},
		{
			name: 'room-actions',
			viewports: ['desktop', 'phone'],
			steps: async (p) => {
				await pressButton(p, 'Room actions');
				await wait(p, 300);
			}
		},
		{
			name: 'profile-edit',
			viewports: ['desktop'],
			steps: async (p) => {
				await press(p.getByRole('button', { name: /^Your profile/ }));
				await wait(p, 400);
			}
		},
		{
			name: 'connection',
			viewports: ['desktop'],
			steps: async (p) => {
				await pressButton(p, 'Connection settings');
				await wait(p, 500);
			}
		},
		{
			name: 'composer-text',
			steps: async (p) => {
				await typeInComposer(p, 'Drafting a longer message that should wrap onto a second line in the composer, to see how it grows.');
				await wait(p, 200);
			}
		},
		{
			name: 'composer-mention',
			viewports: ['desktop', 'phone'],
			steps: async (p) => {
				await typeInComposer(p, 'hi @a');
				await wait(p, 400);
			}
		},
		{
			name: 'composer-room',
			viewports: ['desktop'],
			steps: async (p) => {
				await typeInComposer(p, 'see #e');
				await wait(p, 400);
			}
		},
		{
			name: 'composer-emoji-ac',
			viewports: ['desktop'],
			steps: async (p) => {
				await typeInComposer(p, 'nice :sm');
				await wait(p, 1500);
			}
		},
		{
			name: 'emoji-picker',
			viewports: ['desktop', 'phone'],
			steps: async (p) => {
				await press(p.getByTestId('emoji-button'));
				await wait(p, 2000);
			}
		},
		{
			name: 'message-hover',
			viewports: ['desktop'],
			steps: async (p) => {
				await hoverMessage(p, 3);
				await wait(p, 200);
			}
		},
		{
			name: 'message-more',
			viewports: ['desktop'],
			steps: async (p) => {
				const m = await own(p);
				await m.hover();
				await press(m.getByRole('button', { name: 'More actions' }));
				await wait(p, 300);
			}
		},
		{
			name: 'react-picker',
			viewports: ['desktop'],
			steps: async (p) => {
				const m = await hoverMessage(p, 3);
				await press(m.getByRole('button', { name: 'React' }));
				await wait(p, 2000);
			}
		},
		{
			name: 'reactions',
			viewports: ['desktop', 'phone'],
			steps: async (p) => {
				await send(p, 'Reactions below');
				await react(p, lastMessage(p), 'thumbs');
				await p.mouse.move(5, 5);
				await wait(p, 300);
			}
		},
		{
			name: 'reply',
			viewports: ['desktop', 'phone'],
			steps: async (p) => {
				const m = await hoverMessage(p, 3);
				await press(m.getByRole('button', { name: 'Reply to message' }), { force: true });
				await wait(p, 300);
			}
		},
		{
			name: 'replied',
			viewports: ['desktop'],
			steps: async (p) => {
				const m = await hoverMessage(p, 3);
				await press(m.getByRole('button', { name: 'Reply to message' }));
				await p.keyboard.type('Replying to that.');
				await p.keyboard.press('Enter');
				await wait(p, 400);
				await p.mouse.move(5, 5);
			}
		},
		{
			name: 'select',
			viewports: ['desktop'],
			steps: async (p) => {
				await own(p);
				await send(p, 'And another one.');
				const m = lastMessage(p);
				await m.hover();
				await press(m.getByRole('button', { name: 'More actions' }));
				await press(p.getByTestId('select-message'));
				await wait(p, 300);
			}
		},
		{
			name: 'edit',
			viewports: ['desktop'],
			steps: async (p) => {
				const m = await own(p);
				await m.hover();
				const edit = m.getByRole('button', { name: /edit/i });
				if (await edit.count()) await press(edit.first());
				else {
					await press(m.getByRole('button', { name: 'More actions' }));
					await press(p.getByRole('button', { name: /edit/i }).first());
				}
				await wait(p, 300);
			}
		},
		{
			name: 'profile-card',
			viewports: ['desktop', 'phone'],
			steps: async (p) => {
				await press(timeline(p).getByTitle('Show profile').first());
				await wait(p, 400);
			}
		},
		{
			name: 'member-profile',
			viewports: ['desktop'],
			steps: async (p) => {
				await press(memberList(p).getByRole('button', { name: /Ada/ }).first());
				await wait(p, 400);
			}
		},
		{
			name: 'add-member',
			viewports: ['desktop'],
			steps: async (p) => {
				await pressButton(p, 'Add member');
				await wait(p, 300);
			}
		},
		{
			name: 'media-viewer',
			viewports: ['desktop', 'phone'],
			steps: async (p) => {
				const img = timeline(p).locator('img').last();
				await img.scrollIntoViewIfNeeded();
				await press(img);
				await wait(p, 600);
			}
		},
		{ name: 'engineering', viewports: ['desktop'], steps: (p) => openRoom(p, 'engineering') },
		{
			name: 'other-thread',
			viewports: ['desktop'],
			steps: async (p) => {
				await press(p.getByTitle('Read Offsite planning without joining').first());
				await wait(p, 500);
			}
		},
		{
			name: 'typed-reload',
			viewports: ['desktop'],
			steps: async (p) => {
				await typeInComposer(p, '/');
				await wait(p, 300);
			}
		}
	],

	// Perf probes (desktop unless a viewport is given): each runs on a freshly loaded page; `qa perf`
	// measures frames and layout/style/script time from `action` until `settle` ms after it.
	interactions: [
		{ name: 'sidebar-collapse', action: (p) => button(p, 'Collapse sidebar').click() },
		{ name: 'member-list-hide', action: (p) => button(p, 'Hide member list').click() },
		{ name: 'member-list-overlay-open', viewport: VIEWPORTS.tablet, action: (p) => p.getByRole('button', { name: /member list/i }).first().click() },
		{ name: 'open-thread', settle: 1000, action: (p) => roomList(p).getByText('Deploy checklist', { exact: true }).first().click() },
		{ name: 'open-preferences', settle: 800, action: (p) => button(p, 'Open preferences').click() },
		{
			name: 'scroll-timeline',
			settle: 500,
			setup: (p) => timeline(p).hover(),
			action: async (p) => {
				for (let i = 0; i < 20; i++) {
					await p.mouse.wheel(0, -120);
					await p.waitForTimeout(16);
				}
			}
		},
		{ name: 'type-composer', settle: 400, setup: (p) => composer(p).click(), action: (p) => p.keyboard.type('The quick brown fox jumps over @a', { delay: 20 }) },
		{
			name: 'hover-messages',
			settle: 300,
			action: async (p) => {
				await timeline(p).evaluate((el) => (el.scrollTop = 0));
				await p.waitForTimeout(200);
				for (let y = 80; y < 720; y += 16) {
					await p.mouse.move(640, y);
					await p.waitForTimeout(16);
				}
			}
		}
	]
};
