import { rowCanonicalWord, rowScriptWord, rowWords } from './script-mode.js';
import { legacyRowWord, isStableChineseStudyId } from './chinese-card-id.js';
export function createVocabulary(ctx) {
	const state = ctx.liveState();
	const lists = ctx.liveLists();
	const hanzi = ctx.liveHanzi();
	const ensureFsrsState = (...args) => ctx.ensureFsrsState(...args);
	const saveState = (...args) => ctx.saveState(...args);
	const listRowIndexCache = new WeakMap();


	function getListRowIndex(list) {
		const rows = Array.isArray(list?.rows) ? list.rows : [];
		const cached = list && typeof list === 'object'
			? listRowIndexCache.get(list)
			: null;
		if (
			cached &&
			cached.rows === rows &&
			cached.length === rows.length
		) return cached.index;

		const index = new Map();
		for (const row of rows) {
			const keys = new Set([rowCanonicalWord(row), ...rowWords(row)]);
			for (const key of keys) {
				if (key && !index.has(key)) index.set(key, row);
			}
		}
		if (list && typeof list === 'object') {
			listRowIndexCache.set(list, { rows, length: rows.length, index });
		}
		return index;
	}
	function hasEnabledList(word) {
		const entry = state.vocabulary[word];
		return (
			!!entry &&
			(entry.lists || []).some((id) => !!state.enabledLists[id])
		);
	}


	function isActiveStudyWord(word) {
		const dataReady = ctx.hanziReady;
		const row = getEntryRow(word);
		const studyWord = rowScriptWord(row, state.settings) || word;
		return (
			!!word &&
			!state.blacklist[word] &&
			hasEnabledList(word) &&
			(!dataReady || canStudyWord(studyWord))
		);
	}


	function parseTsvRows(text) {
		return text
			.replace(/^\ufeff/, '')
			.split(/\r?\n/)
			.map((line, originalIndex) => ({ line, originalIndex }))
			.filter(({ line }) => line.trim().length > 0)
			.map(({ line, originalIndex }) => {
				const cells = line.split('\t').map((cell) => cell.trim());
				if (cells.length < 5)
					throw new Error(
						`Line ${originalIndex + 1} has ${cells.length} columns, expected 5.`
					);
				return {
					simplified: cells[0],
					traditional: cells[1],
					numbered: cells[2],
					pinyin: cells[3],
					definition: cells.slice(4).join('\t').trim()
				};
			});
	}


	function rowToTsv(row) {
		return [
			row.simplified,
			row.traditional,
			row.numbered,
			row.pinyin,
			row.definition
		].join('\t');
	}


	function canStudyWord(word) {
		const chars = Array.from(String(word || '').trim());
		return chars.length > 0 && chars.every((ch) => Boolean(hanzi[ch]));
	}



	function getEnabledListIds() {
		return Object.keys(lists || {}).filter(
			(id) => !!state.enabledLists?.[id]
		);
	}


	function getFirstEnabledListId() {
		return getEnabledListIds()[0] || null;
	}


	function syncSelectedListForEnabledLists() {
		if (ctx.selectedListId && lists[ctx.selectedListId]) return ctx.selectedListId;
		ctx.selectedListId = getFirstEnabledListId();
		return ctx.selectedListId;
	}


	function applyDefaultListSelection() {
		state.enabledLists = state.enabledLists || {};
		if (Array.isArray(ctx.knownListIds)) {
			const knownListIds = new Set(ctx.knownListIds);
			for (const id of Object.keys(state.enabledLists)) {
				if (!knownListIds.has(id)) delete state.enabledLists[id];
			}
		}
		syncSelectedListForEnabledLists();
	}


	function syncVocabularyWithEnabledLists({ save = true } = {}) {
		state.vocabulary =
			state.vocabulary && typeof state.vocabulary === 'object'
				? state.vocabulary
				: {};

		const memberships = new Map();
		for (const [id, list] of Object.entries(lists || {})) {
			for (const row of list.rows || []) {
				const word = rowCanonicalWord(row);
				if (!word) continue;
				if (!memberships.has(word)) memberships.set(word, new Set());
				memberships.get(word).add(id);
			}
		}

		const activeIds = Object.keys(state.enabledLists || {}).filter(
			(id) => state.enabledLists[id] && lists[id]
		);
		for (const id of activeIds) {
			for (const row of lists[id].rows || []) {
				const word = rowCanonicalWord(row);
				const studyWord = rowScriptWord(row, state.settings);
				if (!word || !canStudyWord(studyWord)) continue;
				ensureVocabularyEntry(word, null, row);
			}
		}

		for (const [word, entry] of Object.entries(state.vocabulary)) {
			if (!entry || typeof entry !== 'object') continue;
			entry.lists = [...(memberships.get(word) || [])];
		}

		if (save) saveState();
	}


	function ensureVocabularyEntry(word, listId = null, row = null) {
		if (!state.vocabulary[word] && row) {
			const legacyWord = legacyRowWord(row);
			const legacyEntry = legacyWord && state.vocabulary[legacyWord];
			if (legacyEntry && typeof legacyEntry === 'object') {
				state.vocabulary[word] = {
					...legacyEntry,
					word,
					lists: Array.isArray(legacyEntry.lists)
						? legacyEntry.lists.slice()
						: []
				};
			}
		}
		if (!state.vocabulary[word]) {
			state.vocabulary[word] = {
				word,
				last: null,
				next: null,
				lists: [],
				attempts: 0,
				successes: 0
			};
		}
		const entry = state.vocabulary[word];
		if (row) {
			entry.simplified = String(row.simplified || '').trim();
			entry.traditional = String(row.traditional || '').trim();
			entry.numbered = String(row.numbered || '').trim();
			entry.pinyin = String(row.pinyin || '').trim();
			entry.definition = String(row.definition || '').trim();
		}
		delete entry.failed;
		entry.lists = Array.isArray(entry.lists) ? entry.lists : [];
		if (listId && !entry.lists.includes(listId)) entry.lists.push(listId);
		entry.attempts = Number(entry.attempts || 0);
		entry.successes = Number(entry.successes || 0);
		if (entry.attempts) ensureFsrsState(entry);
		else delete entry.fsrs;
		return entry;
	}


	function resolveCanonicalWords(value) {
		const input = String(value || '').trim();
		if (!input) return [];
		if (isStableChineseStudyId(input)) return [input];
		const matches = [];
		const seen = new Set();
		for (const list of Object.values(lists || {})) {
			for (const row of list.rows || []) {
				if (!rowWords(row).includes(input)) continue;
				const studyId = rowCanonicalWord(row);
				if (!studyId || seen.has(studyId)) continue;
				seen.add(studyId);
				matches.push(studyId);
			}
		}
		return matches;
	}


	function resolveCanonicalWord(value) {
		const input = String(value || '').trim();
		if (!input) return '';
		return resolveCanonicalWords(input)[0] || input;
	}


	function getEntryRow(word) {
		const entryListIds = state.vocabulary[word]?.lists || [];
		const preferredListIds = [
			...entryListIds.filter((listId) => state.enabledLists?.[listId]),
			...entryListIds.filter((listId) => !state.enabledLists?.[listId])
		];
		const searched = new Set();
		for (const listId of preferredListIds) {
			searched.add(listId);
			const found = getListRowIndex(lists[listId]).get(word);
			if (found) return found;
		}
		for (const [listId, list] of Object.entries(lists || {})) {
			if (searched.has(listId)) continue;
			const found = getListRowIndex(list).get(word);
			if (found) return found;
		}
		const entry = state.vocabulary[word];
		if (entry?.simplified || entry?.traditional) {
			return {
				simplified: entry.simplified || entry.traditional || '',
				traditional: entry.traditional || entry.simplified || '',
				numbered: entry.numbered || '',
				pinyin: entry.pinyin || '',
				definition: entry.definition || ''
			};
		}
		return {
			simplified: word,
			traditional: word,
			numbered: '',
			pinyin: Array.from(word)
				.map((ch) => hanzi[ch]?.pinyin?.[0] || '')
				.join(' '),
			definition: Array.from(word)
				.map((ch) => hanzi[ch]?.definition || '')
				.join('; ')
		};
	}


	function getActiveVocabulary() {
		return Object.values(state.vocabulary).filter((entry) => {
			if (
				!entry?.word ||
				!(entry.lists || []).some((id) => state.enabledLists[id]) ||
				state.blacklist[entry.word]
			) return false;
			const row = getEntryRow(entry.word);
			return canStudyWord(rowScriptWord(row, state.settings) || entry.word);
		});
	}


	function orderNewItemsByListPosition(items) {
		const byWord = new Map(items.map((entry) => [entry.word, entry]));
		const ordered = [];
		const seen = new Set();
		for (const [listId, list] of Object.entries(lists)) {
			if (!state.enabledLists[listId]) continue;
			for (const row of list.rows || []) {
				const word = rowCanonicalWord(row);
				const entry = byWord.get(word);
				if (!entry || seen.has(word)) continue;
				ordered.push(entry);
				seen.add(word);
			}
		}
		for (const entry of items) {
			if (seen.has(entry.word)) continue;
			ordered.push(entry);
		}
		return ordered;
	}


	function firstNewByListPosition(items) {
		return orderNewItemsByListPosition(
			items.filter((entry) => !(entry.attempts || 0))
		)[0] || null;
	}


	return {
		isActiveStudyWord,
		parseTsvRows,
		rowToTsv,
		canStudyWord,
		getEnabledListIds,
		getFirstEnabledListId,
		syncSelectedListForEnabledLists,
		applyDefaultListSelection,
		syncVocabularyWithEnabledLists,
		ensureVocabularyEntry,
		getEntryRow,
		resolveCanonicalWord,
		resolveCanonicalWords,
		getActiveVocabulary,
		orderNewItemsByListPosition,
		firstNewByListPosition
	};
}
