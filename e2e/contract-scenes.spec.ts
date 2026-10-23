import { observe, record, SCENES } from './contract';
import { DEVICES, test } from './fixtures';

/**
 * Walks the app through the states apron-server-go's interop suite reaches, recording which of the contract's
 * test ids, names and selectors each shows (`contract.ts`). `contract.spec.ts` checks the records once all
 * scenes have run (it is a project that depends on this one).
 */

for (const scene of SCENES) {
	test.describe(() => {
		test.use({ ...DEVICES[scene.device ?? 'desktop'], knobs: scene.knobs ?? {} });

		test(scene.name, async ({ preview }) => {
			if (scene.root) await preview.openRoot();
			else await preview.open();
			await scene.steps(preview, async () => record(scene.name, await observe(preview.page)));
		});
	});
}
