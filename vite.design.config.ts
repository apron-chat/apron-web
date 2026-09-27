/* No vitePreprocess: the components use type-only TypeScript, which Svelte 5 strips natively.
   Builds the design system bundle (one IIFE setting window.Apron) from the presentational components.
   Run through `npm run design:bundle`, which also writes bundle.css and the header the design system reads. */
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [svelte({ configFile: false, compilerOptions: { runes: true, css: 'external' } })],
	build: {
		outDir: 'dist-design',
		emptyOutDir: true,
		minify: true,
		lib: { entry: 'src/lib/design/bundle.svelte.ts', formats: ['iife'], name: '__apron', fileName: () => 'bundle.js' }
	}
});
