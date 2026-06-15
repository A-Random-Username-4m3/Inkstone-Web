import { DEFAULT_STUDY_EXAMPLE_LIMIT } from './constants.js';
import { normalizeScriptMode } from './script-mode.js';
import {
	DEFAULT_SCHEDULING,
	fsrsDesiredRetention,
	fsrsMaximumIntervalDays,
	normalizeFsrsParametersText
} from './fsrs.js';

export function createSettingsUi(ctx) {
	const state = ctx.liveState();
	const $ = (...args) => ctx.$(...args);
	const realNow = (...args) => ctx.realNow(...args);
	const debugNowSeconds = (...args) => ctx.debugNowSeconds(...args);
	const formatDateTimeLocal = (...args) => ctx.formatDateTimeLocal(...args);
	const formatDebugTimeStatus = (...args) => ctx.formatDebugTimeStatus(...args);
	const saveState = (...args) => ctx.saveState(...args);
	const resetExpiredSession = (...args) => ctx.resetExpiredSession(...args);
	const renderProgress = (...args) => ctx.renderProgress(...args);
	const renderListEditor = (...args) => ctx.renderListEditor(...args);
	const refreshStudyAfterExternalChange = (...args) => ctx.refreshStudyAfterExternalChange(...args);

	function positiveSetting(key, fallback, min = 0) {
		const value = Number(state.settings?.[key]);
		return Number.isFinite(value) ? Math.max(min, value) : fallback;
	}

	function integerSetting(key, fallback, min = 0) {
		const value = Number(state.settings?.[key]);
		return Number.isFinite(value)
			? Math.max(min, Math.floor(value))
			: fallback;
	}

	function sessionDuration() {
		return Math.max(
			60,
			Math.round(
				positiveSetting(
					'sessionHours',
					DEFAULT_SCHEDULING.sessionHours,
					0.02
				) * 3600
			)
		);
	}

	function learningStepInterval() {
		return Math.max(
			60,
			Math.round(
				positiveSetting(
					'learningStepMinutes',
					DEFAULT_SCHEDULING.learningStepMinutes,
					1
				) * 60
			)
		);
	}

	function relearningStepInterval() {
		return Math.max(
			60,
			Math.round(
				positiveSetting(
					'relearningStepMinutes',
					DEFAULT_SCHEDULING.relearningStepMinutes,
					1
				) * 60
			)
		);
	}

	function renderSettings() {
		if ($('#settingRevealOrder'))
			$('#settingRevealOrder').checked = !!state.settings.revealOrder;
		if ($('#settingSnapStrokes'))
			$('#settingSnapStrokes').checked = !!state.settings.snapStrokes;
		if ($('#settingStage2KeepUserStrokes'))
			$('#settingStage2KeepUserStrokes').checked =
				!!state.settings.stage2KeepUserStrokes;
		if ($('#settingStage3KeepUserStrokes'))
			$('#settingStage3KeepUserStrokes').checked =
				!!state.settings.stage3KeepUserStrokes;
		if ($('#settingMaxAdds'))
			$('#settingMaxAdds').value = state.settings.maxAdds;
		if ($('#settingMaxReviews'))
			$('#settingMaxReviews').value = state.settings.maxReviews;
		if ($('#settingStudyExampleLimit'))
			$('#settingStudyExampleLimit').value = integerSetting(
				'studyExampleLimit',
				DEFAULT_STUDY_EXAMPLE_LIMIT,
				1
			);
		if ($('#settingExamplesActiveListsOnly'))
			$('#settingExamplesActiveListsOnly').checked =
				!!state.settings.examplesActiveListsOnly;
		if ($('#settingScriptMode'))
			$('#settingScriptMode').value = normalizeScriptMode(
				state.settings.scriptMode
			);
		if ($('#settingSessionHours'))
			$('#settingSessionHours').value = positiveSetting(
				'sessionHours',
				DEFAULT_SCHEDULING.sessionHours,
				0.02
			);
		if ($('#settingDesiredRetention'))
			$('#settingDesiredRetention').value = fsrsDesiredRetention();
		if ($('#settingMaximumIntervalDays'))
			$('#settingMaximumIntervalDays').value = fsrsMaximumIntervalDays();
		if ($('#settingLearningStepMinutes'))
			$('#settingLearningStepMinutes').value = positiveSetting(
				'learningStepMinutes',
				DEFAULT_SCHEDULING.learningStepMinutes,
				1
			);
		if ($('#settingRelearningStepMinutes'))
			$('#settingRelearningStepMinutes').value = positiveSetting(
				'relearningStepMinutes',
				DEFAULT_SCHEDULING.relearningStepMinutes,
				1
			);
		if ($('#settingNewCardOrder'))
			$('#settingNewCardOrder').value =
				state.settings.newCardOrder || DEFAULT_SCHEDULING.newCardOrder;
		if ($('#settingReviewOrder'))
			$('#settingReviewOrder').value =
				state.settings.reviewOrder || DEFAULT_SCHEDULING.reviewOrder;
		if ($('#settingNewCardsIgnoreReviewLimit'))
			$('#settingNewCardsIgnoreReviewLimit').checked =
				!!state.settings.newCardsIgnoreReviewLimit;
		if ($('#settingFsrsParameters'))
			$('#settingFsrsParameters').value = normalizeFsrsParametersText(
				state.settings.fsrsParameters
			);
		if ($('#settingDebugNow'))
			$('#settingDebugNow').value = formatDateTimeLocal(debugNowSeconds());
		ctx.setText(
			'#debugTimeStatus',
			formatDebugTimeStatus(debugNowSeconds(), realNow())
		);
		ctx.renderFsrsOptimizationNotice?.();
	}

	function updateSetting(key, value) {
		state.settings[key] = value;
		saveState();
		resetExpiredSession();
		if (ctx.trainer) ctx.trainer.draw();
		renderProgress();
		if (ctx.selectedListId) renderListEditor();
	}

	function updateDebugNow(seconds) {
		state.settings.debugNow = Number.isFinite(Number(seconds))
			? Math.floor(Number(seconds))
			: null;
		saveState();
		resetExpiredSession();
		renderSettings();
		renderProgress();
		if (ctx.selectedListId) renderListEditor();
		refreshStudyAfterExternalChange();
	}

	return {
		sessionDuration,
		learningStepInterval,
		relearningStepInterval,
		renderSettings,
		updateSetting,
		updateDebugNow
	};
}
