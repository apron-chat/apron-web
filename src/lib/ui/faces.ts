import type { RoomSnapshot } from '$lib/protocol/client';
import type { Identity } from '$lib/protocol/types';
import type { Face } from '$lib/design/components/types';
import { presenceLabel } from '$lib/design/components/util';
import { directory } from './directory.svelte';
import { hueOf } from './messages';
import { othersIn } from './private-rooms';

/** A person as the design system's Face, as the directory knows them: with their status, unless `status` is false. */
export function faceOf(person: Identity, status = true): Face {
	const shown = status ? directory.status(person) : undefined;
	return { user_id: person.user_id, name: directory.name(person), src: directory.avatar(person), hue: hueOf(person.user_id), status: shown, statusLabel: presenceLabel(shown) };
}

/** People as the design system's Faces, each as the directory knows them: their status only where one shows alone. */
export function facesOf(people: readonly Identity[]): Face[] {
	return people.map((person) => faceOf(person, people.length === 1));
}

/** Who a private room is with: the others in it, or you, alone in it. */
export function roomFaces(room: Pick<RoomSnapshot, 'members'>, you: Identity | undefined): Face[] {
	const others = othersIn(room, you?.user_id);
	return facesOf(others.length ? others : you ? [you] : []);
}
