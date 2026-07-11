import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

const DATA_DIRECTORY = new URL('../data/', import.meta.url);
const LIST_DIRECTORY = new URL('../data/lists/', import.meta.url);

function parseRows(text) {
	return text
		.replace(/^\ufeff/, '')
		.split(/\r?\n/)
		.filter((line) => line.trim())
		.map((line) => line.split('\t'));
}

test('every built-in list character exists in hanzi data for both scripts', async () => {
	const hanzi = JSON.parse(
		await readFile(new URL('hanzi.json', DATA_DIRECTORY), 'utf8')
	);
	const files = (await readdir(LIST_DIRECTORY))
		.filter((name) => name.endsWith('.tsv'));
	const missing = [];

	for (const file of files) {
		const rows = parseRows(
			await readFile(new URL(file, LIST_DIRECTORY), 'utf8')
		);
		rows.forEach((row, rowIndex) => {
			for (const [column, script] of [[0, 'simplified'], [1, 'traditional']]) {
				for (const character of Array.from(row[column] || '')) {
					if (!hanzi[character]) {
						missing.push(
							`${file}:${rowIndex + 1} ${script} ${row[column]} (${character})`
						);
					}
				}
			}
		});
	}

	assert.deepEqual(missing, []);
});
