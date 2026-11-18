/**
 * `<script remote>` blocks in `.svelte` files become virtual `<Name>.inline.remote.ts`
 * modules that SvelteKit treats as remote-function files.
 *
 * Tested against @sveltejs/kit 3.x, svelte 5.57, vite 8.3, vite-plugin-svelte 7.3.
 */
import fs from 'node:fs';
import path from 'node:path';
import MagicString from 'magic-string';
import type { Plugin } from 'vite';
import {
	cleanId,
	exportNames,
	extractRemoteBlock,
	findInstanceScript,
	importsOwnRemote,
	normaliseSpecifier,
	SUFFIX,
	toSvelte,
	toVirtual,
} from './utils.js';

export type { RemoteBlock } from './utils.js';
export { exportNames, extractRemoteBlock, SUFFIX, toSvelte, toVirtual } from './utils.js';

/**
 * Vite plugin enabling inline SvelteKit remote functions.
 *
 * Add it **before** `sveltekit()` in `vite.config.ts`:
 *
 * ```ts
 * import { sveltekit } from '@sveltejs/kit/vite';
 * import { inlineRemote } from 'sveltekit-inline-remote-functions';
 *
 * export default defineConfig({ plugins: [inlineRemote(), sveltekit()] });
 * ```
 */
export function inlineRemote(): Plugin {
	let root = process.cwd();

	return {
		name: 'inline-remote',
		enforce: 'pre',

		configResolved(config) {
			root = config.root;
		},

		resolveId(source, importer) {
			const id = normaliseSpecifier(source);
			if (!id) return;
			const candidates = path.isAbsolute(id)
				? [id, path.join(root, id)] // real fs path, or root-relative URL from the browser
				: [path.resolve(path.dirname(importer ? cleanId(importer) : path.join(root, 'index')), id)];
			// return a real-looking absolute path so Kit's remote-file regex and path.relative hashing work
			return candidates.find((c) => fs.existsSync(toSvelte(c))) ?? undefined;
		},

		load(rawId) {
			const id = cleanId(rawId);
			if (!id.endsWith(SUFFIX)) return;
			const svelteFile = toSvelte(id);
			if (!fs.existsSync(svelteFile)) return;
			this.addWatchFile(svelteFile);
			const block = extractRemoteBlock(fs.readFileSync(svelteFile, 'utf8'));
			if (!block) {
				this.error(`${path.relative(root, svelteFile)} has no <script remote> block`);
			}
			return { code: block.code, moduleType: 'ts' };
		},

		transform(code, id) {
			// only the component itself; ignore sub-requests like `X.svelte?svelte&type=style&lang.css`
			if (!id.endsWith('.svelte')) return;
			const block = extractRemoteBlock(code);
			if (!block) return;

			const s = new MagicString(code);
			s.remove(block.index, block.index + block.full.length);
			const stripped = code.slice(0, block.index) + code.slice(block.index + block.full.length);

			const virt = path.basename(toVirtual(id));
			// skip injection if the component already imports from its own remote block (e.g. for editor types)
			const names = importsOwnRemote(stripped, virt) ? [] : exportNames(block.code);
			const imp = names.length ? `import { ${names.join(', ')} } from './${virt}';\n` : '';

			if (imp) {
				// inject into the instance <script> (not module/remote); create one if absent
				const inst = findInstanceScript(stripped);
				if (inst) {
					// map the offset in `stripped` back to the original source
					const end = inst.index + inst.length;
					const pos = inst.index >= block.index ? end + block.full.length : end;
					s.appendLeft(pos, `\n${imp}`);
				} else {
					s.prepend(`<script lang="ts">\n${imp}</script>\n`);
				}
			}

			return { code: s.toString(), map: s.generateMap({ hires: true, source: id, includeContent: true }) };
		},

		hotUpdate({ file, modules }) {
			if (!file.endsWith('.svelte')) return;
			const mod = this.environment.moduleGraph.getModuleById(toVirtual(file));
			if (!mod) return;
			this.environment.moduleGraph.invalidateModule(mod);
			return [...modules, mod];
		},
	};
}

export default inlineRemote;
