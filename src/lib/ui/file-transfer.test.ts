import { describe, expect, it } from 'vitest';
import { carriesFiles, droppedFiles, pastedFiles } from './file-transfer';

/** Enough of a DataTransfer for these helpers: Node has none. */
function transfer({ files = [], text = '', folders = [] }: { files?: File[]; text?: string; folders?: string[] }): DataTransfer {
	const items = [
		...files.map((file) => ({ kind: 'file', type: file.type, getAsFile: () => file, webkitGetAsEntry: () => ({ isDirectory: false }) })),
		...folders.map((name) => ({ kind: 'file', type: '', getAsFile: () => new File([], name), webkitGetAsEntry: () => ({ isDirectory: true }) })),
		...(text ? [{ kind: 'string', type: 'text/plain', getAsFile: () => null }] : [])
	];
	return {
		types: [...(files.length || folders.length ? ['Files'] : []), ...(text ? ['text/plain'] : [])],
		items,
		files,
		getData: (type: string) => (type === 'text/plain' ? text : '')
	} as unknown as DataTransfer;
}

const image = new File(['x'], 'shot.png', { type: 'image/png' });

describe('carriesFiles', () => {
	it('is true only for drags with files', () => {
		expect(carriesFiles(transfer({ files: [image] }))).toBe(true);
		expect(carriesFiles(transfer({ text: 'https://example.com' }))).toBe(false);
		expect(carriesFiles(null)).toBe(false);
	});
});

describe('droppedFiles', () => {
	it('takes the files and leaves out folders', () => {
		expect(droppedFiles(transfer({ files: [image], folders: ['photos'] }))).toEqual([image]);
	});
});

describe('pastedFiles', () => {
	it('attaches a pasted image', () => {
		expect(pastedFiles(transfer({ files: [image] }))).toEqual([image]);
	});

	it('pastes the text when there is some beside a picture of it', () => {
		expect(pastedFiles(transfer({ files: [image], text: 'Q3 totals\t42' }))).toEqual([]);
	});

	it('attaches files a file manager copied along with their names or paths', () => {
		const report = new File(['x'], 'my report.pdf', { type: 'application/pdf' });
		expect(pastedFiles(transfer({ files: [image], text: 'shot.png' }))).toEqual([image]);
		expect(pastedFiles(transfer({ files: [image, report], text: 'file:///home/ada/shot.png\nfile:///home/ada/my%20report.pdf' }))).toEqual([image, report]);
		expect(pastedFiles(transfer({ files: [image], text: 'C:\\Users\\ada\\shot.png' }))).toEqual([image]);
	});

	it('has nothing to attach in plain text', () => {
		expect(pastedFiles(transfer({ text: 'hello' }))).toEqual([]);
	});
});
