// Content that strains the layout: long names and titles, unbroken text, many reactions, emoji-only and
// right-to-left / CJK messages, on desktop, a 320px phone and 200% zoom.
import { VIEWPORTS, createRoom, isNarrow, lastMessage, openDialog, openRoom, press, pressButton, react, rename, roomsPane, send, wait } from '../lib/helpers.js';

export const LONG_NAME = 'Bartholomew Maximilian Featherstonehaugh-Cholmondeley';
const LONG_ROOM = 'Quarterly infrastructure capacity planning and cost review';
const REACTIONS = ['thumbs', 'heart', 'tada', 'rocket', 'eyes', 'fire', 'smile', 'laugh', 'clap', 'hundred', 'pray', 'star'];

export default {
	description: 'Long names and titles, unbroken text, many reactions, RTL/CJK; desktop, 320px and 200% zoom.',
	viewports: { desktop: VIEWPORTS.desktop, narrow320: VIEWPORTS.narrow320, zoom200: VIEWPORTS.zoom200 },
	themes: ['light'],
	timeout: 8000,
	settle: 600,
	scenes: [
		{ name: 'plain' },
		{
			name: 'long-name',
			steps: async (p) => {
				await rename(p, LONG_NAME);
				if (isNarrow(p)) await openRoom(p, 'general', 300);
				await send(p, 'Hello with a very long display name.');
			}
		},
		{
			name: 'long-room',
			steps: (p) =>
				createRoom(p, LONG_ROOM, 'A description that runs on for a while to see how the description row and the header topic handle a lot of text without any breaks in the layout.'),
			// On one-pane viewports, also shoot the rooms pane, where the long title sits in the sidebar.
			extra: async (p, t) => {
				if (!t.narrow) return;
				await roomsPane(p);
				await t.shot('rooms');
			}
		},
		{
			name: 'long-thread',
			steps: async (p) => {
				await roomsPane(p);
				await pressButton(p, 'New thread in general');
				await wait(p, 300);
				const d = openDialog(p);
				await d.locator('input').first().fill('Investigate why the nightly export job intermittently times out on large tenants');
				await press(d.getByRole('button', { name: /start thread/i }));
				await wait(p, 600);
			}
		},
		{
			name: 'unbroken',
			steps: async (p) => {
				await send(p, `https://example.com/a/very/long/path/that/keeps/going/and/going/without/any/spaces/to/break/on/${'x'.repeat(60)}?query=${'y'.repeat(40)}`);
				await send(p, 'Supercalifragilisticexpialidocious'.repeat(5));
				await send(p, '`const someVeryLongIdentifierName = anotherVeryLongFunctionName(argumentNumberOne, argumentNumberTwo);`');
			}
		},
		{
			name: 'many-reactions',
			steps: async (p) => {
				await send(p, 'React to this a lot');
				const m = lastMessage(p);
				for (const q of REACTIONS) await react(p, m, q, { open: 700, settle: 300 });
				await p.mouse.move(5, 5);
				await wait(p, 300);
			}
		},
		{
			name: 'emoji-only',
			steps: async (p) => {
				await send(p, '🎉');
				await send(p, '🎉🚀🔥');
				await send(p, 'ok 👍');
			}
		},
		{
			name: 'rtl-cjk',
			steps: async (p) => {
				await send(p, 'مرحبا بكم في أبرون، هذه رسالة باللغة العربية لاختبار الاتجاه من اليمين إلى اليسار.');
				await send(p, '这是一条很长的中文消息，用来测试没有空格的文字是否能够正确地换行显示在消息列表中而不会溢出。');
			}
		},
		{ name: 'long-name-members', steps: (p) => rename(p, LONG_NAME) }
	]
};
