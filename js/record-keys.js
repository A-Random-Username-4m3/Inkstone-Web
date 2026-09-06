'use strict';

const RESERVED_RECORD_KEYS = new Set([
	'__proto__',
	'prototype',
	'constructor',
	...Object.getOwnPropertyNames(Object.prototype)
]);

export function isSafeRecordKey(value) {
	const key = String(value || '');
	return !!key && !RESERVED_RECORD_KEYS.has(key);
}

export function assertSafeRecordKey(value, path = 'key') {
	const key = String(value || '');
	if (!isSafeRecordKey(key)) {
		throw new Error(`${path} uses a reserved object key.`);
	}
	return key;
}
