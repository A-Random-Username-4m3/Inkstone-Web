import {
	DEFAULT_EXTRA_CARDS,
	REVIEW_STAGE_MAX,
	RESULT_LABELS,
	MASTERED_STABILITY_DAYS
} from './constants.js';
import {
	ensureFsrsState,
	getEntrySchedulerState,
	fsrsRatingNumber,
	fsrsStateNumber,
	setEntrySchedulerState,
	applyFsrsResult
} from './fsrs.js';
import { PracticeCanvas } from './practice-canvas.js';
import { rowScriptWord } from './script-mode.js';
import { nextStageAfterResult, stagedSpacingTurns } from './learning-policy.js';
import { recordHanziObservations } from './hanzi-mastery.js';

// Chinese vocabulary IDs are stable across scripts. Only the displayed form
// should determine the glyphs used for stroke assessment.
export function resolvePracticeContent(row, scriptMode, deck, hanzi, getCharacter, fallbackWord = '') {
    const displayedWord = rowScriptWord(row, scriptMode) || fallbackWord;
    const practiceWord = deck === 'hanzi' && hanzi ? hanzi : displayedWord;
    return {
        practiceWord,
        wordLength: Array.from(displayedWord).length,
        characters: Array.from(practiceWord).map((ch) => getCharacter(ch))
    };
}

export function createStudyFlow(ctx) {
	const state = ctx.liveState();
	const $ = (...args) => ctx.$(...args);
	const sample = (...args) => ctx.sample(...args);
	const now = (...args) => ctx.now(...args);
	const getEntryRow = (...args) => ctx.getEntryRow(...args);
	const isActiveStudyWord = (...args) => ctx.isActiveStudyWord(...args);
	const syncVocabularyWithEnabledLists = (...args) => ctx.syncVocabularyWithEnabledLists(...args);
	const saveState = (...args) => ctx.saveState(...args);
	const formatDueSummary = (...args) => ctx.formatDueSummary(...args);
	const renderProgress = (...args) => ctx.renderProgress(...args);
	const setBlacklistedWord = (...args) => ctx.setBlacklistedWord(...args);
	const playSound = (...args) => ctx.playSound?.(...args);
	const playResultSound = (...args) => ctx.playResultSound?.(...args);
	const syncStageQueueToSession = (...args) => ctx.syncStageQueueToSession(...args);
	const clearCurrentStageCard = (...args) => ctx.clearCurrentStageCard(...args);
	const clearStagedWord = (...args) => ctx.clearStagedWord(...args);
	const pruneStagedState = (...args) => ctx.pruneStagedState(...args);
	const getDueSets = (...args) => ctx.getDueSets(...args);
	const getRemainder = (...args) => ctx.getRemainder(...args);
	const ageQueuedStageCards = (...args) => ctx.ageQueuedStageCards(...args);
	const getQueuedStageCandidates = (...args) => ctx.getQueuedStageCandidates(...args);
	const chooseAvailableBucket = (...args) => ctx.chooseAvailableBucket(...args);
	const buildPrimaryBuckets = (...args) => ctx.buildPrimaryBuckets(...args);
	const orderReviewItems = (...args) => ctx.orderReviewItems(...args);
	const firstNewByListPosition = (...args) => ctx.firstNewByListPosition(...args);
	const lastShownWord = (...args) => ctx.lastShownWord(...args);
	const rememberShownWord = (...args) => ctx.rememberShownWord(...args);
	const clamp = (...args) => ctx.clamp(...args);
	const resetExpiredSession = (...args) => ctx.resetExpiredSession(...args);
	const refreshVocabularyViews = (...args) => ctx.refreshVocabularyViews(...args);
	const renderStudyExamples = (...args) => ctx.renderStudyExamples(...args);
	const clearStudyExamples = (...args) => ctx.clearStudyExamples(...args);
	const NEXT_CARD_DELAY_MS = ctx.NEXT_CARD_DELAY_MS;
	const STAGED_CARD_SPACING_TURNS = ctx.STAGED_CARD_SPACING_TURNS;

	function recordReviewLog(entry, reviewTimeSeconds, rating, stateName) {
		ctx.addReviewLog?.({
			card_id: String(entry.word),
			review_time: Math.round(reviewTimeSeconds * 1000),
			review_rating: fsrsRatingNumber(rating),
			review_state: fsrsStateNumber(stateName)
		});
	}

	function clearExternalWordStudyState(word) {
		cancelScheduledNextCard();
		/* Used by Lists-tab edits. The active ctx.trainer owns a snapshot of the card,
		 * so changing vocabulary alone is not enough; the active card must be
		 * discarded or it will keep displaying the old staged attempt */
		if (ctx.currentCard?.word === word) {
			disposeTrainer();
			ctx.currentCard = null;
			clearCurrentStageCard();
		}
		ctx.stagedQueue = ctx.stagedQueue.filter((item) => item.word !== word);
		syncStageQueueToSession();
	}


	function restoreCurrentCardFromSession() {
		const item = ctx.normalizeStageQueueItem(state.session?.currentStageCard);
		if (!item) {
			clearCurrentStageCard();
			return false;
		}
		const entry = state.vocabulary[item.word];
		ctx.currentCard = makeReviewCard(
			entry,
			item.deck,
			item.stage,
			item.attemptResult,
			item.forceSequential,
			item.sawAgain,
            item.hanzi,
            item.position,
            item.recordedHanzi,
            item.failedCharacters,
            item.scriptMode
		);
		return true;
	}


	function disposeTrainer() {
		if (!ctx.trainer) return;
		ctx.trainer.dispose?.();
		ctx.trainer = null;
	}


	function setPracticeEmptyState(isEmpty) {
		const canvas = $('#practiceCanvas');
		const card = canvas?.closest('.canvas-card');
		canvas?.classList.toggle('empty-state', !!isEmpty);
		card?.classList.toggle('empty-state', !!isEmpty);
	}


	function setStudyControlsEnabled(enabled) {
		[
			'#btnHint',
			'#btnReveal',
			'#btnUndo',
			'#btnGradeExcellent',
			'#btnGradeGood',
			'#btnGradeFair',
			'#btnGradeAgain',
			'#btnBlacklistCard'
		].forEach((selector) => {
			const button = $(selector);
			if (button) button.disabled = !enabled;
		});
	}


	function setFeedbackMessage(message = '', kind = 'info') {
		const feedback = $('#feedback');
		if (!feedback) return;
		feedback.textContent = message || '';
		feedback.classList.remove(
			'status-empty',
			'status-good',
			'status-warning',
			'status-danger',
			'status-complete'
		);
		const statusClass = {
			empty: 'status-empty',
			good: 'status-good',
			warning: 'status-warning',
			danger: 'status-danger',
			complete: 'status-complete'
		}[kind] || null;
		if (statusClass) feedback.classList.add(statusClass);
	}


	function deckLabel(deck) {
		if (deck === 'hanzi') return 'Hanzi recall';
		if (deck === 'adds') return 'New';
		if (deck === 'reviews') return 'Review';
		if (deck === 'steps') return 'Learning step';
		return 'Review';
	}


	function stageLabel(stage) {
		if (stage === 1) return 'Stage 1 · Learn';
		if (stage === 2) return 'Stage 2 · Recall with preview';
		if (stage === 3) return 'Stage 3 · Stroke start points';
		if (stage === 4) return 'Stage 4 · Next start point';
		return 'Stage 5 · Unassisted recall';
	}


	function initialStageForEntry(entry, deck) {
		if (deck === 'adds' || !entry?.attempts) return 1;
		return REVIEW_STAGE_MAX;
	}


	function makeReviewCard(
		entry,
		deck,
		stage = null,
		attemptResult = null,
		forceSequential = false,
		sawAgain = false,
        hanzi = null,
        position = null,
        recordedHanzi = [],
        failedCharacters = [],
        scriptMode = null
	) {
		const row = getEntryRow(entry.word);
		const resolvedScriptMode = scriptMode === 'traditional' || scriptMode === 'simplified'
            ? scriptMode : state.settings.scriptMode;
        const { practiceWord, wordLength, characters } = resolvePracticeContent(
            row, resolvedScriptMode, deck, hanzi,
            (ch) => ctx.getHanziPracticeCharacter?.(ch), entry.word
        );
		return {
			deck,
			entry,
			row,
			word: entry.word,
			studyWord: practiceWord,
            scriptMode: resolvedScriptMode,
            hanzi: deck === 'hanzi' ? hanzi : null,
            position: deck === 'hanzi' ? position : null,
            wordLength,
            recordedHanzi: Array.isArray(recordedHanzi) ? recordedHanzi.slice() : [],
            failedCharacters: Array.isArray(failedCharacters) ? failedCharacters.slice() : [],
			stage: clamp(
				Math.floor(stage || initialStageForEntry(entry, deck)),
				1,
				REVIEW_STAGE_MAX
			),
			attemptResult:
				attemptResult == null
					? null
					: clamp(Math.floor(attemptResult), 0, 3),
			forceSequential: !!forceSequential,
			sawAgain: !!sawAgain,
			ts: state.session.started,
			characters,
			revealedChars: 0
		};
	}



	function combineAttemptResult(previous, current) {
		return Math.max(
			previous == null ? 0 : previous,
			current == null ? 3 : current
		);
	}


	function isMasteredEntry(entry) {
		if (!entry || !(entry.attempts || 0)) return false;
		const fsrs = ensureFsrsState(entry);
		return fsrs.state === 'review' &&
			Number(fsrs.stability || 0) >= MASTERED_STABILITY_DAYS;
	}


	function cancelScheduledNextCard() {
		if (!ctx.nextCardTimer) return;
		clearTimeout(ctx.nextCardTimer);
		ctx.nextCardTimer = null;
	}


	function scheduleNextCard(delay = NEXT_CARD_DELAY_MS) {
		cancelScheduledNextCard();
		ctx.nextCardTimer = setTimeout(() => {
			ctx.nextCardTimer = null;
			nextCard();
		}, delay);
	}


	function drawQueuedStageCard(options = {}) {
		const { readyOnly = false, avoidLastWord = true } = options;
		let candidates = getQueuedStageCandidates({ readyOnly });
		if (avoidLastWord) {
			const bucket = chooseAvailableBucket([
				{
					deck: 'staged',
					candidates,
					word: (candidate) => candidate.item.word
				}
			]);
			candidates = bucket?.candidates || [];
		}
		while (candidates.length) {
			const candidate = candidates[0];
			const queueIndex = ctx.stagedQueue.indexOf(candidate.item);
			if (queueIndex >= 0) ctx.stagedQueue.splice(queueIndex, 1);
			else ctx.stagedQueue.splice(candidate.index, 1);
			const queued = candidate.item;
			const queuedEntry = state.vocabulary[queued.word];
			if (!queuedEntry || !isActiveStudyWord(queued.word)) {
				syncStageQueueToSession();
				candidates = getQueuedStageCandidates({ readyOnly });
				continue;
			}
			ctx.currentCard = makeReviewCard(
				queuedEntry,
				queued.deck,
				queued.stage,
				queued.attemptResult,
				queued.forceSequential,
				queued.sawAgain,
                queued.hanzi,
                queued.position,
                queued.recordedHanzi,
                queued.failedCharacters,
                queued.scriptMode
			);
			ageQueuedStageCards();
			syncStageQueueToSession();
			saveState();
			return ctx.currentCard;
		}
		syncStageQueueToSession();
		return null;
	}


	function drawFromBucket(bucket) {
		if (!bucket) return { entry: null, deck: null, staged: false };
		if (bucket.deck === 'hanzi') {
            const drill = bucket.candidates[0];
            return { entry: drill.entry, deck: 'hanzi', hanzi: drill.hanzi,
                position: drill.position, staged: false };
        }
		if (bucket.deck === 'staged') {
			const card = drawQueuedStageCard({ readyOnly: true, avoidLastWord: true });
			return { entry: card?.entry || null, deck: 'staged', staged: !!card };
		}
		const entry = bucket.deck === 'adds' && state.settings.newCardOrder === 'random'
			? sample(bucket.candidates)
			: bucket.candidates[0] || null;
		return { entry, deck: bucket.deck, staged: false };
	}


	function drawExtraCard(sets) {
		const previous = lastShownWord();
		const orderedExtras = orderReviewItems(sets.extras);
		const preferredExtras = previous && orderedExtras.some((entry) => entry.word !== previous)
			? orderedExtras.filter((entry) => entry.word !== previous)
			: orderedExtras;
		const extra = preferredExtras.find((entry) => entry.attempts) ||
			firstNewByListPosition(preferredExtras);
		if (!extra) return { entry: null, deck: null };
		const stateName = getEntrySchedulerState(extra);
		return {
			entry: extra,
			deck: stateName === 'learning' || stateName === 'relearning'
				? 'steps'
				: extra.attempts ? 'reviews' : 'adds'
		};
	}

	function nextCard(shouldSkip = false) {
		cancelScheduledNextCard();
		if (ctx.currentCard) {
			if (
				shouldSkip &&
				ctx.trainer?.isCardCompleteAwaitingContinue?.()
			) {
				ctx.trainer.continueAfterCharacter();
				return;
			}
			if (!shouldSkip) {
				setFeedbackMessage(
					'Finish or grade the current stage before moving to another card.',
					'warning'
				);
				return;
			}
			const word = ctx.currentCard.word || ctx.currentCard.entry?.word;
			disposeTrainer();

			ctx.stagedQueue = ctx.stagedQueue.filter(
				(item) => item.word !== word
			);

			ctx.stagedQueue.push({
				word,
				deck: ctx.currentCard.deck,
				stage: ctx.currentCard.stage,
				attemptResult: ctx.currentCard.attemptResult ?? null,
				forceSequential: !!ctx.currentCard.forceSequential,
				sawAgain: !!ctx.currentCard.sawAgain,
                hanzi: ctx.currentCard.hanzi,
                position: ctx.currentCard.position,
                recordedHanzi: ctx.currentCard.recordedHanzi || [],
                failedCharacters: ctx.currentCard.failedCharacters || [],
                scriptMode: ctx.currentCard.scriptMode,
				delay: STAGED_CARD_SPACING_TURNS
			});

			ctx.currentCard = null;
			clearCurrentStageCard();
			syncStageQueueToSession();
			saveState();

		}

		syncVocabularyWithEnabledLists();
		pruneStagedState();

		if (restoreCurrentCardFromSession()) {
			renderCurrentCard();
			return;
		}

		const sets = getDueSets();
		const left = getRemainder(sets);
		const bucket = chooseAvailableBucket(buildPrimaryBuckets(sets, left));
		const drawn = drawFromBucket(bucket);

		if (drawn.staged) {
			renderCurrentCard();
			return;
		}

		if (drawn.entry) {
			ageQueuedStageCards();
			ctx.currentCard = makeReviewCard(drawn.entry, drawn.deck,
                null, null, false, false, drawn.hanzi, drawn.position);
			renderCurrentCard();
			return;
		}

		if (left.extras > 0) {
			const extra = drawExtraCard(sets);
			if (extra.entry) {
				ageQueuedStageCards();
				ctx.currentCard = makeReviewCard(extra.entry, extra.deck);
				renderCurrentCard();
				return;
			}
		}

		if (drawQueuedStageCard({ avoidLastWord: true })) {
			renderCurrentCard();
			return;
		}

		ctx.currentCard = null;
		clearCurrentStageCard();
		renderNoCard(sets, left);
	}



	function renderNoCard(sets, left = getRemainder(sets)) {
		$('#deckName').textContent = 'Done';
		$('#dueSummary').textContent = formatDueSummary(sets, left);
		$('#promptPinyin').textContent = '✓';

		const extraAvailable = sets.extras.length;
		const addExtra = $('#addExtraCardsPanel');
		if (addExtra)
			addExtra.classList.toggle(
				'hidden',
				!(sets.active.length && extraAvailable > 0)
			);

		let feedbackMessage = '';
		if (sets.active.length && extraAvailable > 0) {
			$('#promptDefinition').textContent =
				`You're done for the planned deck. You can add up to ${extraAvailable} ` +
				'extra cards for this session, change scheduling settings, or ' +
				'enable another list.';
			feedbackMessage =
				'Planned session complete. Add extra cards, enable another list, or wait for the next due review.';
			if ($('#extraCardCount'))
				$('#extraCardCount').value = Math.min(
					DEFAULT_EXTRA_CARDS,
					extraAvailable
				);
		} else {
			$('#promptDefinition').textContent = sets.active.length
				? 'No cards are due right now. The line above shows the next ' +
					'scheduled review countdown, if any. You can also ' +
					'enable/import another list or raise max cards in Settings.'
				: 'No active words yet. Enable a list or add characters from Browse.';
			feedbackMessage = sets.active.length
				? 'No practice card is active. Wait for the next due review, add extras, or adjust the debug time.'
				: 'No active words selected. Enable a word list in Lists or add characters from Browse.';
		}

		$('#targetWord').classList.add('hidden');
		$('#charProgress').innerHTML = '';
		clearStudyExamples();
		setFeedbackMessage(feedbackMessage, 'empty');
		setStudyControlsEnabled(false);
		clearCurrentStageCard();
		disposeTrainer();
		setPracticeEmptyState(true);
		ctx.trainer = new PracticeCanvas($('#practiceCanvas'), null, () => {});
		renderProgress(sets, left);
	}


	function renderCurrentCard() {
		if (!ctx.currentCard) return;
		rememberShownWord(ctx.currentCard.word);
		const { deck, row, characters, stage } = ctx.currentCard;
		$('#deckName').textContent =
			`${deckLabel(deck)} · ${stageLabel(stage)}`;
		const sets = getDueSets();
		const left = getRemainder(sets);
		$('#dueSummary').textContent = formatDueSummary(sets, left);
		$('#promptPinyin').textContent = row.pinyin ||
            characters.map((x) => x?.pinyin?.join(', ') || '').join(' / ');
        const hanziDrill = deck === 'hanzi';
        $('#promptDefinition').textContent = hanziDrill
            ? `Write character ${(ctx.currentCard.position ?? 0) + 1} of ${ctx.currentCard.wordLength} ` +
              `for the word meaning: ${row.definition || 'unknown'}.`
            : row.definition || characters.map((x) => x?.definition || '').filter(Boolean).join('; ');
        $('#targetWord').textContent = ctx.currentCard.studyWord || rowScriptWord(row, state.settings) || row.simplified;
		$('#targetWord').classList.add('hidden');
		setFeedbackMessage('', 'info');
		if ($('#addExtraCardsPanel'))
			$('#addExtraCardsPanel').classList.add('hidden');
		setStudyControlsEnabled(true);
		setPracticeEmptyState(false);
		disposeTrainer();
		ctx.trainer = new PracticeCanvas(
			$('#practiceCanvas'),
			ctx.currentCard,
			completeCurrentCard
		);
		saveState();
		renderProgress(sets, left);
	}


	function renderCharProgress(currentIndex, revealedCount = currentIndex, options = {}) {
		const progress = $('#charProgress');
		progress.innerHTML = '';
		if (!ctx.currentCard) {
			clearStudyExamples();
			return;
		}
		const stage = ctx.currentCard.stage || 1;
		const shownThrough = Math.max(
			revealedCount || 0,
			ctx.currentCard.revealedChars || 0
		);
		const previewIndex = Number.isInteger(options.previewIndex)
			? options.previewIndex
			: -1;
		const currentVisible =
			stage === 1 || currentIndex < shownThrough || currentIndex === previewIndex;
		if (ctx.currentCard.deck === 'hanzi') clearStudyExamples();
        else renderStudyExamples(ctx.currentCard, currentIndex, {
			showHanzi: currentVisible
		});
		ctx.currentCard.characters.forEach((ch, i) => {
			const span = document.createElement('span');
			const isPreviewed = i === previewIndex;
			const isRevealed = stage === 1 || i < shownThrough || isPreviewed;
			span.textContent = isRevealed ? ch.character : '?';
			if (!isRevealed) span.classList.add('blank');
			if (
				(stage === 1 && i < currentIndex) ||
				(stage > 1 && i < shownThrough)
			)
				span.classList.add('done');
			if (i === currentIndex) span.classList.add('current');
			progress.appendChild(span);
		});
	}


	function completeCurrentCard(result, characterGrades = null) {
		if (!ctx.currentCard) return;
		disposeTrainer();
		resetExpiredSession();
		const entry = state.vocabulary[ctx.currentCard.entry.word];
		const t = now();
		const displayWord = ctx.currentCard.studyWord || entry.word;
		// A Stage 5 failure can precede a skip, reload or manual grade.
		// It remains part of this staged attempt even after retrying.
		const interruptedFailure = ctx.currentCard.stage === REVIEW_STAGE_MAX &&
			(ctx.currentCard.failedCharacters?.length || 0) > 0;
		const effectiveResult = interruptedFailure ? 3 : result;
		const resultLabel = RESULT_LABELS[effectiveResult] || RESULT_LABELS[3];
		const attemptResult = combineAttemptResult(
			ctx.currentCard.attemptResult,
			effectiveResult
		);
		const forceSequential = !!ctx.currentCard.forceSequential || attemptResult === 3;
		const sawAgain = !!ctx.currentCard.sawAgain || attemptResult === 3;
        // Word-level manual grading cannot fabricate handwriting evidence.
        // Manual grading a standalone hanzi drill *is* an explicit character grade.
        const evidence = ctx.currentCard.deck === 'hanzi' &&
            !Array.isArray(characterGrades) ? [effectiveResult]
            : Array.isArray(characterGrades) ? characterGrades.map((grade, index) =>
                ctx.currentCard.failedCharacters?.includes(index) ? 3 : grade)
            : characterGrades;
        if (ctx.currentCard.stage === REVIEW_STAGE_MAX &&
            Array.isArray(evidence) &&
            evidence.length === ctx.currentCard.characters.length) {
            const observation = recordHanziObservations(
                state.hanziMastery,
                ctx.currentCard.characters, evidence, t,
                ctx.currentCard.recordedHanzi,
                state.session.hanziReviewed
            );
            ctx.currentCard.recordedHanzi = observation.recorded;
        }
		const nextStage = nextStageAfterResult(
			ctx.currentCard.stage || 1,
			effectiveResult,
			forceSequential,
			REVIEW_STAGE_MAX
		);

		if (nextStage <= REVIEW_STAGE_MAX) {
			clearStagedWord(entry.word);
			ctx.stagedQueue.push({
				word: entry.word,
				deck: ctx.currentCard.deck,
				stage: nextStage,
				attemptResult,
				forceSequential,
				sawAgain,
                hanzi: ctx.currentCard.hanzi,
                position: ctx.currentCard.position,
                recordedHanzi: ctx.currentCard.recordedHanzi,
                // This belongs to the completed stage, not the guided recovery.
                failedCharacters: [],
                scriptMode: ctx.currentCard.scriptMode,
				delay: stagedSpacingTurns(nextStage, effectiveResult, STAGED_CARD_SPACING_TURNS)
			});
			const movement =
				effectiveResult === 0
					? `moves to Stage ${nextStage}`
					: effectiveResult === 1
						? `moves to Stage ${nextStage}`
						: effectiveResult === 2
							? `repeats Stage ${nextStage}`
							: 'returns to Stage 1';
			const attemptNote =
				attemptResult > effectiveResult
					? ` Attempt grade remains ${RESULT_LABELS[attemptResult]}.`
					: '';
			playResultSound(effectiveResult);
			setFeedbackMessage(
				`${displayWord}: ${resultLabel}. ${movement}; mixed back into the queue for a later turn.${attemptNote}`,
				effectiveResult === 3 ? 'warning' : 'info'
			);
			rememberShownWord(entry.word);
			ctx.currentCard = null;
			clearCurrentStageCard();
			saveState();
			renderProgress();
			scheduleNextCard();
			return;
		}

		const scheduledResult = attemptResult;
		const scheduledLabel =
			RESULT_LABELS[scheduledResult] || RESULT_LABELS[3];
		const success = scheduledResult < 3;
		if (ctx.currentCard.deck === 'adds')
			state.session.adds = (state.session.adds || 0) + 1;
		if (ctx.currentCard.deck === 'reviews')
			state.session.reviews = (state.session.reviews || 0) + 1;
		if (ctx.currentCard.deck === 'steps')
			state.session.steps = (state.session.steps || 0) + 1;

        if (ctx.currentCard.deck === 'hanzi') {
            state.session.hanzi = (state.session.hanzi || 0) + 1;
            if (!state.session.hanziReviewed.includes(ctx.currentCard.hanzi)) {
                state.session.hanziReviewed.push(ctx.currentCard.hanzi);
            }
            rememberShownWord(entry.word);
            ctx.currentCard = null;
            clearCurrentStageCard();
            saveState();
            playResultSound(scheduledResult);
            setFeedbackMessage(`${displayWord}: character review complete. Vocabulary schedule unchanged.`,
                success ? 'complete' : 'warning');
            renderProgress();
            scheduleNextCard();
            return;
        }
		const previousFsrsState = getEntrySchedulerState(entry);
		const schedule = applyFsrsResult(entry, scheduledResult, t);
		entry.attempts = (entry.attempts || 0) + 1;
		entry.successes = (entry.successes || 0) + (success ? 1 : 0);
		entry.last = t;
		entry.next = t + schedule.intervalSeconds;
		setEntrySchedulerState(entry, schedule.state);

		state.history.unshift({
			ts: t,
			word: entry.word,
			result: scheduledResult,
			displayedResult: effectiveResult,
			deck: ctx.currentCard.deck,
			stage: ctx.currentCard.stage || REVIEW_STAGE_MAX,
			sawAgain,
			fsrs: {
				rating: schedule.rating,
				stability: schedule.stability,
				difficulty: schedule.difficulty,
				state: schedule.state
			}
		});
		state.history = state.history.slice(0, 200);
		recordReviewLog(entry, t, schedule.rating, previousFsrsState);
		rememberShownWord(entry.word);
		ctx.currentCard = null;
		clearCurrentStageCard();
		saveState();
		const schedulingNote =
			scheduledResult !== effectiveResult
				? ` Worst staged-review grade: ${scheduledLabel}.`
				: '';
		playResultSound(scheduledResult);
		setFeedbackMessage(
			`${displayWord}: ${resultLabel}. Final stage passed; next review scheduled.${schedulingNote}`,
			success ? 'complete' : 'warning'
		);
		renderProgress();
		scheduleNextCard();
	}


	function addExtraCards(requested) {
		const sets = getDueSets();
		const limit = sets.extras.length;
		if (limit <= 0) return;
		const requestedCount = Number.isFinite(Number(requested))
			? Math.floor(Number(requested))
			: DEFAULT_EXTRA_CARDS;
		const count = clamp(requestedCount, 1, limit);
		const totalCompleted =
			(state.session.adds || 0) +
			(state.session.reviews || 0) +
			(state.session.steps || 0) +
            (state.session.hanzi || 0);
		state.session.minCards = Math.max(
			state.session.minCards || 0,
			totalCompleted + count
		);
		saveState();
		setFeedbackMessage(
			`Added ${count} extra card${count === 1 ? '' : 's'} to this session.`,
			'good'
		);
		renderProgress();
		nextCard();
	}


	function blacklistCurrentCard() {
		if (!ctx.currentCard) return;
		const word = ctx.currentCard.entry.word;
		const displayWord = ctx.currentCard.studyWord || word;
		if (
			!confirm(
				`Blacklist ${displayWord}? It will be removed from active study until you restore it.`
			)
		)
			return;
		setBlacklistedWord(word, true, ctx.currentCard.row, { save: false });
		playSound('addBlacklist');
		clearStagedWord(word);
		setFeedbackMessage(`${displayWord} blacklisted.`, 'warning');
		ctx.currentCard = null;
		clearCurrentStageCard();
		saveState();
		refreshVocabularyViews();
		nextCard();
	}


	function autoLoadDueCard() {
		if (ctx.currentCard || document.hidden) return;
		const sets = getDueSets();
		const left = getRemainder(sets);
		if (
			ctx.stagedQueue.length ||
			left.adds + left.reviews + left.extras + left.steps + left.hanzi > 0
		)
			nextCard();
	}


	function refreshStudyAfterExternalChange() {
		if (ctx.currentCard) {
			renderProgress();
			return;
		}
		const sets = getDueSets();
		const left = getRemainder(sets);
		if (
			ctx.stagedQueue.length ||
			left.adds + left.reviews + left.extras + left.steps + left.hanzi > 0
		) {
			nextCard();
		} else {
			renderNoCard(sets, left);
		}
	}





	return {
		clearExternalWordStudyState,
		disposeTrainer,
		setPracticeEmptyState,
		setStudyControlsEnabled,
		setFeedbackMessage,
		isMasteredEntry,
		cancelScheduledNextCard,
		nextCard,
		renderCharProgress,
		completeCurrentCard,
		addExtraCards,
		blacklistCurrentCard,
		autoLoadDueCard,
		refreshStudyAfterExternalChange
	};
}
