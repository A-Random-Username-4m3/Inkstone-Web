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

test('known Chinese list data corrections and split simplification mergers are present', async () => {
	const nhsk1 = parseRows(await readFile(new URL('nhsk1.tsv', LIST_DIRECTORY), 'utf8'));
	const nhsk3 = parseRows(await readFile(new URL('nhsk3.tsv', LIST_DIRECTORY), 'utf8'));
	const nhsk4 = parseRows(await readFile(new URL('nhsk4.tsv', LIST_DIRECTORY), 'utf8'));
	const nhsk5 = parseRows(await readFile(new URL('nhsk5.tsv', LIST_DIRECTORY), 'utf8'));
	const radicals = parseRows(await readFile(new URL('100cr.tsv', LIST_DIRECTORY), 'utf8'));

	assert.ok(nhsk1.some((row) => row[0] === '哪' && row[3] === 'nǎ'));
	assert.ok(radicals.some((row) => row[0] === '舟' && row[2] === 'zhou1' && row[3] === 'zhōu'));
	assert.ok(radicals.some((row) => row[0] === '干' && row[1] === '干' && row[4] === 'shield; to concern'));
	assert.ok(nhsk3.some((row) => row[0] === '发' && row[1] === '發' && row[2] === 'fa1'));
	assert.ok(nhsk3.some((row) => row[0] === '发' && row[1] === '髮' && row[2] === 'fa4'));
	assert.ok(nhsk3.some((row) => row[0] === '只' && row[1] === '只' && row[2] === 'zhi3'));
	assert.ok(nhsk3.some((row) => row[0] === '只' && row[1] === '隻' && row[2] === 'zhi1'));
	assert.ok(nhsk4.some((row) => row[0] === '干' && row[1] === '幹' && row[2] === 'gan4'));
	assert.ok(nhsk4.some((row) => row[0] === '干' && row[1] === '乾' && row[2] === 'gan1'));
	assert.ok(nhsk4.some((row) => row[0] === '台' && row[1] === '臺'));
	assert.ok(nhsk4.some((row) => row[0] === '台' && row[1] === '檯'));
	assert.ok(nhsk4.some((row) => row[0] === '台' && row[1] === '颱'));
	assert.ok(nhsk5.some((row) => row[0] === '系' && row[1] === '系'));
	assert.ok(nhsk5.some((row) => row[0] === '系' && row[1] === '係'));
	assert.ok(nhsk5.some((row) => row[0] === '系' && row[1] === '繫'));
});
