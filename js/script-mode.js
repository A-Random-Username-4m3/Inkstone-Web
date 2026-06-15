const SCRIPT_MODE_SIMPLIFIED = 'simplified';
const SCRIPT_MODE_TRADITIONAL = 'traditional';

export function normalizeScriptMode(value) {
	return value === SCRIPT_MODE_TRADITIONAL
		? SCRIPT_MODE_TRADITIONAL
		: SCRIPT_MODE_SIMPLIFIED;
}

function getScriptMode(settings = {}) {
	return normalizeScriptMode(settings?.scriptMode);
}

export function textValue(value) {
	return String(value || '').trim();
}

function rowSimplified(row) {
	return textValue(row?.simplified);
}

function rowTraditional(row) {
	return textValue(row?.traditional);
}

export function rowCanonicalWord(row) {
	return rowSimplified(row) || rowTraditional(row);
}

export function rowScriptWord(row, settingsOrMode = SCRIPT_MODE_SIMPLIFIED) {
	const mode = typeof settingsOrMode === 'string'
		? normalizeScriptMode(settingsOrMode)
		: getScriptMode(settingsOrMode);
	const simplified = rowSimplified(row);
	const traditional = rowTraditional(row);
	return mode === SCRIPT_MODE_TRADITIONAL
		? traditional || simplified
		: simplified || traditional;
}

export function rowWords(row) {
	const words = [];
	const simplified = rowSimplified(row);
	const traditional = rowTraditional(row);
	if (simplified) words.push(simplified);
	if (traditional && traditional !== simplified) words.push(traditional);
	return words;
}
