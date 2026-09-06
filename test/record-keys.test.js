import test from 'node:test';
import assert from 'node:assert/strict';

import { isSafeRecordKey } from '../js/record-keys.js';

test('reserved JavaScript object keys cannot be used as custom record IDs', () => {
	for (const key of ['__proto__', 'prototype', 'constructor', 'toString']) {
		assert.equal(isSafeRecordKey(key), false, key);
	}
	assert.equal(isSafeRecordKey('my-custom-list'), true);
});
