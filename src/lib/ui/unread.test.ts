import { describe, expect, it } from 'vitest';
import type { MessageRecord } from '$lib/protocol/types';
import { UnreadTracker, countElsewhere } from './unread.svelte';
import { tabTitle } from './attention';
import { messageRecord, roomSnapshot as room } from '$lib/test/builders';

const me = { user_id: 'guest_me', name: 'sam' };

const message = (id: number, roomId: string, from = 'ada', fields: Partial<MessageRecord> = {}): MessageRecord => messageRecord(id, roomId, { from: { user_id: from }, ...fields });

describe('unread tracking', () => {
	it('counts arrivals from others that still stand, never history or your own messages', () => {
		const tracker = new UnreadTracker();
		tracker.observe([room('general', [message(10, 'general')], { latestLogId: '10' }), room('random', [], { latestLogId: '10' })], me, 'general', true);
		expect(tracker.total).toBe(0);
		tracker.observe([
			room('general', [message(10, 'general')]),
			room('random', [message(20, 'random'), message(21, 'random', me.user_id), message(22, 'random')])
		], me, 'general', true);
		expect(tracker.byRoom).toEqual({ random: 2 });
		expect(tracker.total).toBe(2);
		// One deleted since drops out.
		tracker.observe([room('general', [message(10, 'general')]), room('random', [message(20, 'random', 'ada', { deleted: true }), message(21, 'random', me.user_id), message(22, 'random')])], me, 'general', true);
		expect(tracker.total).toBe(1);
	});

	it('clears a room once you read its end, or your read cursor or your own read position passes its arrivals', () => {
		const tracker = new UnreadTracker();
		tracker.observe([room('general', [], { latestLogId: '10' }), room('random', [], { latestLogId: '10' })], me, 'general', true);
		// Arrivals in the open pane count while you aren't reading its end (scrolled up, or the tab is hidden).
		const general = room('general', [message(20, 'general'), message(21, 'general')]);
		const random = room('random', [message(30, 'random'), message(31, 'random')]);
		tracker.observe([general, random], me, 'general', false);
		expect(tracker.byRoom).toEqual({ general: 2, random: 2 });
		tracker.observe([general, random], me, 'general', true);
		expect(tracker.byRoom).toEqual({ random: 2 });
		// Read on another device up to 30: only 31 is left.
		tracker.observe([general, { ...random, readMessageId: '30' }], me, 'general', true);
		expect(tracker.total).toBe(1);
		// Or up to how far you have read here, as given.
		tracker.observe([general, room('random', [message(30, 'random'), message(31, 'random'), message(32, 'random')])], me, 'general', true, () => '31');
		expect(tracker.byRoom).toEqual({ random: 1 });
	});

	it('keeps what came while the page was closed through a reload: loaded history after your read position, in joined rooms', () => {
		const tracker = new UnreadTracker();
		const general = room('general', [message(10, 'general'), message(20, 'general'), message(25, 'general', me.user_id), message(30, 'general'), message(35, 'general', 'ada', { deleted: true })], { latestLogId: '35' });
		const viewed = room('lobby', [message(10, 'lobby'), message(20, 'lobby')], { latestLogId: '20', joined: false });
		// Read through 15 here before the reload: 20 and 30 are from others and not deleted; 25 is yours.
		tracker.observe([general, viewed, room('random', [message(10, 'random')], { latestLogId: '10' })], me, 'dm', true, (entry) => (entry.id === 'random' ? undefined : '15'));
		expect(tracker.byRoom).toEqual({ general: 2 });
		// Reading the room's end, or a read position past them, clears them.
		tracker.observe([general], me, 'general', true, () => '15');
		expect(tracker.byRoom).toEqual({});
		tracker.observe([general], me, 'dm', true, () => '30');
		expect(tracker.byRoom).toEqual({});
	});

	it('counts history once a read cursor arrives after the listing, as from a server that keeps them', () => {
		const tracker = new UnreadTracker();
		tracker.observe([room('general', [], { latestLogId: '30' })], me, 'dm', true);
		expect(tracker.total).toBe(0);
		// Its newest page loads, then the server's cursor for it (§4.6).
		const loaded = room('general', [message(10, 'general'), message(20, 'general'), message(30, 'general')], { latestLogId: '30' });
		tracker.observe([loaded], me, 'dm', true);
		expect(tracker.total).toBe(0);
		tracker.observe([{ ...loaded, readMessageId: '10' }], me, 'dm', true);
		expect(tracker.byRoom).toEqual({ general: 2 });
	});

	it('counts a room someone added you to from your join, also what was said there before this page saw it', () => {
		const tracker = new UnreadTracker();
		tracker.observe([room('general', [], { latestLogId: '10' })], me, 'general', true);
		// Added while away: the room arrives with its head past the join and the messages since.
		tracker.addedTo('dm');
		const joined = (dm: ReturnType<typeof room>) => ({ ...dm, timeline: { ...dm.timeline, memberships: [{ log_id: '15', entries: [{ user: me, joined: true }] }] } });
		tracker.observe([room('general'), room('dm', [], { latestLogId: '22' })], me, 'general', true);
		expect(tracker.total).toBe(0);
		// Its history loads: the join, one message before it, and two since.
		const loaded = joined(room('dm', [message(12, 'dm'), message(20, 'dm'), message(22, 'dm')], { latestLogId: '22' }));
		tracker.observe([room('general'), loaded], me, 'general', true);
		expect(tracker.byRoom).toEqual({ dm: 2 });
		// A later message adds to them, once.
		tracker.observe([room('general'), joined(room('dm', [message(12, 'dm'), message(20, 'dm'), message(22, 'dm'), message(30, 'dm')]))], me, 'general', true);
		expect(tracker.byRoom).toEqual({ dm: 3 });
		// Left, then added again later: what was said before this join doesn't count, though the room was seen before.
		tracker.addedTo('dm');
		const readded = { ...room('dm', [message(12, 'dm'), message(20, 'dm'), message(22, 'dm'), message(30, 'dm'), message(40, 'dm'), message(50, 'dm')]), timeline: { ...room('dm', [message(12, 'dm'), message(20, 'dm'), message(22, 'dm'), message(30, 'dm'), message(40, 'dm'), message(50, 'dm')]).timeline, memberships: [{ log_id: '15', entries: [{ user: me, joined: true }] }, { log_id: '35', entries: [{ user: me, joined: false }] }, { log_id: '45', entries: [{ user: me, joined: true }] }] } };
		tracker.observe([room('general'), readded], me, 'general', true);
		expect(tracker.byRoom).toEqual({ dm: 1 });
		// An older read position from before you left counts nothing before the join.
		tracker.observe([room('general'), readded], me, 'general', true, (entry) => (entry.id === 'dm' ? '12' : undefined));
		expect(tracker.byRoom).toEqual({ dm: 1 });
		// A room you joined yourself still counts only what arrives after this page saw it.
		tracker.observe([room('general'), readded, joined(room('mine', [message(20, 'mine')], { latestLogId: '20' }))], me, 'general', true);
		expect(tracker.byRoom).toEqual({ dm: 1 });
	});

	it('counts replies in a thread you are not reading, until you open it', () => {
		const tracker = new UnreadTracker();
		const thread = (messages: MessageRecord[]) => room('plans', messages, { parentRoomId: 'general', latestLogId: '10' });
		tracker.observe([room('general', [], { latestLogId: '10' }), thread([])], me, 'general', true);
		tracker.observe([room('general', []), thread([message(20, 'plans'), message(21, 'plans', me.user_id)])], me, 'general', true);
		expect(tracker.byRoom).toEqual({ plans: 1 });
		tracker.observe([room('general', []), thread([message(20, 'plans'), message(21, 'plans', me.user_id)])], me, 'plans', true);
		expect(tracker.byRoom).toEqual({});
	});

});

describe('countElsewhere', () => {
	it('adds up every room but the one being read', () => {
		expect(countElsewhere({ general: 3, random: 2, thread_1: 4 }, 'random')).toBe(7);
		expect(countElsewhere({ general: 3 }, 'general')).toBe(0);
		expect(countElsewhere({ general: 3, random: 2 }, undefined)).toBe(5);
	});
});

describe('tab title', () => {
	it('leads with the unread count and flashes for a mention', () => {
		expect(tabTitle(0, false)).toBe('Apron');
		expect(tabTitle(3, false)).toBe('(3) Apron');
		expect(tabTitle(1200, false)).toBe('(999+) Apron');
		expect(tabTitle(3, true)).toBe('@ You were mentioned');
	});
});
