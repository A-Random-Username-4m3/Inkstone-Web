import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';

import {
	createParentLock,
	isValidParentLockPin,
	isValidParentLockRecord,
	verifyParentLock
} from '../js/parent-lock.js';

if (!globalThis.crypto) globalThis.crypto = webcrypto;

test('parent lock validates 4 to 8 digit PINs only', () => {
	assert.equal(isValidParentLockPin('1234'), true);
	assert.equal(isValidParentLockPin('12345678'), true);
	assert.equal(isValidParentLockPin('123'), false);
	assert.equal(isValidParentLockPin('123456789'), false);
	assert.equal(isValidParentLockPin('12a4'), false);
});

test('parent lock stores a salted PBKDF2 record and verifies the PIN', async () => {
	const first = await createParentLock('2468');
	const second = await createParentLock('2468');

	assert.equal(isValidParentLockRecord(first), true);
	assert.equal(first.hash.length, 64);
	assert.notEqual(first.salt, second.salt);
	assert.notEqual(first.hash, second.hash);
	assert.equal(await verifyParentLock('2468', first), true);
	assert.equal(await verifyParentLock('1357', first), false);
});
