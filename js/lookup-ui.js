import { SAMPLE_LISTS } from './sample-data.js';
import { rowScriptWord, rowWords } from './script-mode.js';
import { drawCanvasBase, drawCharacterPaths } from './practice-canvas.js';

export function createLookupUi(ctx) {
	const state = ctx.liveState();
	const hanzi = ctx.liveHanzi();
	const lists = ctx.liveLists();
	const $ = (...args) => ctx.$(...args);
	const escapeHtml = (...args) => ctx.escapeHtml(...args);
	const metaRow = (...args) => ctx.metaRow(...args);
	const rowToTsv = (...args) => ctx.rowToTsv(...args);
	const parseTsvRows = (...args) => ctx.parseTsvRows(...args);
	const canStudyWord = (...args) => ctx.canStudyWord(...args);
	const syncVocabularyWithEnabledLists = (...args) => ctx.syncVocabularyWithEnabledLists(...args);
	const renderLists = (...args) => ctx.renderLists(...args);
	const renderProgress = (...args) => ctx.renderProgress(...args);
	const setText = (...args) => ctx.setText(...args);
	const renderLookupExamples = (...args) => ctx.renderLookupExamples(...args);
	const clearLookupExamples = (...args) => ctx.clearLookupExamples(...args);

	function stopLookupAnimation() {
		if (!ctx.lookupAnimator) return;
		clearInterval(ctx.lookupAnimator);
		ctx.lookupAnimator = null;
	}

	function clearLookupCanvas() {
		const canvas = $('#lookupCanvas');
		if (!canvas) return;
		drawCanvasBase(canvas.getContext('2d'), canvas.width);
	}

	function lookupCharacter(ch, options = {}) {
		const { syncInput = true } = options;
		const result = $('#lookupResult');
		if (!ch) {
			stopLookupAnimation();
			clearLookupExamples();
			clearLookupCanvas();
			if (result) result.innerHTML = '<p>Enter a Hanzi character to inspect it.</p>';
			return;
		}
		if (syncInput && $('#lookupInput')) $('#lookupInput').value = ch;
		const data = hanzi[ch];
		renderLookupExamples(ch);
		if (!data) {
			stopLookupAnimation();
			if (result) {
				result.innerHTML =
					`<p>No local data for <strong>${escapeHtml(ch)}</strong>. ` +
					'Generate a larger hanzi.json with tools/build_hanzi_data.py.</p>';
			}
			clearLookupCanvas();
			return;
		}
		if (result) {
			result.innerHTML = `
				<div class="big-char">${escapeHtml(ch)}</div>
				${metaRow('Pinyin', (data.pinyin || []).join(', '))}
				${metaRow('Definition', data.definition || '—')}
				${metaRow('Radical', data.radical || '—')}
				${metaRow('Decomposition', data.decomposition || '—')}
				${data.etymology?.hint ? metaRow('Hint', data.etymology.hint) : ''}
			`;
		}
		animateLookup(data);
	}

	function animateLookup(data) {
		stopLookupAnimation();
		const canvas = $('#lookupCanvas');
		if (!canvas) return;
		const ctx2d = canvas.getContext('2d');
		let index = 0;
		const draw = () => {
			drawCanvasBase(ctx2d, canvas.width);
			drawCharacterPaths(
				ctx2d,
				data,
				Array.from({ length: index }, (_, i) => i),
				'rgba(0,0,0,.86)'
			);
			index = (index + 1) % (data.strokes.length + 1);
		};
		draw();
		ctx.lookupAnimator = setInterval(draw, 650);
	}

	function addLookupToPersonalList() {
		const chars = Array.from($('#lookupInput')?.value.trim() || '').filter(
			(ch) => hanzi[ch]
		);
		if (!chars.length) return;
		const id = 'personal';
		if (!state.customLists[id])
			state.customLists[id] = {
				category: 'Custom',
				name: 'Personal characters',
				rows: []
			};
		const rows = state.customLists[id].rows;
		for (const ch of chars) {
			if (rows.some((row) => rowWords(row).includes(ch))) continue;
			const data = hanzi[ch];
			rows.push({
				simplified: ch,
				traditional: ch,
				numbered: '',
				pinyin: (data.pinyin || []).join(', '),
				definition: data.definition || ''
			});
		}
		state.enabledLists[id] = true;
		ctx.selectedListId = id;
		lists[id] = state.customLists[id];
		syncVocabularyWithEnabledLists();
		renderLists();
		$('#lookupResult')?.insertAdjacentHTML(
			'beforeend',
			'<p>Added to Personal characters.</p>'
		);
	}

	function pasteDemoList() {
		if ($('#customListText')) {
			$('#customListText').value = SAMPLE_LISTS.demo.rows
				.map(rowToTsv)
				.join('\n');
		}
		if ($('#customListId')) $('#customListId').value = 'my-demo';
		if ($('#customListName')) $('#customListName').value = 'My demo list';
	}

	function importCustomList() {
		const id = ($('#customListId')?.value || '')
			.trim()
			.replace(/[^a-zA-Z0-9_.-]/g, '-');
		const name = ($('#customListName')?.value || id).trim();
		if (!id) return setText('#listImportStatus', 'Please enter a list id.');
		if (lists[id] && !state.customLists[id])
			return setText(
				'#listImportStatus',
				`List id "${id}" is reserved by a built-in list. Choose another id.`
			);
		try {
			const rows = parseTsvRows($('#customListText')?.value || '');
			const usable = rows.filter((row) =>
				canStudyWord(rowScriptWord(row, state.settings))
			);
			state.customLists[id] = { category: 'Custom', name, rows };
			lists[id] = state.customLists[id];
			state.enabledLists[id] = true;
			ctx.selectedListId = id;
			syncVocabularyWithEnabledLists();
			renderLists();
			renderProgress();
			setText(
				'#listImportStatus',
				`Imported ${rows.length} rows. ${usable.length} are studyable with current hanzi data.`
			);
		} catch (error) {
			setText('#listImportStatus', `Import failed: ${error.message}`);
		}
	}

	return {
		lookupCharacter,
		stopLookupAnimation,
		addLookupToPersonalList,
		pasteDemoList,
		importCustomList
	};
}
