import { expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { build, type Rollup } from 'vite';
import { inlineRemote } from '../src/index.ts';

const root = path.join(import.meta.dir, 'fixtures/basic');

test('a real Vite build resolves and loads inline remote modules', async () => {
	const result = (await build({
		root,
		logLevel: 'silent',
		configFile: false,
		plugins: [inlineRemote()],
		build: {
			write: false,
			minify: false,
			lib: { entry: path.join(root, 'src/main.ts'), formats: ['es'], fileName: 'main' },
		},
	})) as Rollup.RollupOutput[] | Rollup.RollupOutput;

	const output = (Array.isArray(result) ? result[0] : result)?.output ?? [];
	const chunk = output.find((o) => o.type === 'chunk' && o.isEntry) as Rollup.OutputChunk | undefined;
	expect(chunk).toBeDefined();

	expect(chunk?.code).not.toContain('<script');

	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inline-remote-'));
	const file = path.join(dir, 'main.mjs');
	fs.writeFileSync(file, chunk?.code ?? '');
	const mod = await import(file);
	fs.rmSync(dir, { recursive: true, force: true });

	expect(mod.result.count).toBe(42);
	expect(await mod.result.bumped(8)).toBe(50);
	expect(mod.result.same).toBe(true);
});
