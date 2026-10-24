// Robustness edge cases: a person with a long name and many roles (seeded by rewriting the served bundle),
// right-to-left names, mixed-direction text, mention chips, and a thread whose title was cleared.
import {
	VIEWPORTS,
	isNarrow,
	memberList,
	openDialog,
	openRoom,
	parkPointer,
	press,
	pressButton,
	rename,
	rewriteBundle,
	scrollTimeline,
	send,
	showMembers,
	wait
} from '../lib/helpers.js';

// The memory server's seed, rewritten in the served bundle the same way for both builds: Margaret gets a
// long name and four roles. The runner fails the scene if this stops matching the bundle.
const LONG_ROLES = [
	/name:`Margaret Hamilton`,roles:\[`moderator`\]/g,
	'name:`Margaret Heafield Hamilton-Featherstonehaugh`,roles:[`moderator`,`bot`,`release-manager`,`on-call`]'
];
const seeded = (context) => rewriteBundle(context, [LONG_ROLES]);

async function renameAndReturn(p, name) {
	await rename(p, name);
	if (isNarrow(p)) await openRoom(p, 'general', 300);
}

async function clearThreadTitle(p) {
	await openRoom(p, 'Deploy checklist');
	await pressButton(p, 'Thread actions');
	await wait(p, 300);
	await press(p.getByRole('menuitem', { name: /Edit thread/ }).first());
	await wait(p, 300);
	const d = openDialog(p);
	await d.locator('input').first().fill('');
	await press(d.getByRole('button', { name: /^Save/ }));
	await wait(p, 600);
}

export default {
	description: 'Long names with many roles (seeded), RTL names, bidi text, mention chips, untitled threads.',
	viewports: { desktop: VIEWPORTS.desktop, narrow320: VIEWPORTS.narrow320, zoom200: VIEWPORTS.zoom200 },
	themes: ['light'],
	timeout: 8000,
	settle: 600,
	beforeShot: (p) => parkPointer(p),
	scenes: [
		{ name: 'roles-long', context: seeded, steps: (p) => showMembers(p) },
		{ name: 'roles-long-timeline', context: seeded, steps: (p) => scrollTimeline(p, 'top') },
		{
			name: 'roles-long-card',
			context: seeded,
			steps: async (p) => {
				await showMembers(p);
				await press(memberList(p).getByRole('button', { name: /Margaret/ }).first());
				await wait(p, 400);
			}
		},
		{
			name: 'rtl-name',
			steps: async (p) => {
				await renameAndReturn(p, 'محمد بن موسى الخوارزمي');
				await send(p, 'مرحبا! هذه رسالة.\nAnd an English line after it.');
				await showMembers(p);
			}
		},
		{
			name: 'bidi-mixed',
			steps: async (p) => {
				await send(p, 'Deploy notes:\nالنشر تم بنجاح (v2.1).\nRolled back at 14:00.');
				await send(p, 'שלום, @margaret ראית את זה?');
			}
		},
		{ name: 'long-mention', context: seeded, steps: (p) => send(p, 'Ping @margaret about the release, and see #general for context.') },
		{ name: 'untitled-thread', steps: clearThreadTitle },
		{
			name: 'untitled-thread-card',
			steps: async (p) => {
				await clearThreadTitle(p);
				await pressButton(p, 'Back to room');
				await wait(p, 500);
			}
		}
	]
};
