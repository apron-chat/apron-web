import type { RoomSnapshot } from '$lib/protocol/client';
import type { Identity } from '$lib/protocol/types';
import type { Face } from '$lib/design/components/types';
import { presenceLabel } from '$lib/design/components/util';
import { directory } from './directory.svelte';
import { hueOf } from './messages';
import { othersIn } from './private-rooms';

/** People as the design system's Faces, each as the directory knows them: their status only where one shows alone. */
export function facesOf(people: readonly Identity[]): Face[] {
	return people.map((person) => {
		const status = people.length === 1 ? directory.status(person) : undefined;
		return { user_id: person.user_id, name: directory.name(person), src: directory.avatar(person), hue: hueOf(person.user_id), status, statusLabel: presenceLabel(status) };
	});
}

/** Who a private room is with: the others in it, or you, alone in it. */
export function roomFaces(room: Pick<RoomSnapshot, 'members'>, you: Identity | undefined): Face[] {
	const others = othersIn(room, you?.user_id);
	return facesOf(others.length ? others : you ? [you] : []);
}
