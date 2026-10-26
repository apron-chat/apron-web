import type { Page } from '@playwright/test';
import { NOW } from '../scripts/qa/lib/helpers.js';

/** Any URL off this machine. */
export const OFFSITE = /^https?:\/\/(?!127\.0\.0\.1[:/]|localhost[:/])/;

/**
 * A scripted server for the app's own route (`/`), which, unlike `/__preview`, connects to a real backend
 * (`wss://server.apron.chat` by default) and shows the connect screen and sign-in. Every WebSocket the page
 * opens is answered here instead, and every request off this machine is refused, so no test reaches the
 * network. It offers guests, passkeys and email, and has one room, `General`, with no history. With capability
 * `status` (§4.5), General's other members show their status: Bob online, and Ada offline, last seen two hours
 * before the tests' clock (`seen`, §4.5.2).
 */
export async function mockServer(page: Page): Promise<void> {
	await page.route(OFFSITE, (route) => route.abort());
	await page.routeWebSocket(/.*/, (ws) => {
		const you = { user_id: 'guest_1', name: 'Guest 1', status: 'online' };
		// Complete objects, as the listing carries them: the shown status, and `seen` with a shown `offline`.
		const ada = { user_id: 'ada', name: 'Ada', status: 'offline', seen: String(NOW.getTime() - 2 * 60 * 60 * 1000) };
		const bob = { user_id: 'bob', name: 'Bob', status: 'online' };
		const general = { room_id: 'general', title: 'General', log_id: '1', latest_log_id: '1', history_log_id: null, members: [{ user_id: you.user_id }, { user_id: ada.user_id }, { user_id: bob.user_id }] };
		ws.onMessage((data) => {
			const frame = JSON.parse(String(data));
			const reply = (result: unknown) => frame.id !== undefined && ws.send(JSON.stringify({ id: frame.id, result }));
			switch (frame.method) {
				case 'ping': return ws.send(JSON.stringify({ method: 'pong' }));
				case 'auth': return reply({ you });
				case 'room_list': return reply({ joined: [general], users: [you, ada, bob] });
				// Idle reports (§4.5.3): taken, and kept nowhere.
				case 'status': return reply({});
				case 'history': return reply({ messages: [], more: false, latest_log_id: '1', history_log_id: null });
				default:
					if (frame.id !== undefined) ws.send(JSON.stringify({ id: frame.id, error: { code: -32601, message: `Not in the mock: ${frame.method}` } }));
			}
		});
		ws.send(JSON.stringify({ method: 'server', params: { apron: 9, agent: 'apron-e2e-mock', auth: ['guest', 'webauthn', 'email'], signup: ['guest', 'webauthn'], ping: 60, capabilities: ['history', 'rooms', 'status'] } }));
	});
}
