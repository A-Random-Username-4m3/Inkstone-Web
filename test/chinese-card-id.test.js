import test from 'node:test';
import assert from 'node:assert/strict';

import {
	migrateChineseStudyIds,
	remapReviewLogCardIds,
	stableChineseStudyId
} from '../js/chinese-card-id.js';

function row(simplified, traditional, numbered, pinyin, definition = '') {
	return { simplified, traditional, numbered, pinyin, definition };
}

test('Chinese study IDs distinguish script and reading collisions', () => {
	const howMany = row('几', '幾', 'ji3', 'jǐ', 'how many');
	const table = row('几', '几', 'ji1', 'jī', 'table');
	const inside = row('里', '裡', 'li3', 'lǐ', 'inside');
	const village = row('里', '里', 'li3', 'lǐ', 'village');

	assert.notEqual(stableChineseStudyId(howMany), stableChineseStudyId(table));
	assert.notEqual(stableChineseStudyId(inside), stableChineseStudyId(village));
	assert.equal(stableChineseStudyId(howMany), stableChineseStudyId({ ...howMany }));
});

test('legacy collapsed progress is cloned into separated variants without duplicating log mapping', () => {
	const howMany = row('几', '幾', 'ji3', 'jǐ', 'how many');
	const table = row('几', '几', 'ji1', 'jī', 'table');
	const howManyId = stableChineseStudyId(howMany);
	const tableId = stableChineseStudyId(table);
	const state = {
		enabledLists: { nhsk1: true, radicals: false },
		vocabulary: {
			几: {
				word: '几',
				lists: ['nhsk1', 'radicals'],
				attempts: 8,
				successes: 6,
				fsrs: { state: 'review', stability: 12, difficulty: 4 }
			}
		},
		blacklist: { 几: { word: '几', definition: 'legacy' } },
		session: {
			stageQueue: [{ word: '几', deck: 'reviews', stage: 2 }],
			currentStageCard: { word: '几', deck: 'reviews', stage: 2 },
			lastWord: '几'
		},
		history: [{ ts: 1, word: '几', result: 0 }]
	};
	const lists = {
		nhsk1: { rows: [howMany] },
		radicals: { rows: [table] }
	};

	const { primaryMigrations, variantMigrations } = migrateChineseStudyIds(
		state,
		lists
	);

	assert.deepEqual(new Set(variantMigrations.get('几')), new Set([howManyId, tableId]));
	assert.equal(primaryMigrations.get('几'), howManyId);
	assert.equal(state.vocabulary[howManyId].attempts, 8);
	assert.equal(state.vocabulary[tableId].attempts, 8);
	assert.deepEqual(state.vocabulary[howManyId].lists, ['nhsk1']);
	assert.deepEqual(state.vocabulary[tableId].lists, ['radicals']);
	assert.equal(state.vocabulary[howManyId].traditional, '幾');
	assert.equal(state.vocabulary[tableId].traditional, '几');
	assert.ok(state.blacklist[howManyId]);
	assert.ok(state.blacklist[tableId]);
	assert.deepEqual(state.session.stageQueue, []);
	assert.equal(state.session.currentStageCard, null);
	assert.equal(state.session.lastWord, howManyId);
	assert.equal(state.history[0].word, howManyId);

	const migratedLogs = remapReviewLogCardIds([
		{ card_id: '几', review_time: 1, review_rating: 3, review_state: 2 }
	], primaryMigrations);
	assert.equal(migratedLogs[0].card_id, howManyId);
	assert.equal(migratedLogs.length, 1);
});
