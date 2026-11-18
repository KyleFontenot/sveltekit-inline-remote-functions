// imports the inline remote module the same three ways SvelteKit / users might
import { getCount } from './Counter.inline.remote';
import { bump } from './Counter.inline.remote.js';
import * as ts from './Counter.inline.remote.ts';

export const result = { count: getCount(), bumped: bump, same: ts.getCount === getCount };
