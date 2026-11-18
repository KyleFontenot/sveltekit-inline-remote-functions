# sveltekit-inline-remote-functions

Write [SvelteKit remote functions](https://svelte.dev/docs/kit/remote-functions) **inside the component that uses them**, using a `<script remote>` block.

```svelte
<!-- src/routes/todos/+page.svelte -->
<script remote lang="ts">
	import { query, command } from '$app/server';
	import { db } from '$lib/server/db';

	export const getTodos = query(async () => db.todos.findMany());

	export const addTodo = command('unchecked', async (text: string) => {
		await db.todos.create({ text });
		await getTodos().refresh();
	});
</script>

<script lang="ts">
	let text = $state('');
</script>

<input bind:value={text} />
<button onclick={() => addTodo(text)}>Add</button>

{#each await getTodos() as todo}
	<p>{todo.text}</p>
{/each}
```

No separate `todos.remote.ts` file, and no import line: `getTodos` and `addTodo` are available in the component's markup and instance `<script>` automatically.

## Contents

- [Requirements](#requirements)
- [Installation](#installation)
- [Usage](#usage)
- [Importing inside `<script remote>`](#importing-inside-script-remote)
- [Using the functions elsewhere](#using-the-functions-elsewhere)
- [Recipes](#recipes)
- [Troubleshooting](#troubleshooting)
- [How it works](#how-it-works)
- [Limitations](#limitations)
- [Development](#development)

## Requirements

| Package              | Version                               |
| -------------------- | ------------------------------------- |
| `vite`               | 8.x (Rolldown-powered Vite)           |
| `@sveltejs/kit`      | 3.x (2.x works with config in `svelte.config.js`) |
| `svelte`             | 5.x with the experimental `async` flag |
| Node                 | 20+                                   |

## Installation

### 1. Add the package

```sh
npm i -D sveltekit-inline-remote-functions
# or
pnpm add -D sveltekit-inline-remote-functions
bun add -d sveltekit-inline-remote-functions
yarn add -D sveltekit-inline-remote-functions
```

### 2. Register the plugin

In `vite.config.ts`, add `inlineRemote()` **before** `sveltekit()`. Remote functions and async Svelte are still experimental, so turn both flags on:

```ts
// vite.config.ts
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { inlineRemote } from 'sveltekit-inline-remote-functions';

export default defineConfig({
	plugins: [
		inlineRemote(), // must come first
		sveltekit({
			compilerOptions: { experimental: { async: true } },
			experimental: { remoteFunctions: true },
		}),
	],
});
```

> **SvelteKit 2.x:** put the flags in `svelte.config.js` instead:
>
> ```js
> // svelte.config.js
> export default {
> 	compilerOptions: { experimental: { async: true } },
> 	kit: { experimental: { remoteFunctions: true } },
> };
> ```

### 3. Check that it works

Add a `<script remote>` block to any page, start the dev server (`npm run dev`), and load the page. If the function runs and its result shows up, you're set.

## Usage

### The basics

A `.svelte` file can contain up to three kinds of script block:

| Block                   | Runs on        | Purpose                                                 |
| ----------------------- | -------------- | ------------------------------------------------------- |
| `<script remote>`       | server only    | Remote functions (`query`, `command`, `form`, `prerender`) |
| `<script module>`       | client + server | Module-level code shared by all instances              |
| `<script>`              | client + server | The component instance                                 |

Write the `<script remote>` block exactly as you would write a `.remote.ts` file:

```svelte
<script remote lang="ts">
	import { query } from '$app/server';

	export const getTime = query(async () => new Date().toISOString());
</script>

<p>Server time: {await getTime()}</p>
```

Rules:

1. **Export every remote function** you want to use. Only exported names are imported into the component.
2. **Only export remote functions.** SvelteKit rejects `.remote` modules that export anything else at runtime. Keep helpers un-exported (or move them to `$lib/server`). Type exports are fine.
3. **Order doesn't matter.** The `<script remote>` block can come before or after the other script blocks.
4. **The instance `<script>` is optional.** If there isn't one, the plugin creates it.

### Queries, commands, forms

Everything from `$app/server` works:

```svelte
<script remote lang="ts">
	import { query, command, form } from '$app/server';
	import * as v from 'valibot';
	import { db } from '$lib/server/db';

	export const getPost = query(v.string(), async (slug) => {
		return db.posts.find(slug);
	});

	export const like = command(v.string(), async (slug) => {
		await db.posts.like(slug);
		await getPost(slug).refresh();
	});

	export const comment = form(
		v.object({ slug: v.string(), body: v.pipe(v.string(), v.minLength(1)) }),
		async ({ slug, body }) => {
			await db.comments.add(slug, body);
		},
	);
</script>

<script lang="ts">
	let { slug } = $props();
	const post = $derived(await getPost(slug));
</script>

<h1>{post.title}</h1>
<button onclick={() => like(slug)}>♥ {post.likes}</button>

<form {...comment}>
	<input type="hidden" name="slug" value={slug} />
	<textarea name="body"></textarea>
	<button>Comment</button>
</form>
```

### Components outside `routes/`

Any component works, not only `+page.svelte`. A reusable `$lib/components/Weather.svelte` can carry its own server query:

```svelte
<!-- src/lib/components/Weather.svelte -->
<script remote lang="ts">
	import { query } from '$app/server';
	import { env } from '$env/dynamic/private';
	import * as v from 'valibot';

	export const getWeather = query(v.string(), async (city) => {
		const res = await fetch(`https://api.example.com/weather?q=${city}&key=${env.WEATHER_KEY}`);
		return res.json() as Promise<{ temp: number }>;
	});
</script>

<script lang="ts">
	let { city }: { city: string } = $props();
</script>

<p>{city}: {(await getWeather(city)).temp}°</p>
```

## Importing inside `<script remote>`

The `<script remote>` block becomes its own server-side module, so imports there behave like imports in a `.remote.ts` file next to the component.

### What you can import

| Import                                         | Works? | Notes                                                     |
| ---------------------------------------------- | ------ | --------------------------------------------------------- |
| `$app/server`                                  | ✅     | `query`, `command`, `form`, `prerender`, `getRequestEvent` |
| `$lib/...`, `$lib/server/...`                  | ✅     | Server-only modules are safe; they never reach the client |
| `$env/static/private`, `$env/dynamic/private`  | ✅     | Secrets stay on the server                                |
| npm packages (`valibot`, `zod`, DB clients…)   | ✅     | Including Node-only packages                              |
| Relative paths (`./schema`, `../utils`)        | ✅     | Resolved from the **component's folder**                  |
| Other `.remote.ts` files                       | ✅     | Handy for calling `.refresh()` on a shared query          |
| `.svelte` components                           | ❌     | Server modules can't render components                    |
| `$app/state`, `$app/navigation`, browser APIs  | ❌     | Client-only; use them in the instance `<script>`          |

### Tip: relative imports resolve from the component's folder

The virtual module sits next to the component (`src/routes/todos/+page.inline.remote.ts`), so relative paths work as they would in the component:

```
src/routes/todos/
├── +page.svelte        ← contains <script remote>
└── schema.ts
```

```svelte
<script remote lang="ts">
	import { command } from '$app/server';
	import { TodoSchema } from './schema'; // → src/routes/todos/schema.ts

	export const addTodo = command(TodoSchema, async (todo) => { /* ... */ });
</script>
```

### Tip: each script block has its own imports

Imports **do not cross between blocks**. Something imported in `<script remote>` isn't visible in `<script>`, and the other way round. If both need it, import it in both:

```svelte
<script remote lang="ts">
	import { query } from '$app/server';
	import { formatPrice } from '$lib/format'; // used on the server

	export const getTotal = query(async () => formatPrice(await computeTotal()));
</script>

<script lang="ts">
	import { formatPrice } from '$lib/format'; // imported again for the client
	let draft = $state(0);
</script>

<p>Total: {await getTotal()} · Draft: {formatPrice(draft)}</p>
```

This is intentional: the remote block is a separate server module, which keeps server code out of your client bundle.

### Tip: keep secrets and server-only code in the remote block

Anything you import in `<script remote>` stays on the server. The client only gets small `fetch` wrappers for the exported functions. That makes it the right place for:

```svelte
<script remote lang="ts">
	import { query } from '$app/server';
	import { DATABASE_URL } from '$env/static/private';
	import postgres from 'postgres';

	const sql = postgres(DATABASE_URL); // not exported, never sent to the client

	export const getUsers = query(async () => sql`select id, name from users`);
</script>
```

> ⚠️ Don't import `$lib/server/*` or `$env/*/private` in the **instance** `<script>`. SvelteKit will (correctly) refuse to build because that code would ship to the browser.

### Tip: shared or reused logic goes in `$lib/server`

If two components need the same database helper, put it in a normal module and import it from each remote block:

```ts
// src/lib/server/todos.ts
import { db } from './db';
export const listTodos = () => db.todos.findMany();
```

```svelte
<script remote lang="ts">
	import { query } from '$app/server';
	import { listTodos } from '$lib/server/todos';

	export const getTodos = query(listTodos);
</script>
```

If the **remote function itself** is shared between many components, a regular `src/lib/todos.remote.ts` file is usually a better fit than an inline block.

### Tip: re-exports aren't auto-imported

The export scanner skips `export { x } from '...'` and `export * from '...'`. If you want to re-expose a remote function from another file, import it first and export it by name:

```svelte
<script remote lang="ts">
	// ❌ not picked up
	// export { getUser } from '$lib/users.remote';

	// ✅ picked up
	import { getUser } from '$lib/users.remote';
	export { getUser };
</script>
```

Usually you can skip the re-export altogether and import `$lib/users.remote` in the instance `<script>` directly.

### Tip: `getRequestEvent` for cookies, headers and locals

```svelte
<script remote lang="ts">
	import { query, getRequestEvent } from '$app/server';

	export const whoAmI = query(async () => {
		const { locals } = getRequestEvent();
		return locals.user?.name ?? 'guest';
	});
</script>
```

## Using the functions elsewhere

The block is served as `<ComponentName>.inline.remote.ts`, so other files can import it. All three forms work:

```ts
import { getTodos } from './+page.inline.remote';
import { getTodos } from './+page.inline.remote.js';
import { getTodos } from './+page.inline.remote.ts';
```

For example, a sibling component can refresh the page's query after a change:

```svelte
<!-- src/routes/todos/ClearButton.svelte -->
<script lang="ts">
	import { getTodos } from './+page.inline.remote';
	import { clearTodos } from '$lib/todos.remote';
</script>

<button onclick={async () => { await clearTodos(); await getTodos().refresh(); }}>Clear</button>
```

### Writing the import yourself

If the component already imports from its own `./X.inline.remote` module, the plugin leaves its imports alone and doesn't inject any. This lets you choose exactly which names to import, or import exports the scanner missed:

```svelte
<script remote lang="ts">
	import { query } from '$app/server';
	export const getTodos = query(async () => []);
</script>

<script lang="ts">
	import { getTodos } from './+page.inline.remote';
</script>
```

## Recipes

### Optimistic updates

```svelte
<script remote lang="ts">
	import { query, command } from '$app/server';
	import { db } from '$lib/server/db';

	export const getCount = query(async () => db.counter.get());
	export const increment = command(async () => db.counter.increment());
</script>

<button onclick={() => increment().updates(getCount().withOverride((n) => n + 1))}>
	{await getCount()}
</button>
```

### Prerendered data

```svelte
<script remote lang="ts">
	import { prerender } from '$app/server';
	import { getAllPosts } from '$lib/server/posts';

	export const getPosts = prerender(getAllPosts);
</script>

<ul>
	{#each await getPosts() as post}
		<li><a href="/blog/{post.slug}">{post.title}</a></li>
	{/each}
</ul>
```

## Troubleshooting

| Symptom                                                           | Likely cause / fix                                                                                                           |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `getTodos is not defined`                                         | It isn't exported, or the scanner missed it (e.g. a re-export). Add `export`, or [import it yourself](#writing-the-import-yourself). |
| `X.svelte has no <script remote> block`                           | Something imports `./X.inline.remote` but the component has no remote block. Check the file name and the `remote` attribute. |
| Remote block treated as normal client code                        | `inlineRemote()` must be listed **before** `sveltekit()` in `plugins`.                                                       |
| `remote functions are experimental` / `await` errors in markup     | Enable `experimental.remoteFunctions` and `compilerOptions.experimental.async`.                                              |
| SvelteKit complains a remote module exports a non-function        | Only export remote functions from the block. Drop `export` from helpers and constants.                                       |
| Server code changes don't show up                                 | Save the `.svelte` file again. HMR invalidates the virtual module whenever its component changes.                            |
| Editor shows red squiggles on `getTodos` in markup                | Expected; see [Limitations](#limitations). The code still builds and runs.                                                   |
| Weird parse error inside the remote block                         | The block ends at the first `</script>`. Don't put the literal string `</script>` inside it; split it (`'</scr' + 'ipt>'`).   |

## How it works

| Hook        | What it does                                                                                                                                                                            |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `transform` | Removes `<script remote>` from `X.svelte` and adds `import { ...exports } from './X.inline.remote.ts'` to the instance script. If the component has no instance script, it creates one. |
| `resolveId` | Resolves `./X.inline.remote`, `./X.inline.remote.js` and `./X.inline.remote.ts` (relative, absolute, or root-relative) to an absolute path, as long as `X.svelte` exists.               |
| `load`      | Returns the body of `X.svelte`'s `<script remote>` block as a TypeScript module.                                                                                                        |
| `hotUpdate` | When `X.svelte` changes, invalidates `X.inline.remote.ts` so HMR picks up the new server code.                                                                                          |

SvelteKit sees `X.inline.remote.ts` like any other `.remote.ts` file. Its code stays on the server, and the client gets the usual fetch wrappers.

## Limitations

- **One `<script remote>` block per component.** Only the first one is used.
- **Exports are found with a lightweight scanner**, not a full parser. It handles `export const/let/var/function/async function` and `export { a, b as c }`, and ignores type exports and `export ... from`. If it misses something, write the import yourself.
- **Editor tooling:** `svelte-check` and the Svelte language server don't know about `<script remote>`. Its exports won't be typed in the rest of the component, and a hand-written `./X.inline.remote` import won't resolve in the editor. Builds and the dev server are unaffected.
- **The `remote` attribute must stand alone.** `<script remote lang="ts">` works; `<script data-remote>` does not.
- **The block is always TypeScript.** Plain JS is valid TS, so `lang="ts"` is optional.

## Development

```sh
bun install
bun run check   # biome lint + format check, tsc typecheck, bun test
bun run build   # bundles src/ to dist/ with bun build and emits .d.ts with tsc
bun run lint:fix
```

### Publishing

```sh
npm login
npm publish     # prepublishOnly runs check + build
```

## License

MIT
