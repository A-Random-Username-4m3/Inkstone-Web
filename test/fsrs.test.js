import test from 'node:test';
import assert from 'node:assert/strict';

import {
	DEFAULT_SCHEDULING,
	applyFsrsResult,
	configureFsrs,
	fsrsIntervalSeconds
} from '../js/fsrs.js';

const ONE_DAY = 24 * 60 * 60;

function configure(settings = {}) {
	configureFsrs({
		getSettings: () => ({
			...DEFAULT_SCHEDULING,
			...settings
		}),
		now: () => 1_000_000,
		learningStepInterval: () => 10 * 60,
		relearningStepInterval: () => 10 * 60
	});
}

test('same-day Hard review does not reduce stability', () => {
	configure();
	const timestamp = 1_000_000;
	const entry = {
		attempts: 1,
		fsrs: {
			state: 'review',
			difficulty: 5,
			stability: 1,
			lastReview: timestamp,
			reps: 1,
			lapses: 0
		}
	};

	const result = applyFsrsResult(entry, 2, timestamp);

	assert.ok(result.stability >= 1);
	assert.equal(entry.fsrs.stability, result.stability);
});

test('initial stability is clamped to the FSRS 0.1-day minimum', () => {
	const parameters = DEFAULT_SCHEDULING.fsrsParameters
		.split(',')
		.map((value) => Number(value.trim()));
	parameters[0] = 0.01;
	configure({ fsrsParameters: parameters.join(', ') });

	const result = applyFsrsResult({ attempts: 0 }, 3, 1_000_000);

	assert.equal(result.rating, 'again');
	assert.equal(result.stability, 0.1);
});

test('fuzzing cannot move a future successful interval behind elapsed days', () => {
	configure();
	const originalRandom = Math.random;
	Math.random = () => 0;
	try {
		assert.equal(fsrsIntervalSeconds(10, true, 9), 10 * ONE_DAY);
	} finally {
		Math.random = originalRandom;
	}
});
