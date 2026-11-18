import { describe, expect, test } from 'bun:test';
import {
	exportNames,
	extractRemoteBlock,
	findInstanceScript,
	importsOwnRemote,
	normaliseSpecifier,
	toSvelte,
	toVirtual,
} from '../src/utils.ts';

describe('path mapping', () => {
	test('toVirtual / toSvelte round-trip', () => {
		expect(toVirtual('/a/b/Foo.svelte')).toBe('/a/b/Foo.inline.remote.ts');
		expect(toSvelte('/a/b/Foo.inline.remote.ts')).toBe('/a/b/Foo.svelte');
		expect(toSvelte(toVirtual('/x/+page.svelte'))).toBe('/x/+page.svelte');
	});

	test('virtual id never contains ".svelte."', () => {
		expect(toVirtual('/a/Foo.svelte')).not.toContain('.svelte.');
	});

	test('normaliseSpecifier accepts bare, .js and .ts forms', () => {
		expect(normaliseSpecifier('./Foo.inline.remote')).toBe('./Foo.inline.remote.ts');
		expect(normaliseSpecifier('./Foo.inline.remote.js')).toBe('./Foo.inline.remote.ts');
		expect(normaliseSpecifier('./Foo.inline.remote.ts')).toBe('./Foo.inline.remote.ts');
		expect(normaliseSpecifier('./Foo.inline.remote.ts?import')).toBe('./Foo.inline.remote.ts');
	});

	test('normaliseSpecifier rejects other modules', () => {
		expect(normaliseSpecifier('./Foo.remote.ts')).toBeNull();
		expect(normaliseSpecifier('./Foo.svelte')).toBeNull();
		expect(normaliseSpecifier('svelte')).toBeNull();
	});
});

describe('extractRemoteBlock', () => {
	test('finds a <script remote> block', () => {
		const src = '<script>let a = 1;</script>\n<script remote lang="ts">export const q = 1;</script>\n<p/>';
		const block = extractRemoteBlock(src);
		expect(block).not.toBeNull();
		expect(block?.code).toBe('export const q = 1;');
		expect(block?.attrs).toBe(' remote lang="ts"');
		expect(src.slice(block?.index)).toStartWith('<script remote');
	});

	test('attribute order does not matter', () => {
		expect(extractRemoteBlock('<script lang="ts" remote>x</script>')?.code).toBe('x');
	});

	test('returns null without a remote block', () => {
		expect(extractRemoteBlock('<script lang="ts">let a = 1;</script>')).toBeNull();
	});

	test('does not match attributes that merely contain "remote"', () => {
		expect(extractRemoteBlock('<script data-remote>x</script>')).toBeNull();
		expect(extractRemoteBlock('<script remotely>x</script>')).toBeNull();
	});
});

describe('findInstanceScript', () => {
	test('skips module scripts', () => {
		const src = '<script module>a</script><script lang="ts">b</script>';
		expect(findInstanceScript(src)?.index).toBe(src.indexOf('<script lang'));
	});

	test('skips legacy context="module" scripts', () => {
		const src = '<script context="module">a</script><script>b</script>';
		expect(findInstanceScript(src)?.index).toBe(src.lastIndexOf('<script>'));
	});

	test('returns null when there is no instance script', () => {
		expect(findInstanceScript('<script module>a</script><p/>')).toBeNull();
	});
});

describe('exportNames', () => {
	test('collects declaration exports', () => {
		const code = `
			export const a = query(() => 1);
			export let b = 2;
			export var c = 3;
			export function d() {}
			export async function e() {}
			export function* f() {}
		`;
		expect(exportNames(code)).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
	});

	test('collects export lists with aliases', () => {
		expect(exportNames('const x = 1, y = 2; export { x, y as z };')).toEqual(['x', 'z']);
	});

	test('ignores type exports, re-exports and comments', () => {
		const code = `
			export type T = string;
			export interface I {}
			export { type T2 };
			export { foo } from './other';
			// export const commented = 1;
			/* export const blocked = 1; */
			export const real = 1;
		`;
		expect(exportNames(code)).toEqual(['real']);
	});

	test('deduplicates', () => {
		expect(exportNames('export const a = 1; export { a };')).toEqual(['a']);
	});
});

describe('importsOwnRemote', () => {
	test('detects an existing import in any extension form', () => {
		for (const spec of ['./Foo.inline.remote', './Foo.inline.remote.js', './Foo.inline.remote.ts']) {
			expect(importsOwnRemote(`import { a } from '${spec}';`, 'Foo.inline.remote.ts')).toBe(true);
		}
	});

	test('does not match other components', () => {
		expect(importsOwnRemote(`import { a } from './Bar.inline.remote';`, 'Foo.inline.remote.ts')).toBe(false);
	});

	test('escapes regex characters in the file name', () => {
		expect(importsOwnRemote(`import { a } from './+page.inline.remote';`, '+page.inline.remote.ts')).toBe(true);
	});
});
