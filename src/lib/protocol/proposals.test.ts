import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { findProposal, forgetProposal, newProposalState, rememberProposal, type Proposal } from './proposals';
import { memoryStorage } from '$lib/test/storage';

/** The email proposals this browser made (§4.11.1). */
describe('proposals', () => {
	const storage = new Map<string, string>();

	beforeEach(() => {
		storage.clear();
		vi.stubGlobal('localStorage', memoryStorage(storage));
	});

	afterEach(() => vi.unstubAllGlobals());

	const proposal = (state: string, expires = 1_000): Proposal => ({ scheme: 'email', kind: 'sign-in', url: 'wss://chat.example/', state, expires });

	it('makes an unguessable state well within 256 bytes', () => {
		const states = new Set(Array.from({ length: 20 }, () => newProposalState()));
		expect(states.size).toBe(20);
		for (const state of states) expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/);
	});

	it('remembers a few proposals until they expire or are used', () => {
		rememberProposal(proposal('a'), 0);
		rememberProposal(proposal('b', 2_000), 0);
		expect(findProposal('a', 500)).toEqual(proposal('a'));
		expect(findProposal(undefined, 500)).toBeUndefined();
		// Expired: forgotten.
		expect(findProposal('a', 1_500)).toBeUndefined();
		expect(findProposal('b', 1_500)).toBeDefined();
		forgetProposal('b', 0);
		expect(findProposal('b', 0)).toBeUndefined();
		for (let n = 0; n < 12; n++) rememberProposal(proposal(`p${n}`), 0);
		expect(findProposal('p0', 0)).toBeUndefined();
		expect(findProposal('p11', 0)).toBeDefined();
		// Anything else in storage is no proposal.
		storage.set('apron.proposals', '[{"state":"x"}, 3]');
		expect(findProposal('x', 0)).toBeUndefined();
		storage.set('apron.proposals', 'not json');
		expect(findProposal('x', 0)).toBeUndefined();
	});
});
