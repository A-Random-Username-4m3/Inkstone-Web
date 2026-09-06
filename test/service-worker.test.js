import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('Chinese service worker only deletes Chinese caches and has a generated data revision marker', async () => {
	const source = await readFile(new URL('../sw.js', import.meta.url), 'utf8');
	assert.match(source, /const CACHE_PREFIX = 'inkstone-static-';/);
	assert.match(source, /key\.startsWith\(CACHE_PREFIX\) && key !== CACHE_NAME/);
	assert.match(source, /INKSTONE_DATA_REVISION/);
});
