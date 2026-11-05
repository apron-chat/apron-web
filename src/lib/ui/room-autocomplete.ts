import { tokenAtCaret, type CaretToken, type DraftPart } from './draft';
import { matchTier, wantedOf } from './room-match';

export interface RoomSuggestion {
	id: string;
	title: string;
}

export type RoomQuery = CaretToken;

const ROOM_CHAR = /[A-Za-z0-9_.-]/;
const MAX_MATCHES = 8;

/** Finds a #room ID at the caret, stopping at chips and whitespace. */
export function roomQuery(parts: DraftPart[], caret: number): RoomQuery | undefined {
	return tokenAtCaret(parts, caret, '#', ROOM_CHAR);
}

/**
 * Finds rooms by ID or title, in any case and with or without accents (`matchTier`, as search's rooms and threads
 * matches them): one named exactly first, then those it starts, then a word in their title, then any holding it.
 */
export function searchRooms(rooms: RoomSuggestion[], query: string): RoomSuggestion[] {
	const wanted = wantedOf(query);
	return rooms
		.map((room) => {
			const rank = matchTier(room, wanted);
			return rank === undefined ? undefined : { room, rank };
		})
		.filter((entry) => entry !== undefined)
		.sort((a, b) => a.rank - b.rank || a.room.title.localeCompare(b.room.title) || a.room.id.localeCompare(b.room.id))
		.slice(0, MAX_MATCHES)
		.map(({ room }) => room);
}
