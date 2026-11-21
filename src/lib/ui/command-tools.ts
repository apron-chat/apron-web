/**
 * What offers the server's commands (`ext:command_list`), loaded on demand: the first time a server advertises the
 * extension, so a page on any other loads none of it. The page imports this module dynamically, and nothing that loads
 * with the app imports it; what does (`DraftField`) reads only `command-query.ts`. Nothing here imports, other than
 * types, a module that loads with the app: one that did would be split into a chunk of its own, loaded at startup.
 */
export { CommandList, keptLists } from './command-list.svelte';
export { commandCompletion, mergeCommands, ownCommands } from './command-autocomplete';
