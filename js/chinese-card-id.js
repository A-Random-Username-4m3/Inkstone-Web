'use strict';

function textValue(value) {
	return String(value || '').trim().normalize('NFKC');
}

function normalizedReading(row) {
	const numbered = textValue(row?.numbered)
		.toLowerCase()
		.replace(/\s+/g, '');
	if (numbered) return numbered;
	return textValue(row?.pinyin)
		.toLowerCase()
		.replace(/\s+/g, '');
}

export function legacyRowWord(row) {
	return textValue(row?.simplified) || textValue(row?.traditional);
}

export function stableChineseStudyId(row) {
	const simplified = textValue(row?.simplified);
	const traditional = textValue(row?.traditional) || simplified;
	const reading = normalizedReading(row);
	if (!simplified && !traditional) return '';
	return [
		'zh',
		encodeURIComponent(simplified || traditional),
		encodeURIComponent(traditional || simplified),
		encodeURIComponent(reading)
	].join(':');
}

export function isStableChineseStudyId(value) {
	return /^zh:[^:]*:[^:]*:[^:]*$/.test(String(value || ''));
}

function mergeUniqueStrings(left, right) {
	return [...new Set([
		...(Array.isArray(left) ? left : []),
		...(Array.isArray(right) ? right : [])
	].filter((value) => typeof value === 'string' && value))];
}

function rowSnapshot(row) {
	if (!row || typeof row !== 'object') return {};
	return {
		simplified: textValue(row.simplified),
		traditional: textValue(row.traditional),
		numbered: textValue(row.numbered),
		pinyin: textValue(row.pinyin),
		definition: textValue(row.definition)
	};
}

function mergeVocabularyEntries(existing, incoming, word, lists = null, row = null) {
	const cloned = {
		...incoming,
		...rowSnapshot(row),
		word,
		lists: lists == null
			? mergeUniqueStrings(existing?.lists, incoming?.lists)
			: [...new Set(lists)]
	};
	if (!existing) return cloned;
	const existingAttempts = Number(existing.attempts || 0);
	const incomingAttempts = Number(incoming.attempts || 0);
	const preferred = incomingAttempts > existingAttempts ? incoming : existing;
	const fallback = preferred === existing ? incoming : existing;
	return {
		...fallback,
		...preferred,
		...rowSnapshot(row),
		word,
		lists: lists == null
			? mergeUniqueStrings(existing.lists, incoming.lists)
			: [...new Set(lists)]
	};
}

function buildLegacyCandidateIndex(lists) {
	const index = new Map();
	for (const [listId, list] of Object.entries(lists || {})) {
		for (const row of list?.rows || []) {
			const studyId = stableChineseStudyId(row);
			if (!studyId) continue;
			const keys = new Set([
				legacyRowWord(row),
				textValue(row?.simplified),
				textValue(row?.traditional)
			].filter(Boolean));
			for (const key of keys) {
				if (!index.has(key)) index.set(key, []);
				index.get(key).push({ listId, row, studyId });
			}
		}
	}
	return index;
}

function candidateRowsForLegacyWord(candidateIndex, legacyWord, listIds = []) {
	const items = candidateIndex.get(legacyWord) || [];
	const requestedIds = new Set(Array.isArray(listIds) ? listIds : []);
	const preferred = items.filter((item) => requestedIds.has(item.listId));
	const fallback = items.filter((item) => !requestedIds.has(item.listId));
	return preferred.length ? preferred.concat(fallback) : fallback;
}


function uniqueCandidates(items) {
	const byId = new Map();
	for (const item of items) {
		if (!byId.has(item.studyId)) {
			byId.set(item.studyId, { ...item, listIds: [] });
		}
		const record = byId.get(item.studyId);
		if (!record.listIds.includes(item.listId)) record.listIds.push(item.listId);
	}
	return [...byId.values()];
}

function choosePrimaryCandidate(candidates, state, entry) {
	if (!candidates.length) return null;
	const memberships = Array.isArray(entry?.lists) ? entry.lists : [];
	for (const listId of memberships) {
		if (!state?.enabledLists?.[listId]) continue;
		const found = candidates.find((candidate) => candidate.listIds.includes(listId));
		if (found) return found;
	}
	for (const listId of memberships) {
		const found = candidates.find((candidate) => candidate.listIds.includes(listId));
		if (found) return found;
	}
	return candidates[0];
}

function remapPrimaryWord(value, primaryMigrations) {
	const key = String(value || '');
	return primaryMigrations.get(key) || key;
}

export function migrateChineseStudyIds(state, lists) {
	const primaryMigrations = new Map();
	const variantMigrations = new Map();
	if (!state || typeof state !== 'object') {
		return { primaryMigrations, variantMigrations };
	}

	const vocabulary = state.vocabulary && typeof state.vocabulary === 'object'
		? state.vocabulary
		: {};
	const candidateIndex = buildLegacyCandidateIndex(lists);
	const migratedVocabulary = {};

	for (const [key, entryValue] of Object.entries(vocabulary)) {
		if (!entryValue || typeof entryValue !== 'object' || Array.isArray(entryValue)) {
			migratedVocabulary[key] = entryValue;
			continue;
		}
		const entry = { ...entryValue };
		const currentWord = String(entry.word || key).trim() || key;
		if (isStableChineseStudyId(currentWord)) {
			migratedVocabulary[currentWord] = mergeVocabularyEntries(
				migratedVocabulary[currentWord], entry, currentWord
			);
			continue;
		}

		const candidates = uniqueCandidates(
			candidateRowsForLegacyWord(candidateIndex, currentWord, entry.lists)
		);
		if (!candidates.length) {
			migratedVocabulary[currentWord] = mergeVocabularyEntries(
				migratedVocabulary[currentWord], entry, currentWord
			);
			continue;
		}

		const targetIds = candidates.map((candidate) => candidate.studyId);
		variantMigrations.set(currentWord, targetIds);
		if (key !== currentWord) variantMigrations.set(key, targetIds);
		const primary = choosePrimaryCandidate(candidates, state, entry) || candidates[0];
		primaryMigrations.set(currentWord, primary.studyId);
		if (key !== currentWord) primaryMigrations.set(key, primary.studyId);

		for (const candidate of candidates) {
			const relevantLists = candidate.listIds.filter((listId) =>
				!Array.isArray(entry.lists) || !entry.lists.length || entry.lists.includes(listId)
			);
			migratedVocabulary[candidate.studyId] = mergeVocabularyEntries(
				migratedVocabulary[candidate.studyId],
				entry,
				candidate.studyId,
				relevantLists.length ? relevantLists : candidate.listIds,
				candidate.row
			);
		}
	}
	state.vocabulary = migratedVocabulary;

	if (state.blacklist && typeof state.blacklist === 'object' && !Array.isArray(state.blacklist)) {
		const migratedBlacklist = {};
		for (const [key, value] of Object.entries(state.blacklist)) {
			const sourceWord = String(value?.word || key);
			const targets = variantMigrations.get(sourceWord) || variantMigrations.get(key);
			if (targets?.length) {
				for (const target of targets) {
					migratedBlacklist[target] = value && typeof value === 'object'
						? { ...value, word: target }
						: { word: target };
				}
				continue;
			}
			const migrated = remapPrimaryWord(sourceWord, primaryMigrations);
			migratedBlacklist[migrated] = value && typeof value === 'object'
				? { ...value, word: migrated }
				: { word: migrated };
		}
		state.blacklist = migratedBlacklist;
	}

	const session = state.session;
	if (session && typeof session === 'object') {
		if (Array.isArray(session.stageQueue)) {
			session.stageQueue = session.stageQueue
				.map((item) => {
					if (!item || typeof item !== 'object') return item;
					const oldWord = String(item.word || '');
					if ((variantMigrations.get(oldWord) || []).length > 1) return null;
					return { ...item, word: remapPrimaryWord(oldWord, primaryMigrations) };
				})
				.filter(Boolean);
		}
		if (session.currentStageCard && typeof session.currentStageCard === 'object') {
			const oldWord = String(session.currentStageCard.word || '');
			if ((variantMigrations.get(oldWord) || []).length > 1) {
				session.currentStageCard = null;
			} else {
				session.currentStageCard = {
					...session.currentStageCard,
					word: remapPrimaryWord(oldWord, primaryMigrations)
				};
			}
		}
		if (session.lastWord) {
			session.lastWord = remapPrimaryWord(session.lastWord, primaryMigrations);
		}
	}

	if (Array.isArray(state.history)) {
		state.history = state.history.map((item) =>
			item && typeof item === 'object' && item.word
				? { ...item, word: remapPrimaryWord(item.word, primaryMigrations) }
				: item
		);
	}

	return { primaryMigrations, variantMigrations };
}

export function remapReviewLogCardIds(logs, migrations) {
	if (!Array.isArray(logs) || !migrations?.size) return Array.isArray(logs) ? logs : [];
	return logs.map((log) => {
		if (!log || typeof log !== 'object') return log;
		const cardId = String(log.card_id || '');
		const migrated = migrations.get(cardId);
		return migrated ? { ...log, card_id: migrated } : log;
	});
}
