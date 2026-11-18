/**
 * Pure helpers used by the plugin. These have no Vite dependency, which keeps
 * them easy to unit test.
 */

/**
 * Suffix of the virtual module generated for a component's `<script remote>` block.
 *
 * It must NOT contain `.svelte.`, otherwise vite-plugin-svelte compiles it as a
 * runes module. It must end in `.remote.ts` so SvelteKit treats it as a remote module.
 */
export const SUFFIX = '.inline.remote.ts';

const SVELTE_EXT = '.svelte';

/** Matches the first `<script ... remote ...>...</script>` block. `remote` must be a standalone attribute. */
const REMOTE_BLOCK = /<script\b((?:[^>]*\s)?remote(?:[\s=/][^>]*)?)>([\s\S]*?)<\/script>/;

/** Matches the instance `<script>` tag (not `module` / `context="module"`). */
const INSTANCE_SCRIPT = /<script\b(?![^>]*(?:\smodule\b|context=["']module["']))([^>]*)>/;

export interface RemoteBlock {
	/** The whole `<script remote>...</script>` element. */
	full: string;
	/** Raw attribute string of the opening tag. */
	attrs: string;
	/** Source code inside the block. */
	code: string;
	/** Offset of the block in the component source. */
	index: number;
}

/** `/a/B.svelte` -> `/a/B.inline.remote.ts` */
export const toVirtual = (svelteFile: string): string => svelteFile.slice(0, -SVELTE_EXT.length) + SUFFIX;

/** `/a/B.inline.remote.ts` -> `/a/B.svelte` */
export const toSvelte = (virtualFile: string): string => virtualFile.slice(0, -SUFFIX.length) + SVELTE_EXT;

/** Strip a Vite query string (`?foo`) from an id. */
export const cleanId = (id: string): string => id.split('?', 1)[0] ?? id;

/**
 * Normalise an import specifier so `./X.inline.remote`, `./X.inline.remote.js`
 * and `./X.inline.remote.ts` all map to `./X.inline.remote.ts`.
 * Returns `null` if the specifier is not an inline remote module.
 */
export function normaliseSpecifier(id: string): string | null {
	let out = cleanId(id);
	if (out.endsWith('.inline.remote')) out += '.ts';
	else if (out.endsWith('.inline.remote.js')) out = `${out.slice(0, -3)}.ts`;
	return out.endsWith(SUFFIX) ? out : null;
}

/** Find the `<script remote>` block in a component's source, if any. */
export function extractRemoteBlock(source: string): RemoteBlock | null {
	const m = REMOTE_BLOCK.exec(source);
	if (!m) return null;
	return { full: m[0], attrs: m[1] ?? '', code: m[2] ?? '', index: m.index };
}

/** Find the instance `<script>` opening tag. */
export function findInstanceScript(source: string): { index: number; length: number } | null {
	const m = INSTANCE_SCRIPT.exec(source);
	return m ? { index: m.index, length: m[0].length } : null;
}

/** Replace comments with whitespace so commented-out exports are ignored. */
function stripComments(code: string): string {
	return code.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:\\])\/\/.*$/gm, '$1');
}

const IDENT = /^[A-Za-z_$][\w$]*$/;

/**
 * Collect the names of value exports from the remote block.
 *
 * This is a lightweight scan, not a full parser. It handles
 * `export const|let|var|function|async function|function*` and
 * `export { a, b as c }`. Type-only exports are ignored.
 */
export function exportNames(code: string): string[] {
	const src = stripComments(code);
	const names = new Set<string>();

	for (const m of src.matchAll(/\bexport\s+(?:const|let|var|(?:async\s+)?function\s*\*?)\s*([A-Za-z_$][\w$]*)/g)) {
		if (m[1]) names.add(m[1]);
	}

	for (const m of src.matchAll(/\bexport\s*\{([^}]*)\}(?!\s*from\b)/g)) {
		for (const part of (m[1] ?? '').split(',')) {
			const spec = part.trim();
			if (!spec || spec.startsWith('type ')) continue;
			const alias =
				spec
					.split(/\s+as\s+/)
					.pop()
					?.trim() ?? '';
			if (IDENT.test(alias) && alias !== 'default') names.add(alias);
		}
	}

	return [...names];
}

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Whether the component already imports from its own inline remote module
 * (e.g. the author wrote the import by hand to get editor types).
 */
export function importsOwnRemote(source: string, virtualBasename: string): boolean {
	const stem = escapeRegExp(virtualBasename.replace(/\.ts$/, ''));
	return new RegExp(`from\\s+['"]\\./${stem}(?:\\.ts|\\.js)?['"]`).test(source);
}
