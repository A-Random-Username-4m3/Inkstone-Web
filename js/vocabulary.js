import { rowCanonicalWord, rowScriptWord, rowWords } from './script-mode.js';
export function createVocabulary(ctx) {
	const state = ctx.liveState();
	const lists = ctx.liveLists();
	const hanzi = ctx.liveHanzi();
	const ensureFsrsState = (...args) => ctx.ensureFsrsState(...args);
	const saveState = (...args) => ctx.saveState(...args);
	function hasEnabledList(word) {
		const entry = state.vocabulary[word];
		return (
			!!entry &&
			(entry.lists || []).some((id) => !!state.enabledLists[id])
		);
	}


	function isActiveStudyWord(word) {
		const dataReady = Object.keys(hanzi || {}).length > 0;
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
		for (const id of Object.keys(state.enabledLists)) {
			if (!lists[id]) delete state.enabledLists[id];
		}
		syncSelectedListForEnabledLists();
	}


	function syncVocabularyWithEnabledLists() {
		const activeIds = Object.keys(state.enabledLists || {}).filter(
			(id) => state.enabledLists[id] && lists[id]
		);
		for (const id of activeIds) {
			for (const row of lists[id].rows || []) {
				const word = rowCanonicalWord(row);
				const studyWord = rowScriptWord(row, state.settings);
				if (!word || !canStudyWord(studyWord)) continue;
				ensureVocabularyEntry(word, id);
			}
		}
		saveState();
	}


	function ensureVocabularyEntry(word, listId = null) {
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
		delete entry.failed;
		entry.lists = Array.isArray(entry.lists) ? entry.lists : [];
		if (listId && !entry.lists.includes(listId)) entry.lists.push(listId);
		entry.attempts = Number(entry.attempts || 0);
		entry.successes = Number(entry.successes || 0);
		if (entry.attempts) ensureFsrsState(entry);
		else delete entry.fsrs;
		return entry;
	}


	function resolveCanonicalWord(value) {
		const word = String(value || '').trim();
		if (!word) return '';
		for (const list of Object.values(lists)) {
			for (const row of list.rows || []) {
				if (!rowWords(row).includes(word)) continue;
				return rowCanonicalWord(row) || word;
			}
		}
		return word;
	}


	function getEntryRow(word) {
		const entryListIds = state.vocabulary[word]?.lists || [];
		const preferredListIds = [
			...entryListIds.filter((listId) => state.enabledLists?.[listId]),
			...entryListIds.filter((listId) => !state.enabledLists?.[listId])
		];
		for (const listId of preferredListIds) {
			const found = lists[listId]?.rows?.find(
				(row) => row.simplified === word || row.traditional === word
			);
			if (found) return found;
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
		getActiveVocabulary,
		orderNewItemsByListPosition,
		firstNewByListPosition
	};
}
