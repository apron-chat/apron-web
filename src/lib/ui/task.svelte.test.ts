import { describe, expect, it } from 'vitest';
import { failure, Task } from './task.svelte';

function deferred<T = void>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (cause: unknown) => void } {
	let resolve!: (value: T) => void;
	let reject!: (cause: unknown) => void;
	const promise = new Promise<T>((yes, no) => ((resolve = yes), (reject = no)));
	return { promise, resolve, reject };
}

describe('Task', () => {
	it('runs one thing at a time, busy meanwhile, and notes how it ended', async () => {
		const task = new Task<'add' | 'message'>();
		const work = deferred<string>();
		const ran = task.run('add', () => work.promise, { done: (room) => ({ text: `Added to ${room}`, error: false }), failed: failure('Unable to add') });
		expect(task.running).toBe('add');
		expect(task.busy).toBe(true);
		// Something else while it runs doesn't start.
		expect(await task.run('message', async () => undefined, { failed: failure('x') })).toBe(false);
		work.resolve('General');
		expect(await ran).toBe(true);
		expect(task.busy).toBe(false);
		expect(task.note).toEqual({ text: 'Added to General', error: false });
		// The next run clears the note as it starts, and notes its failure.
		const next = task.run('add', () => Promise.reject(new Error('Not allowed')), { failed: failure('Unable to add') });
		expect(task.note).toBeUndefined();
		// It didn't work: nothing to do once it's over.
		expect(await next).toBe(false);
		expect(task.note).toEqual({ text: 'Not allowed', error: true });
	});

	it('changes nothing for what shows next when work started before a reset settles', async () => {
		const task = new Task();
		const first = deferred();
		let stillAtEnd: boolean | undefined;
		const ran = task.run('busy', async (still) => {
			await first.promise;
			stillAtEnd = still();
		}, { done: () => ({ text: 'Added', error: false }), failed: failure('Unable') });
		// Another card opens: idle, with nothing noted, so its own request can start.
		task.reset();
		expect(task.busy).toBe(false);
		const second = deferred();
		const next = task.run('busy', () => second.promise, { done: () => ({ text: 'Second', error: false }), failed: failure('Unable') });
		first.resolve();
		await ran;
		// The first one's reply neither notes nor frees the second's run.
		expect(stillAtEnd).toBe(false);
		expect(task.note).toBeUndefined();
		expect(task.busy).toBe(true);
		second.resolve();
		await next;
		expect(task.note).toEqual({ text: 'Second', error: false });
	});

	it('drops a failure that settles after a reset', async () => {
		const task = new Task();
		const work = deferred();
		const ran = task.run('busy', () => work.promise, { failed: failure('Unable to remove') });
		task.reset();
		work.reject(new Error('Denied'));
		await ran;
		expect(task.note).toBeUndefined();
		expect(task.busy).toBe(false);
	});
});
