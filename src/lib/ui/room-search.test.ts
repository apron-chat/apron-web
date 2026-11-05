import { describe, expect, it } from 'vitest';
import type { RoomRecord } from '$lib/protocol/types';
import { knownRooms, matchTier, rankRooms, type KnownRoom } from './room-search';

const room = (id: string, title: string, fields: Partial<KnownRoom> = {}): KnownRoom => ({ id, title, joined: true, ...fields });
const listing = (id: string, title: string, fields: { parentRoomId?: string; latestLogId?: string; record?: Partial<RoomRecord> } = {}) => ({
	id, title, joined: false, record: { room_id: id, title, ...fields.record } as RoomRecord,
	...(fields.parentRoomId !== undefined ? { parentRoomId: fields.parentRoomId } : {}), ...(fields.latestLogId !== undefined ? { latestLogId: fields.latestLogId } : {})
});

describe('knownRooms', () => {
	it('takes each room once: as shown, else as listed, else from its record, leaving out a private room known only from a record', () => {
		const known = knownRooms(
			[{ id: 'general', title: 'General', joined: true, latestLogId: '30' }, { id: 't1', title: 'Deploy', parentRoomId: 'general', joined: false }],
			[listing('general', 'Old title'), listing('random', 'Random', { latestLogId: '20', record: { description: 'Anything' } }), listing('t2', 'Cert', { parentRoomId: 'general' })],
			[
				{ room_id: 'random', title: 'Older', log_id: '1' }, { room_id: 't3', parent_room_id: 'general', title: 'Offsite', log_id: '5' },
				{ room_id: 'hiring', title: 'Hiring', private: true }, { room_id: 'bare', log_id: '2' }
			]
		);
		expect(known).toEqual([
			{ id: 'general', title: 'General', joined: true, activeId: '30' },
			{ id: 't1', title: 'Deploy', parentRoomId: 'general', joined: false },
			{ id: 'random', title: 'Random', joined: false, description: 'Anything', activeId: '20' },
			{ id: 't2', title: 'Cert', parentRoomId: 'general', joined: false },
			{ id: 't3', title: 'Offsite', parentRoomId: 'general', joined: false, activeId: '5' },
			{ id: 'bare', title: 'bare', joined: false, activeId: '2' }
		]);
	});
});

describe('matchTier', () => {
	it('ranks the whole name, its start, a word in it, anywhere in it, then its description, in any case and accent', () => {
		const deploy = room('deploy-bots', 'Déploy bots', { description: 'Release notes' });
		expect(matchTier(deploy, 'deploy bots')).toBe(0);
		expect(matchTier(deploy, 'deploy-bots')).toBe(0);
		expect(matchTier(deploy, 'dep')).toBe(1);
		expect(matchTier(deploy, 'bots')).toBe(2);
		expect(matchTier(deploy, 'ots')).toBe(3);
		expect(matchTier(deploy, 'release')).toBeUndefined();
		expect(matchTier(deploy, 'release', true)).toBe(4);
		expect(matchTier(deploy, '')).toBe(0);
	});
});

describe('rankRooms', () => {
	const known = [
		room('eng', 'Engineering', { activeId: '50' }),
		room('t-checklist', 'Deploy checklist', { parentRoomId: 'eng', activeId: '40' }),
		room('t-freeze', 'Deploy freeze', { parentRoomId: 'ops', activeId: '10' }),
		room('bots', 'Release bots', { description: 'Deploy notices', activeId: '60' }),
		room('t-deps', 'Dependency upgrades', { parentRoomId: 'eng', joined: false, activeId: '45' }),
		room('departures', 'Departures', { joined: false, activeId: '55' }),
		room('t-old', 'Old deploy keys', { parentRoomId: 'eng', joined: false, activeId: '5' })
	];

	it('puts joined rooms first, then the better match, then the newer', () => {
		const found = rankRooms(known, { text: 'dep', rooms: [] });
		expect(found.rooms.map((found) => found.id)).toEqual(['t-checklist', 't-freeze', 'bots', 'departures', 't-deps', 't-old']);
		expect(found.total).toBe(6);
		expect(found.scope).toEqual([]);
	});

	it('with room:, searches only the threads of the rooms it names, by id or title', () => {
		for (const value of ['eng', 'engineering']) {
			const found = rankRooms(known, { text: 'dep', rooms: [value] });
			expect(found.rooms.map((found) => found.id)).toEqual(['t-checklist', 't-deps', 't-old']);
			expect(found.scope.map((scope) => scope.id)).toEqual(['eng']);
		}
		expect(rankRooms(known, { text: '', rooms: ['eng'] }).rooms.map((found) => found.id)).toEqual(['t-checklist', 't-deps', 't-old']);
		expect(rankRooms(known, { text: '', rooms: ['nowhere'] }).rooms).toEqual([]);
	});

	it('with nothing typed, lists everything, joined and most recently active first, as far as the limit', () => {
		const found = rankRooms(known, { text: '  ', rooms: [] }, 3);
		expect(found.rooms.map((found) => found.id)).toEqual(['bots', 'eng', 't-checklist']);
		expect(found.total).toBe(7);
	});

	it('handles thousands of threads', () => {
		const many = [room('eng', 'Engineering'), ...Array.from({ length: 5000 }, (_, n) => room(`t${n}`, `Incident ${n}`, { parentRoomId: 'eng', joined: n % 2 === 0, activeId: String(1_700_000_000_000 + n) }))];
		const found = rankRooms(many, { text: 'incident 4999', rooms: ['eng'] });
		expect(found.rooms[0].id).toBe('t4999');
		expect(rankRooms(many, { text: 'incident', rooms: [] }).total).toBe(5000);
	});
});
