import { DEFAULT_STUDY_EXAMPLE_LIMIT } from './constants.js';
import { rowWords, textValue } from './script-mode.js';

function chars(text) {
	return Array.from(String(text || ''));
}

function isCompoundWord(word) {
	return chars(word).length >= 2;
}

function chooseDisplayWord(row, character) {
	const ch = String(character || '');
	const words = rowWords(row);
	if (!ch) return words[0] || '';
	return words.find((word) => chars(word).includes(ch)) || words[0] || '';
}

function rowContainsCharacter(row, character) {
	const ch = String(character || '');
	if (!ch) return false;
	return rowWords(row).some((word) => chars(word).includes(ch));
}

function rowHasSeenWord(row, seenWords) {
	return rowWords(row).some((word) => seenWords.has(word));
}

function markRowWordsSeen(row, seenWords, displayWord = '') {
	for (const word of rowWords(row)) seenWords.add(word);
	if (displayWord) seenWords.add(displayWord);
}

function matchesExcludedWord(row, excludeWords) {
	const excluded = new Set(
		(Array.isArray(excludeWords) ? excludeWords : [excludeWords])
			.map(textValue)
			.filter(Boolean)
	);
	if (!excluded.size) return false;
	return rowWords(row).some((word) => excluded.has(word));
}

function shuffle(items) {
	const shuffled = items.slice();
	for (let i = shuffled.length - 1; i > 0; i -= 1) {
		const j = Math.floor(Math.random() * (i + 1));
		[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
	}
	return shuffled;
}

function blankWord(word) {
	return chars(word).map(() => '＿').join('');
}

function excludedWordsForCard(card) {
	return [
		card?.word,
		card?.studyWord,
		card?.row?.simplified,
		card?.row?.traditional
	].map(textValue).filter(Boolean);
}

export function createWordExamples(ctx) {
	const lists = ctx.liveLists();
	const state = ctx.liveState();
	const $ = (...args) => ctx.$(...args);
	const escapeHtml = (...args) => ctx.escapeHtml(...args);

	function getCharacterExamples(character, options = {}) {
		const {
			excludeWord = '',
			excludeWords = excludeWord ? [excludeWord] : [],
			max = DEFAULT_STUDY_EXAMPLE_LIMIT
		} = options;
		const examples = [];
		const seenWords = new Set();
		const activeListsOnly = !!state.settings?.examplesActiveListsOnly;
		for (const [listId, list] of Object.entries(lists || {})) {
			if (activeListsOnly && !state.enabledLists?.[listId]) continue;
			for (const row of list?.rows || []) {
				if (rowHasSeenWord(row, seenWords)) continue;
				if (matchesExcludedWord(row, excludeWords)) continue;
				if (!rowContainsCharacter(row, character)) continue;
				const word = chooseDisplayWord(row, character);
				if (!word || !isCompoundWord(word)) continue;
				markRowWordsSeen(row, seenWords, word);
				examples.push({
					word,
					pinyin: row?.pinyin || row?.numbered || '',
					definition: row?.definition || ''
				});
			}
		}
		const randomized = shuffle(examples);
		const limit = Number(max);
		return Number.isFinite(limit) && limit > 0 && randomized.length > limit
			? randomized.slice(0, Math.floor(limit))
			: randomized;
	}

	function examplesHtml(examples, options = {}) {
		const { showHanzi = true } = options;
		if (!examples.length) return '';
		return `
			<div class="example-heading">Used in other words</div>
			<ul class="example-list">
				${examples.map((example) => {
					const displayWord = showHanzi
						? example.word
						: blankWord(example.word);
					return `
						<li>
							<span class="example-word${showHanzi ? '' : ' example-word-blank'}">${escapeHtml(displayWord)}</span>
							<span class="example-detail">
								${example.pinyin ? `<span class="example-pinyin">${escapeHtml(example.pinyin)}</span>` : ''}
								${example.definition ? `<span class="example-definition">${escapeHtml(example.definition)}</span>` : ''}
							</span>
						</li>
					`;
				}).join('')}
			</ul>
		`;
	}

	function renderStudyExamples(card, currentIndex = 0, options = {}) {
		const container = $('#promptExamples');
		if (!container) return;
		const character = card?.characters?.[currentIndex]?.character ||
			chars(card?.studyWord || card?.word)[currentIndex] || '';
		if (!card || !character) {
			container.innerHTML = '';
			container.classList.add('hidden');
			return;
		}
		const examples = getCharacterExamples(character, {
			excludeWords: excludedWordsForCard(card),
			max: state.settings?.studyExampleLimit ||
				DEFAULT_STUDY_EXAMPLE_LIMIT
		});
		if (!examples.length) {
			container.innerHTML = '';
			container.classList.add('hidden');
			return;
		}
		container.innerHTML = examplesHtml(examples, {
			showHanzi: options.showHanzi ?? (card.stage || 1) === 1
		});
		container.classList.remove('hidden');
	}

	function renderLookupExamples(character) {
		const container = $('#lookupExamples');
		if (!container) return;
		const examples = getCharacterExamples(character, {
			excludeWord: '',
			max: null
		});
		if (!character || !examples.length) {
			container.innerHTML = '';
			container.classList.add('hidden');
			return;
		}
		container.innerHTML = examplesHtml(examples, { showHanzi: true });
		container.classList.remove('hidden');
	}

	function clearStudyExamples() {
		const container = $('#promptExamples');
		if (!container) return;
		container.innerHTML = '';
		container.classList.add('hidden');
	}

	function clearLookupExamples() {
		const container = $('#lookupExamples');
		if (!container) return;
		container.innerHTML = '';
		container.classList.add('hidden');
	}

	return {
		renderStudyExamples,
		renderLookupExamples,
		clearStudyExamples,
		clearLookupExamples
	};
}
