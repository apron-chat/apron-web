/**
 * What offers the server's commands (`ext:command_list`), loaded on demand: the first time a server advertises the
 * extension, so a page on any other loads none of it. `command-offer.svelte.ts` imports this module dynamically, and
 * nothing that loads with the app imports it; what does (`DraftField`) reads only `command-query.ts`. Nothing here
 * imports, other than types, a module that loads with the app (or the on-demand chunk): one that did would be split
 * into a chunk of its own, loaded with them.
 */
export { LoadedCommands } from './commands-loaded.svelte';
