/**
 * Test support for the protocol stream's history tests: what of a `history`
 * request to compare exactly.
 */

/**
 * A `history` request's params (§4.3.1) without `limit`, a tuning constant:
 * the room and the bounds, which a test compares exactly, so a bound the
 * request must not carry (no `before` on a resume behind `auth`) is checked too.
 *
 *     expect(bounds(socket.request('history').params)).toEqual({ room_id: 'general', after: '13' });
 */
export function bounds(params: unknown): Record<string, unknown> {
	const { limit: _limit, ...rest } = params as Record<string, unknown>;
	return rest;
}
