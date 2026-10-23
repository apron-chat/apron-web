import type { Page } from '@playwright/test';

/** Any URL off this machine. */
export const OFFSITE = /^https?:\/\/(?!127\.0\.0\.1[:/]|localhost[:/])/;

/**
 * A scripted server for the app's own route (`/`), which, unlike `/__preview`, connects to a real backend
 * (`wss://server.apron.chat` by default) and shows the connect screen and sign-in. Every WebSocket the page
 * opens is answered here instead, and every request off this machine is refused, so no test reaches the
 * network. It offers guests, passkeys and email, and has one room, `General`, with no history.
 */
export async function mockServer(page: Page): Promise<void> {
	await page.route(OFFSITE, (route) => route.abort());
	await page.routeWebSocket(/.*/, (ws) => {
		const you = { user_id: 'guest_1', name: 'Guest 1' };
		const general = { room_id: 'general', title: 'General', log_id: '1', latest_log_id: '1', history_log_id: null, members: [{ user_id: you.user_id }] };
		ws.onMessage((data) => {
			const frame = JSON.parse(String(data));
			const reply = (result: unknown) => frame.id !== undefined && ws.send(JSON.stringify({ id: frame.id, result }));
			switch (frame.method) {
				case 'ping': return ws.send(JSON.stringify({ method: 'pong' }));
				case 'auth': return reply({ you });
				case 'room_list': return reply({ joined: [general], users: [you] });
				case 'history': return reply({ messages: [], more: false, latest_log_id: '1', history_log_id: null });
				default:
					if (frame.id !== undefined) ws.send(JSON.stringify({ id: frame.id, error: { code: -32601, message: `Not in the mock: ${frame.method}` } }));
			}
		});
		ws.send(JSON.stringify({ method: 'server', params: { apron: 9, agent: 'apron-e2e-mock', auth: ['guest', 'webauthn', 'email'], signup: ['guest', 'webauthn'], ping: 60, capabilities: ['history', 'rooms'] } }));
	});
}
