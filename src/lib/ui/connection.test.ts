import { describe, expect, it } from 'vitest';
import { capabilitiesOf, type ClientSnapshot } from '$lib/protocol/client';
import { addEmailError, connectionStateOf, demoRetentionNotice, offeredSchemes, schemeUse, statusLabel, wayBackNudge } from './connection';
import { retryAfterLabel } from './time';

const snapshot = (fields: Partial<ClientSnapshot>): ClientSnapshot => ({
	status: 'idle', authenticated: false, capabilities: capabilitiesOf(undefined), rooms: [], pending: [], typing: [], users: {}, recordedUsers: {}, userAliases: {}, uploads: {}, threadDirectory: {}, showReconnectDivider: false, ...fields
});

describe('connection state', () => {
	it('is connected only once auth has landed an identity', () => {
		expect(connectionStateOf(snapshot({ status: 'connected' }))).toBe('connecting');
		expect(connectionStateOf(snapshot({ status: 'connected', authenticated: true, you: { user_id: 'a' } }))).toBe('connected');
		expect(connectionStateOf(snapshot({ status: 'connected', disconnectedAt: 1 }))).toBe('reconnecting');
		expect(connectionStateOf(snapshot({ status: 'offline' }))).toBe('offline');
	});

	it('says what happened, then what the client is doing', () => {
		expect(statusLabel(snapshot({ status: 'reconnecting', disconnectedAt: 1 }), false)).toBe('Reconnecting…');
		expect(statusLabel(snapshot({ status: 'reconnecting', disconnectedAt: 1 }), true)).toBe('Still trying to reconnect…');
		expect(statusLabel(snapshot({ status: 'reconnecting', disconnectedAt: 1, error: 'WebSocket connection error' }), false)).toBe('Reconnecting…');
		expect(statusLabel(snapshot({ status: 'reconnecting', disconnectedAt: 1, error: 'Refused' }), true)).toBe('Still disconnected: Refused');
		expect(statusLabel(snapshot({ status: 'reconnecting', disconnectedAt: 1, retryAfterMs: 90_000 }), false)).toBe('Connection limited. Retrying in 2m…');
		expect(statusLabel(snapshot({ status: 'connecting' }), false)).toBe('Connecting…');
		expect(statusLabel(snapshot({ status: 'idle' }), false)).toBe('Waiting to connect');
	});

	it('rounds retry delays up to a readable unit', () => {
		expect(retryAfterLabel(500)).toBe('1s');
		expect(retryAfterLabel(59_000)).toBe('59s');
		expect(retryAfterLabel(61_000)).toBe('2m');
		expect(retryAfterLabel(3_600_000)).toBe('1h');
	});

	it('describes demo retention in hours, or a day', () => {
		expect(demoRetentionNotice(undefined)).toBe('');
		expect(demoRetentionNotice({ apron: 7, auth: ['guest'], ext: { demo: { retention_seconds: 86_400 } } })).toMatch(/last day/);
		expect(demoRetentionNotice({ apron: 7, auth: ['guest'], ext: { demo: { retention_seconds: 7_200 } } })).toMatch(/last 2 hours/);
		expect(demoRetentionNotice({ apron: 7, auth: ['guest'], ext: {} })).toBe('');
	});
});

describe('sign-in and sign-up schemes (server.signup)', () => {
	it('lets auth do both without signup', () => {
		const server = { auth: ['webauthn', 'email'] };
		expect(schemeUse(server, 'email')).toEqual({ signIn: true, signUp: true });
		expect(schemeUse(server, 'guest')).toEqual({ signIn: false, signUp: false });
		expect(offeredSchemes(server)).toEqual(['webauthn', 'email']);
	});

	it('splits signing in from creating an account with signup', () => {
		const server = { auth: ['webauthn'], signup: ['email'] };
		expect(schemeUse(server, 'webauthn')).toEqual({ signIn: true, signUp: false });
		expect(schemeUse(server, 'email')).toEqual({ signIn: false, signUp: true });
		expect(offeredSchemes(server)).toEqual(['webauthn', 'email']);
		expect(offeredSchemes(undefined)).toEqual([]);
	});
});

describe('ways back into an account', () => {
	it('nudges a token-only account, and one made with a scheme that only signs up', () => {
		expect(wayBackNudge({ auth: ['webauthn', 'email', 'token'] }, ['token'])).toEqual(['webauthn', 'email']);
		expect(wayBackNudge({ auth: ['webauthn'] }, ['email'])).toEqual(['webauthn']);
		expect(wayBackNudge({ auth: ['webauthn', 'token'] }, ['token', 'webauthn'])).toBeUndefined();
		expect(wayBackNudge({ auth: ['email'] }, ['email'])).toBeUndefined();
		// Nothing to suggest, or nothing known.
		expect(wayBackNudge({ auth: ['token'] }, ['token'])).toBeUndefined();
		expect(wayBackNudge({ auth: ['webauthn'] }, undefined)).toBeUndefined();
	});

	it('words a refused code on Add email', () => {
		expect(addEmailError(Object.assign(new Error('denied'), { code: -32001 }))).toMatch(/another account/);
		expect(addEmailError(new Error('Rate limited'))).toBe('Rate limited');
	});
});
