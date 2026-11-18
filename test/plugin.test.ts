import { describe, expect, mock, test } from 'bun:test';
import path from 'node:path';
import { compile } from 'svelte/compiler';
import type { Plugin } from 'vite';
import { inlineRemote } from '../src/index.ts';

const fixtureRoot = path.join(import.meta.dir, 'fixtures/basic');
const counter = path.join(fixtureRoot, 'src/Counter.svelte');
const counterVirtual = path.join(fixtureRoot, 'src/Counter.inline.remote.ts');

// biome-ignore lint/suspicious/noExplicitAny: hooks are invoked with a minimal fake plugin context
type AnyFn = (this: any, ...args: any[]) => any;

/** Create a plugin with `configResolved` already applied. */
function setup(root = fixtureRoot) {
	const plugin = inlineRemote();
	const hook = (name: keyof Plugin): AnyFn => {
		const h = plugin[name] as AnyFn | { handler: AnyFn };
		return typeof h === 'function' ? h : h.handler;
	};
	hook('configResolved').call({}, { root });
	const ctx = {
		addWatchFile: mock(() => {}),
		error: mock((msg: string) => {
			throw new Error(msg);
		}),
	};
	return { plugin, hook, ctx };
}

describe('plugin metadata', () => {
	test('runs before other plugins', () => {
		const { plugin } = setup();
		expect(plugin.name).toBe('inline-remote');
		expect(plugin.enforce).toBe('pre');
	});
});

describe('resolveId', () => {
	test('resolves relative specifiers next to an existing component', () => {
		const { hook } = setup();
		for (const spec of ['./Counter.inline.remote', './Counter.inline.remote.js', './Counter.inline.remote.ts']) {
			expect(hook('resolveId').call({}, spec, path.join(fixtureRoot, 'src/main.ts'))).toBe(counterVirtual);
		}
	});

	test('resolves absolute fs paths and root-relative URLs', () => {
		const { hook } = setup();
		expect(hook('resolveId').call({}, counterVirtual, undefined)).toBe(counterVirtual);
		expect(hook('resolveId').call({}, '/src/Counter.inline.remote.ts', undefined)).toBe(counterVirtual);
	});

	test('ignores specifiers whose component does not exist', () => {
		const { hook } = setup();
		expect(hook('resolveId').call({}, './Missing.inline.remote', counter)).toBeUndefined();
	});

	test('ignores unrelated specifiers', () => {
		const { hook } = setup();
		expect(hook('resolveId').call({}, './Counter.svelte', counter)).toBeUndefined();
		expect(hook('resolveId').call({}, 'svelte', counter)).toBeUndefined();
	});
});

describe('load', () => {
	test('returns the remote block as a TS module and watches the component', () => {
		const { hook, ctx } = setup();
		const result = hook('load').call(ctx, counterVirtual);
		expect(result.moduleType).toBe('ts');
		expect(result.code).toContain('export const getCount');
		expect(result.code).not.toContain('<script');
		expect(ctx.addWatchFile).toHaveBeenCalledWith(counter);
	});

	test('strips query strings', () => {
		const { hook, ctx } = setup();
		expect(hook('load').call(ctx, `${counterVirtual}?import`).code).toContain('getCount');
	});

	test('ignores other ids', () => {
		const { hook, ctx } = setup();
		expect(hook('load').call(ctx, counter)).toBeUndefined();
	});

	test('errors when the component has no <script remote> block', () => {
		const { hook, ctx } = setup();
		const plain = path.join(fixtureRoot, 'src/Plain.inline.remote.ts');
		expect(() => hook('load').call(ctx, plain)).toThrow('has no <script remote> block');
	});
});

describe('transform', () => {
	const id = '/proj/src/Foo.svelte';

	test('removes the remote block and imports its exports into the instance script', () => {
		const { hook } = setup();
		const src = [
			'<script remote lang="ts">export const getX = query(() => 1);</script>',
			'<script lang="ts">let a = 1;</script>',
			'<p>{a}</p>',
		].join('\n');
		const { code, map } = hook('transform').call({}, src, id);
		expect(code).not.toContain('<script remote');
		expect(code).toContain(`<script lang="ts">\nimport { getX } from './Foo.inline.remote.ts';\nlet a = 1;`);
		expect(map.mappings).toBeTruthy();
	});

	test('injects into an instance script that comes before the remote block', () => {
		const { hook } = setup();
		const src = '<script>let a = 1;</script>\n<script remote>export const q = 1;</script>';
		const { code } = hook('transform').call({}, src, id);
		expect(code).toBe(`<script>\nimport { q } from './Foo.inline.remote.ts';\nlet a = 1;</script>\n`);
	});

	test('creates an instance script when none exists', () => {
		const { hook } = setup();
		const src = '<script module>export const m = 1;</script>\n<script remote>export const q = 1;</script>\n<p/>';
		const { code } = hook('transform').call({}, src, id);
		expect(code).toStartWith(`<script lang="ts">\nimport { q } from './Foo.inline.remote.ts';\n</script>\n`);
		expect(code).toContain('<script module>export const m = 1;</script>');
	});

	test('does not inject when the component already imports its remote module', () => {
		const { hook } = setup();
		const src = [
			'<script remote>export const q = 1;</script>',
			`<script>import { q } from './Foo.inline.remote';</script>`,
		].join('\n');
		const { code } = hook('transform').call({}, src, id);
		expect(code.match(/import/g)?.length).toBe(1);
	});

	test('leaves components without a remote block untouched', () => {
		const { hook } = setup();
		expect(hook('transform').call({}, '<script>let a;</script>', id)).toBeUndefined();
	});

	test('ignores non-svelte ids and svelte sub-requests', () => {
		const { hook } = setup();
		const src = '<script remote>export const q = 1;</script>';
		expect(hook('transform').call({}, src, '/proj/a.ts')).toBeUndefined();
		expect(hook('transform').call({}, src, `${id}?svelte&type=style&lang.css`)).toBeUndefined();
	});

	test('output compiles with the Svelte compiler', async () => {
		const { hook } = setup();
		const src = await Bun.file(counter).text();
		const { code } = hook('transform').call({}, src, counter);
		const out = compile(code, { filename: counter, generate: 'client' });
		expect(out.js.code).toContain('./Counter.inline.remote.ts');
	});
});

describe('hotUpdate', () => {
	test('invalidates the virtual module when its component changes', () => {
		const { hook } = setup();
		const virtualMod = { id: counterVirtual };
		const componentMod = { id: counter };
		const moduleGraph = {
			getModuleById: mock((mid: string) => (mid === counterVirtual ? virtualMod : undefined)),
			invalidateModule: mock(() => {}),
		};
		const result = hook('hotUpdate').call({ environment: { moduleGraph } }, { file: counter, modules: [componentMod] });
		expect(moduleGraph.invalidateModule).toHaveBeenCalledWith(virtualMod);
		expect(result).toEqual([componentMod, virtualMod]);
	});

	test('does nothing for other files or components without a loaded remote module', () => {
		const { hook } = setup();
		const moduleGraph = { getModuleById: () => undefined, invalidateModule: mock(() => {}) };
		const ctx = { environment: { moduleGraph } };
		expect(hook('hotUpdate').call(ctx, { file: '/a/b.ts', modules: [] })).toBeUndefined();
		expect(hook('hotUpdate').call(ctx, { file: '/a/B.svelte', modules: [] })).toBeUndefined();
		expect(moduleGraph.invalidateModule).not.toHaveBeenCalled();
	});
});
