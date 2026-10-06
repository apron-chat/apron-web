/**
 * Files arriving by drag and drop or paste, to attach to the draft
 * (capability `embed:upload`, §4.8.4).
 */

/** A drag or paste that carries files, rather than text or a link. */
export function carriesFiles(data: DataTransfer | null | undefined): boolean {
	return Boolean(data && [...data.types].includes('Files'));
}

/** The files a drop carries, leaving out folders, which can't be uploaded. */
export function droppedFiles(data: DataTransfer | null | undefined): File[] {
	if (!data) return [];
	const items = [...data.items].filter((item) => item.kind === 'file');
	if (items.length === 0) return [...data.files];
	return items.flatMap((item) => {
		if (item.webkitGetAsEntry?.()?.isDirectory) return [];
		const file = item.getAsFile();
		return file ? [file] : [];
	});
}

/**
 * The files a paste attaches, or none when its text should be pasted
 * instead. Text wins when there is some, since office apps put a picture of
 * the selection beside it, except when the text only names the pasted files,
 * as file managers add when copying files.
 */
export function pastedFiles(data: DataTransfer | null | undefined): File[] {
	if (!data) return [];
	const files = [...data.items].flatMap((item) => (item.kind === 'file' ? [item.getAsFile()].filter((file): file is File => file !== null) : []));
	if (files.length === 0) return [];
	const lines = data.getData('text/plain').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
	const names = new Set(files.map((file) => file.name).filter(Boolean));
	return lines.every((line) => names.has(baseName(line))) ? files : [];
}

/** The last path segment of a path or `file:` URI. */
function baseName(path: string): string {
	const last = path.split(/[/\\]/).pop() ?? path;
	try {
		return path.startsWith('file:') ? decodeURIComponent(last) : last;
	} catch {
		return last;
	}
}

export interface FileDropOptions {
	/** Whether a drop attaches; when not, it is refused rather than opening the file in the tab. */
	enabled: boolean;
	onfiles: (files: File[]) => void;
	/** Files are being dragged over the element (and would be attached). */
	onactive: (active: boolean) => void;
}

/** Svelte action: files dropped on the element are attached. */
export function fileDrop(node: HTMLElement, options: FileDropOptions) {
	let current = options;
	/** Enter and leave fire for each child crossed: the drag is over the element while this is above zero. */
	let depth = 0;
	let active = false;
	const show = (next: boolean) => {
		if (active === next) return;
		active = next;
		current.onactive(next);
	};
	const enter = (event: DragEvent) => {
		if (!carriesFiles(event.dataTransfer)) return;
		event.preventDefault();
		depth++;
		show(current.enabled);
	};
	const over = (event: DragEvent) => {
		if (!carriesFiles(event.dataTransfer)) return;
		event.preventDefault();
		if (event.dataTransfer) event.dataTransfer.dropEffect = current.enabled ? 'copy' : 'none';
	};
	const leave = (event: DragEvent) => {
		if (!carriesFiles(event.dataTransfer)) return;
		depth = Math.max(0, depth - 1);
		if (depth === 0) show(false);
	};
	const drop = (event: DragEvent) => {
		if (!carriesFiles(event.dataTransfer)) return;
		event.preventDefault();
		depth = 0;
		show(false);
		if (!current.enabled) return;
		const files = droppedFiles(event.dataTransfer);
		if (files.length) current.onfiles(files);
	};
	node.addEventListener('dragenter', enter);
	node.addEventListener('dragover', over);
	node.addEventListener('dragleave', leave);
	node.addEventListener('drop', drop);
	return {
		update(next: FileDropOptions) {
			current = next;
			if (!next.enabled) show(false);
		},
		destroy() {
			node.removeEventListener('dragenter', enter);
			node.removeEventListener('dragover', over);
			node.removeEventListener('dragleave', leave);
			node.removeEventListener('drop', drop);
		}
	};
}
