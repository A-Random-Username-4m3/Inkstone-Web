'use strict';

import { RESULT_LABELS } from './constants.js';
import { Matcher, distance, strokeLength } from './stroke-matcher.js';

let environment = {
	getSettings: () => ({}),
	renderCharProgress: () => {},
	setFeedbackMessage: () => {},
	playSound: () => {}
};

export function configurePracticeCanvas(options = {}) {
	environment = { ...environment, ...options };
}

const clamp = (x, min, max) => Math.max(min, Math.min(max, x));
const settings = () => environment.getSettings?.() || {};
function renderCharProgress(...args) {
	environment.renderCharProgress?.(...args);
}

function setFeedbackMessage(...args) {
	environment.setFeedbackMessage?.(...args);
}

function playSound(...args) {
	environment.playSound?.(...args);
}

function gradeFromPenaltyCount(penalties) {
	penalties = Math.max(0, Number(penalties) || 0);
	if (penalties <= 2) return 1;
	if (penalties <= 4) return 2;
	return 3;
}

const PATH_CACHE_LIMIT = 1200;
const pathCache = new Map();

function allStrokeIndices(character) {
	return character?.strokes?.map((_, i) => i) || [];
}

function cachePath(key, path) {
	if (pathCache.size >= PATH_CACHE_LIMIT) pathCache.clear();
	pathCache.set(key, path);
	return path;
}

export class PracticeCanvas {
	constructor(canvas, card, onComplete) {
		this.canvas = canvas;
		this.ctx = canvas.getContext('2d');
		this.card = card;
		this.onComplete = onComplete;
		this.stage = card?.stage || 1;
		this.previewTimer = null;
		this.animationFrame = null;
		this.disposed = false;
		this.lastTap = 0;
		this.resetCardState();
		this.bind();
		this.startCharacter();
	}
	bind() {
		this.canvas.onpointerdown = (event) => this.pointerDown(event);
		this.canvas.onpointermove = (event) => this.pointerMove(event);
		this.canvas.onpointerup = (event) => this.pointerUp(event);
		this.canvas.onpointercancel = () => this.pointerCancel();
	}
	get character() {
		return this.card?.characters?.[this.charIndex];
	}
	resetCardState() {
		this.charIndex = 0;
		this.penalties = 0;
		this.acceptedResults = [];
		this.resetCharacterState();
	}
	clearPreviewTimer() {
		if (!this.previewTimer) return;
		clearTimeout(this.previewTimer);
		this.previewTimer = null;
	}
	resetCharacterState() {
		this.clearPreviewTimer();
		this.allStrokeIndices = allStrokeIndices(this.character);
		this.missing = this.allStrokeIndices.slice();
		this.done = [];
		this.userStrokes = [];
		this.acceptedUserStrokes = 0;
		this.acceptedHistory = [];
		this.currentStroke = [];
		this.effects = [];
		this.animating = false;
		this.mistakes = 0;
		this.mistakePressure = 0;
		this.characterStartPenalties = this.penalties;
		this.matcher = this.character ? new Matcher(this.character) : null;
		this.revealed = false;
		this.waitingForContinue = false;
		this.waitingForStart = false;
		this.previewing = false;
		this.previewStartedAt = 0;
		this.previewDuration = 0;
	}
	startCharacter() {
		if (this.disposed) return;
		this.resetCharacterState();
		renderCharProgress(this.charIndex, this.card?.revealedChars || 0);
		this.draw();

		if (!this.character) return;

		if (this.stage === 1) {
			this.waitingForStart = true;
			this.previewing = true;
			this.setFeedback(
				'Stage 1: study the guide, then tap the canvas to start drawing.',
				'info'
			);
			this.draw();
		} else if (this.stage === 2) {
			this.waitingForStart = true;
			this.previewing = true;
			const previewMs = 5000;
			this.previewStartedAt = performance.now();
			this.previewDuration = previewMs;
			this.effects.push({
				type: 'previewClock',
				start: this.previewStartedAt,
				duration: previewMs
			});
			renderCharProgress(this.charIndex, this.card?.revealedChars || 0, {
				previewIndex: this.charIndex
			});
			this.setFeedback(
				'Stage 2: ghost preview shown. Tap to skip or wait 5 seconds.',
				'info'
			);
			this.previewTimer = setTimeout(
				() => this.beginDrawing(),
				previewMs
			);
			this.requestAnimation();
			this.draw();
		} else {
			this.beginDrawing('Stage 3: draw from memory.');
		}
	}
	beginDrawing(message = 'Draw the character.') {
		if (this.disposed || !this.character) return;
		this.clearPreviewTimer();
		this.waitingForStart = false;
		this.previewing = false;
		this.previewStartedAt = 0;
		this.previewDuration = 0;
		renderCharProgress(this.charIndex, this.card?.revealedChars || 0);
		this.effects = this.effects.filter(
			(effect) => effect.type !== 'previewClock'
		);
		this.currentStroke = [];
		this.draw();
		if (this.shouldShowNextStrokeGuide()) {
			const fill =
				this.stage === 2
					? 'rgba(0, 145, 210, .34)'
					: 'rgba(0, 160, 220, .30)';
			const duration = this.stage === 2 ? 900 : 1100;
			this.flashNextMissingStroke(fill, duration);
		}
		this.setFeedback(message, 'info');
	}
	pointerDown(event) {
		if (this.disposed || !this.character) return;
		event.preventDefault();
		if (this.waitingForContinue) {
			this.continueAfterCharacter();
			return;
		}
		if (this.waitingForStart) {
			this.beginDrawing();
			return;
		}
		this.canvas.setPointerCapture?.(event.pointerId);
		this.currentStroke = [this.pointFromEvent(event)];
	}
	pointerMove(event) {
		if (this.disposed) return;
		if (
			!this.currentStroke.length ||
			this.waitingForStart ||
			this.waitingForContinue
		)
			return;
		event.preventDefault();
		const point = this.pointFromEvent(event);
		const last = this.currentStroke[this.currentStroke.length - 1];
		if (distance(last, point) > 0.004) this.currentStroke.push(point);
		this.draw();
	}
	pointerCancel() {
		if (this.disposed || !this.currentStroke.length) return;
		this.currentStroke = [];
		this.draw();
	}

	pointerUp(event) {
		if (this.disposed) return;
		if (
			!this.character ||
			this.waitingForStart ||
			this.waitingForContinue ||
			!this.currentStroke.length
		)
			return;
		if (event) event.preventDefault();
		const stroke = this.currentStroke.slice();
		this.currentStroke = [];
		if (strokeLength(stroke) < 0.02) {
			const time = Date.now();
			if (time - this.lastTap < 450) this.reveal();
			else this.hint();
			this.lastTap = time;
			return;
		}
		this.userStrokes.push(stroke);
		this.gradeStroke(stroke);
		this.draw();
	}
	pointFromEvent(event) {
		const rect = this.canvas.getBoundingClientRect();
		return [
			clamp((event.clientX - rect.left) / rect.width, 0, 1),
			clamp((event.clientY - rect.top) / rect.height, 0, 1)
		];
	}
	strokeGuideUnlocked() {
		if (!settings().revealOrder) return false;
		if (this.stage === 1) return true;
		return this.mistakePressure >= 3;
	}
	canUseStrokeGuide() {
		return (
			!!this.character &&
			!!this.missing.length &&
			this.strokeGuideUnlocked()
		);
	}
	shouldShowNextStrokeGuide() {
		return (
			this.canUseStrokeGuide() &&
			!this.waitingForStart &&
			!this.previewing &&
			!this.waitingForContinue
		);
	}
	keepUserStrokesForCompletedStage() {
		const currentSettings = settings();
		return (
			(this.stage === 2 && !!currentSettings.stage2KeepUserStrokes) ||
			(this.stage === 3 && !!currentSettings.stage3KeepUserStrokes)
		);
	}
	flashNextMissingStroke(fill, duration) {
		if (!this.canUseStrokeGuide()) return false;
		this.flashStroke(
			this.character.strokes[this.missing[0]],
			fill,
			duration
		);
		return true;
	}
	gradeStroke(stroke) {
		const result = this.matcher.match(stroke, this.missing);
		if (!result.indices.length || result.score === -Infinity) {
			this.mistakes += 1;
			this.mistakePressure += 1;
			this.userStrokes.pop();
			this.fadeStroke(stroke, 'rgba(80,0,0,.72)');
			let message = 'Not recognized.';
			if (this.mistakes >= 3) {
				this.penalties += 4;
				const hinted = this.flashNextMissingStroke(
					'rgba(0, 160, 220, .38)',
					850
				);
				message = hinted
					? 'Not recognized. Try the highlighted stroke.'
					: settings().revealOrder
						? 'Not recognized. Try again.'
						: 'Not recognized. Next-stroke hints are disabled in Settings.';
			}
			playSound('wrongStroke');
			this.setFeedback(message, 'danger');
			return;
		}

		const previousMissing = this.missing.slice();
		const newMissing = this.missing.filter(
			(i) => !result.indices.includes(i)
		);
		const newIndices = result.indices.filter((i) =>
			previousMissing.includes(i)
		);

		// The user's input matches strokes that were already drawn.
		if (newMissing.length === previousMissing.length) {
			this.penalties += 1;
			this.mistakePressure += 1;
			this.userStrokes.pop();
			this.fadeStroke(stroke, 'rgba(80,0,0,.72)');
			playSound('wrongStroke');
			this.setFeedback('That stroke is already done.', 'warning');
			this.flashNextMissingStroke('rgba(0, 160, 220, .38)', 850);
			return;
		}

		const acceptedHistoryEntry = {
			stroke: stroke.slice(),
			userStrokeIndex: Math.max(0, this.userStrokes.length - 1),
			previousMissing,
			previousDone: this.done.slice(),
			previousAcceptedUserStrokes: this.acceptedUserStrokes,
			previousPenalties: this.penalties,
			previousMistakes: this.mistakes,
			previousMistakePressure: this.mistakePressure,
			previousAcceptedResultsLength: this.acceptedResults.length,
			previousRevealedChars: this.card?.revealedChars || 0,
			previousWaitingForContinue: this.waitingForContinue
		};

		// Support one drawn gesture completing multiple printed strokes.
		this.missing = newMissing;
		this.done.push(...newIndices);
		this.done = Array.from(new Set(this.done)).sort((a, b) => a - b);
		this.acceptedUserStrokes += 1;
		this.acceptedHistory.push(acceptedHistoryEntry);

		if (settings().snapStrokes && !this.keepUserStrokesForCompletedStage()) {
			this.snapAcceptedStrokes(newIndices, result);
		} else {
			this.fadeStroke(stroke, 'rgba(0,0,0,.55)', 220);
		}

		let message = 'Good.';
		let kind = 'good';
		if (result.warning) {
			this.penalties += result.penalties || 0;
			this.mistakePressure += Math.max(1, result.penalties || 0);
			message = result.warning;
			kind = 'warning';
		}

		const firstMatchedIndex = Math.min(...result.indices);
		const acceptedStrokeSound =
			result.warning || this.missing[0] < firstMatchedIndex
				? 'wrongStroke'
				: 'correctStroke';
		playSound(acceptedStrokeSound);
		if (this.missing.length === 0) {
			const charPenalties = Math.max(
				0,
				this.penalties - this.characterStartPenalties
			);
			const resultGrade = gradeFromPenaltyCount(charPenalties);
			this.acceptedResults.push(resultGrade);
			this.card.revealedChars = Math.max(
				this.card.revealedChars || 0,
				this.charIndex + 1
			);
			renderCharProgress(this.charIndex, this.card.revealedChars);
			this.setFeedback(
				`${this.character.character}: complete (${RESULT_LABELS[resultGrade]}). Tap the canvas to continue.`,
				resultGrade <= 1 ? 'complete' : 'warning'
			);
			if (!this.keepUserStrokesForCompletedStage())
				this.completionGlow(resultGrade);
			this.waitingForContinue = true;
		} else if (this.missing[0] < firstMatchedIndex) {
			const orderPenalty = 2 * (firstMatchedIndex - this.missing[0]);
			this.penalties += orderPenalty;
			this.mistakePressure += Math.max(1, orderPenalty);
			this.flashNextMissingStroke('rgba(255, 172, 0, .42)', 950);
			this.setFeedback(
				result.warning
					? `${message} Stroke order warning.`
					: 'Stroke order warning.',
				'warning'
			);
		} else {
			this.mistakes = 0;
			this.flashNextMissingStroke('rgba(0, 160, 220, .30)', 650);
			this.setFeedback(message, kind);
		}
	}

	continueAfterCharacter() {
		if (!this.waitingForContinue) return;
		this.waitingForContinue = false;
		this.nextCharacterOrComplete();
	}

	nextCharacterOrComplete() {
		this.charIndex += 1;
		if (!this.card || this.charIndex >= this.card.characters.length) {
			const finalResult = this.acceptedResults.length
				? this.acceptedResults.reduce((a, b) => Math.max(a, b), 0)
				: 3;
			this.onComplete(finalResult);
		} else {
			this.startCharacter();
		}
	}
	hint() {
		if (!this.character || !this.missing.length) return;
		if (!this.canUseStrokeGuide()) {
			this.setFeedback(
				settings().revealOrder
					? `Stage ${this.stage} hints unlock after enough mistakes.`
					: 'Next-stroke hints are disabled in Settings.',
				'info'
			);
			return;
		}
		this.flashNextMissingStroke('rgba(0, 160, 220, .40)', 900);
		this.penalties += 1;
		this.setFeedback('Hint shown.', 'warning');
		this.draw();
	}
	reveal() {
		if (!this.character) return;
		this.revealed = true;
		this.penalties += 4;
		this.mistakePressure += 4;
		document.querySelector('#targetWord')?.classList.remove('hidden');
		for (const index of this.missing)
			this.flashStroke(
				this.character.strokes[index],
				'rgba(0, 160, 220, .22)',
				1200
			);
		this.setFeedback(
			'Revealed. Trace the remaining strokes or mark Again.',
			'warning'
		);
		this.draw();
	}
	undo() {
		if (this.waitingForStart || !this.userStrokes.length) return;
		const acceptedCount = Math.max(0, this.acceptedUserStrokes || 0);
		if (!this.waitingForContinue && this.userStrokes.length > acceptedCount) {
			const stroke = this.userStrokes.pop();
			this.fadeStroke(stroke, 'rgba(80,0,0,.55)', 240);
			this.setFeedback('Removed last drawn stroke.', 'danger');
			this.draw();
			return;
		}

		const entry = this.acceptedHistory.pop();
		if (!entry) return;
		const removedStroke = this.userStrokes.splice(
			Math.min(entry.userStrokeIndex, this.userStrokes.length - 1),
			1
		)[0] || entry.stroke;
		this.missing = entry.previousMissing.slice();
		this.done = entry.previousDone.slice();
		this.acceptedUserStrokes = entry.previousAcceptedUserStrokes;
		this.penalties = entry.previousPenalties;
		this.mistakes = entry.previousMistakes;
		this.mistakePressure = entry.previousMistakePressure;
		this.acceptedResults = this.acceptedResults.slice(
			0,
			entry.previousAcceptedResultsLength
		);
		if (this.card) this.card.revealedChars = entry.previousRevealedChars;
		this.waitingForContinue = entry.previousWaitingForContinue;
		this.effects = this.effects.filter(
			(effect) => effect.type === 'previewClock'
		);
		renderCharProgress(this.charIndex, this.card?.revealedChars || 0);
		this.fadeStroke(removedStroke, 'rgba(80,0,0,.55)', 240);
		this.setFeedback('Undid accepted stroke.', 'warning');
		this.draw();
	}
	setFeedback(message, kind = 'info') {
		setFeedbackMessage(message, kind);
		this.effects = this.effects.filter(
			(effect) => effect.type !== 'text'
		);
		this.draw();
	}
	flashStroke(path, fill = 'rgba(0, 160, 220, .36)', duration = 850) {
		if (!path) return;
		this.effects.push({
			type: 'path',
			path,
			fill,
			start: performance.now(),
			duration
		});
		this.requestAnimation();
	}
	fadeStroke(stroke, color = 'rgba(0,0,0,.55)', duration = 260) {
		if (!stroke || stroke.length < 2) return;
		this.effects.push({
			type: 'stroke',
			stroke: stroke.slice(),
			color,
			start: performance.now(),
			duration
		});
		this.requestAnimation();
	}
	snapAcceptedStrokes(indices, result) {
		if (!indices?.length || !this.character) return;
		this.effects.push({
			type: 'snap',
			indices: indices.slice(),
			source: result.source_segment || result.source,
			target: result.target_segment || result.target,
			start: performance.now(),
			duration: 260,
			fill: 'rgba(0,0,0,.88)'
		});
		this.requestAnimation();
	}
	completionGlow(resultGrade) {
		this.effects.push({
			type: 'glow',
			grade: resultGrade,
			indices: this.done.slice(),
			start: performance.now(),
			duration: 620
		});
		this.requestAnimation();
	}
	dispose() {
		this.disposed = true;
		this.clearPreviewTimer();
		if (this.animationFrame) {
			cancelAnimationFrame(this.animationFrame);
			this.animationFrame = null;
		}
		this.effects = [];
		this.animating = false;
		this.canvas.onpointerdown = null;
		this.canvas.onpointermove = null;
		this.canvas.onpointerup = null;
		this.canvas.onpointercancel = null;
	}
	requestAnimation() {
		if (this.disposed || this.animating) return;
		this.animating = true;
		const tick = (timestamp) => {
			if (this.disposed) {
				this.animating = false;
				this.animationFrame = null;
				return;
			}
			const t = timestamp || performance.now();
			this.effects = this.effects.filter(
				(effect) => t - effect.start <= effect.duration
			);
			this.draw(t);
			if (this.effects.length) {
				this.animationFrame = requestAnimationFrame(tick);
			} else {
				this.animating = false;
				this.animationFrame = null;
				this.draw();
			}
		};
		this.animationFrame = requestAnimationFrame(tick);
	}
	draw(timestamp = performance.now()) {
		if (this.disposed) return;
		drawCanvasBase(this.ctx, this.canvas.width);
		if (!this.character) return;
		const activeSnapIndices = new Set();
		for (const effect of this.effects) {
			if (effect.type === 'snap')
				effect.indices.forEach((index) =>
					activeSnapIndices.add(index)
				);
		}

		if (this.previewing) {
			drawPreviewBackdrop(this.ctx, this.canvas.width);
			drawCharacterPaths(
				this.ctx,
				this.character,
				this.allStrokeIndices,
				'#000',
				0.48
			);
			if (
				this.stage === 2 &&
				this.previewStartedAt &&
				this.previewDuration
			) {
				const elapsed = clamp(
					timestamp - this.previewStartedAt,
					0,
					this.previewDuration
				);
				const remaining = Math.max(
					0,
					this.previewDuration - elapsed
				);
				drawPreviewCountdown(
					this.ctx,
					this.canvas.width,
					remaining / this.previewDuration,
					remaining
				);
			}
		} else if (this.stage === 1 && !this.revealed) {
			drawCharacterPaths(
				this.ctx,
				this.character,
				this.allStrokeIndices,
				'rgba(0,0,0,.48)',
				0.22
			);
		}
		if (this.revealed)
			drawCharacterPaths(
				this.ctx,
				this.character,
				this.allStrokeIndices,
				'rgba(0,0,0,.14)'
			);
		if (this.shouldShowNextStrokeGuide()) {
			drawOnePath(
				this.ctx,
				this.character.strokes[this.missing[0]],
				'rgba(0, 145, 210, .32)',
				1
			);
		}
		const keepUserStrokes = this.keepUserStrokesForCompletedStage();
		if (!keepUserStrokes)
			drawCharacterPaths(
				this.ctx,
				this.character,
				this.done.filter((index) => !activeSnapIndices.has(index)),
				'rgba(0,0,0,.88)'
			);

		if (!settings().snapStrokes || keepUserStrokes)
			drawUserStrokes(this.ctx, this.userStrokes, 'rgba(0,0,0,.65)');
		if (settings().snapStrokes && !keepUserStrokes) {
			const unaccepted = this.userStrokes.slice(
				Math.max(0, this.acceptedUserStrokes || 0)
			);
			drawUserStrokes(this.ctx, unaccepted, 'rgba(0,0,0,.35)');
		}

		this.drawEffects(timestamp);
		if (this.currentStroke.length)
			drawUserStrokes(
				this.ctx,
				[this.currentStroke],
				'rgba(0,0,0,.65)'
			);
	}
	drawEffects(timestamp = performance.now()) {
		for (const effect of this.effects) {
			const elapsed = Math.max(0, timestamp - effect.start);
			const progress = clamp(
				elapsed / Math.max(effect.duration, 1),
				0,
				1
			);
			const alpha = 1 - progress;
			if (effect.type === 'path') {
				drawOnePath(this.ctx, effect.path, effect.fill, alpha);
			} else if (effect.type === 'stroke') {
				drawUserStrokes(
					this.ctx,
					[effect.stroke],
					effect.color,
					alpha
				);
			} else if (effect.type === 'snap') {
				drawSnapEffect(
					this.ctx,
					this.character,
					effect,
					easeOutCubic(progress)
				);
			} else if (effect.type === 'glow') {
				drawGradeGlow(
					this.ctx,
					this.character,
					effect.indices,
					effect.grade,
					progress
				);
			}
		}
	}
}

export function drawCanvasBase(ctx, size) {
	ctx.clearRect(0, 0, size, size);
	ctx.save();
	ctx.strokeStyle = 'rgba(127, 111, 95, .28)';
	ctx.lineWidth = 1;
	ctx.setLineDash([6, 8]);
	ctx.beginPath();
	ctx.moveTo(0, 0);
	ctx.lineTo(size, size);
	ctx.moveTo(size, 0);
	ctx.lineTo(0, size);
	ctx.moveTo(size / 2, 0);
	ctx.lineTo(size / 2, size);
	ctx.moveTo(0, size / 2);
	ctx.lineTo(size, size / 2);
	ctx.stroke();
	ctx.restore();
}

function drawPreviewBackdrop(ctx, size) {
	ctx.save();
	ctx.fillStyle = 'rgba(128, 128, 128, .26)';
	ctx.fillRect(0, 0, size, size);
	ctx.restore();
}

function drawPreviewCountdown(ctx, size, fractionRemaining, msRemaining) {
	const radius = Math.max(20, size * 0.055);
	const margin = Math.max(18, size * 0.035);
	const x = size - radius - margin;
	const y = radius + margin;
	const lineWidth = Math.max(4, size * 0.008);
	const fraction = clamp(fractionRemaining, 0, 1);
	const seconds = Math.max(0, Math.ceil(msRemaining / 1000));
	ctx.save();

	ctx.shadowColor = 'rgba(2, 22, 48, .28)';
	ctx.shadowBlur = Math.max(8, radius * 0.36);
	ctx.shadowOffsetY = Math.max(1, radius * 0.08);
	ctx.beginPath();
	ctx.arc(x, y, radius + lineWidth * 2.1, 0, Math.PI * 2);
	const shell = ctx.createLinearGradient(
		x,
		y - radius * 1.35,
		x,
		y + radius * 1.35
	);
	shell.addColorStop(0, 'rgba(244, 252, 255, .86)');
	shell.addColorStop(0.46, 'rgba(178, 224, 250, .72)');
	shell.addColorStop(0.48, 'rgba(95, 171, 224, .58)');
	shell.addColorStop(1, 'rgba(10, 77, 137, .58)');
	ctx.fillStyle = shell;
	ctx.fill();

	ctx.shadowColor = 'transparent';
	ctx.lineWidth = Math.max(1, lineWidth * 0.36);
	ctx.strokeStyle = 'rgba(255, 255, 255, .78)';
	ctx.stroke();

	ctx.lineWidth = lineWidth;
	ctx.strokeStyle = 'rgba(255, 255, 255, .52)';
	ctx.beginPath();
	ctx.arc(x, y, radius, 0, Math.PI * 2);
	ctx.stroke();

	ctx.strokeStyle = 'rgba(5, 66, 122, .90)';
	ctx.lineCap = 'round';
	ctx.beginPath();
	ctx.arc(
		x,
		y,
		radius,
		-Math.PI / 2,
		-Math.PI / 2 + Math.PI * 2 * fraction
	);
	ctx.stroke();

	ctx.beginPath();
	ctx.ellipse(
		x - radius * 0.18,
		y - radius * 0.35,
		radius * 0.54,
		radius * 0.24,
		-0.2,
		0,
		Math.PI * 2
	);
	ctx.fillStyle = 'rgba(255, 255, 255, .42)';
	ctx.fill();

	ctx.fillStyle = 'rgba(4, 42, 78, .92)';
	const fontSize = Math.max(13, Math.round(radius * 0.78));
	ctx.font =
		`700 ${fontSize}px "Segoe UI", system-ui, -apple-system, ` +
		'BlinkMacSystemFont, sans-serif';
	ctx.textAlign = 'center';
	ctx.textBaseline = 'middle';
	ctx.fillText(String(seconds), x, y + 0.5);
	ctx.restore();
}

function drawUserStrokes(ctx, strokes, color, alpha = 1) {
	ctx.save();
	ctx.globalAlpha = alpha;
	ctx.strokeStyle = color;
	ctx.lineWidth = ctx.canvas.width / 28;
	ctx.lineCap = 'round';
	ctx.lineJoin = 'round';
	for (const stroke of strokes) {
		if (stroke.length < 2) continue;
		ctx.beginPath();
		ctx.moveTo(
			stroke[0][0] * ctx.canvas.width,
			stroke[0][1] * ctx.canvas.height
		);
		for (let i = 1; i < stroke.length; i++)
			ctx.lineTo(
				stroke[i][0] * ctx.canvas.width,
				stroke[i][1] * ctx.canvas.height
			);
		ctx.stroke();
	}
	ctx.restore();
}

export function drawCharacterPaths(ctx, character, indices, fillStyle, alpha = 1) {
	for (const index of indices)
		drawOnePath(ctx, character.strokes[index], fillStyle, alpha);
}

function drawOnePath(ctx, path, fillStyle, alpha = 1) {
	const p = getCachedPath(ctx, path);
	ctx.save();
	ctx.globalAlpha = alpha;
	ctx.fillStyle = fillStyle;
	ctx.strokeStyle = fillStyle;
	ctx.fill(p);
	ctx.restore();
}

function getCachedPath(ctx, path) {
	const width = ctx.canvas.width;
	const height = ctx.canvas.height;
	const key = `${width}x${height}:${path}`;
	const cached = pathCache.get(key);
	if (cached) return cached;
	const p = new Path2D();
	const tokens = path.match(/[A-Za-z]|-?\d+(?:\.\d+)?/g) || [];
	let i = 0;
	const point = () => {
		const x = Number(tokens[i++]);
		const y = Number(tokens[i++]);
		return [(x / 1024) * width, ((900 - y) / 1024) * height];
	};
	while (i < tokens.length) {
		const command = tokens[i++];
		if (command === 'M') {
			const [x, y] = point();
			p.moveTo(x, y);
		} else if (command === 'L') {
			const [x, y] = point();
			p.lineTo(x, y);
		} else if (command === 'Q') {
			const [x1, y1] = point();
			const [x, y] = point();
			p.quadraticCurveTo(x1, y1, x, y);
		} else if (command === 'C') {
			const [x1, y1] = point();
			const [x2, y2] = point();
			const [x, y] = point();
			p.bezierCurveTo(x1, y1, x2, y2, x, y);
		} else if (command === 'Z') p.closePath();
		else break;
	}
	return cachePath(key, p);
}

function easeOutCubic(t) {
	return 1 - Math.pow(1 - clamp(t, 0, 1), 3);
}

function blendPoint(a, b, t) {
	return [(1 - t) * a[0] + t * b[0], (1 - t) * a[1] + t * b[1]];
}

function segmentAngle(pair) {
	return Math.atan2(pair[1][1] - pair[0][1], pair[1][0] - pair[0][0]);
}

function drawSnapEffect(ctx, character, effect, progress) {
	const alpha = 0.35 + 0.65 * progress;
	const source = normalizeSegment(effect.source);
	const target = normalizeSegment(effect.target);
	if (!source || !target) {
		drawCharacterPaths(
			ctx,
			character,
			effect.indices,
			effect.fill,
			alpha
		);
		return;
	}

	const destination = [
		blendPoint(source[0], target[0], progress),
		blendPoint(source[1], target[1], progress)
	];
	const size = ctx.canvas.width;
	const srcLength = Math.max(0.001, distance(target[0], target[1]));
	const dstLength = Math.max(
		0.001,
		distance(destination[0], destination[1])
	);
	const scale = clamp(dstLength / srcLength, 0.55, 1.8);
	const rotation = segmentAngle(destination) - segmentAngle(target);

	ctx.save();
	ctx.translate(destination[0][0] * size, destination[0][1] * size);
	ctx.rotate(rotation);
	ctx.scale(scale, scale);
	ctx.translate(-target[0][0] * size, -target[0][1] * size);
	drawCharacterPaths(ctx, character, effect.indices, effect.fill, alpha);
	ctx.restore();
}

function normalizeSegment(segment) {
	if (!Array.isArray(segment) || segment.length < 2) return null;
	const a = segment[0],
		b = segment[segment.length - 1];
	if (!Array.isArray(a) || !Array.isArray(b)) return null;
	return [
		[Number(a[0]), Number(a[1])],
		[Number(b[0]), Number(b[1])]
	];
}


function drawGradeGlow(ctx, character, indices, grade, progress) {
	const fill =
		[
			'rgba(32,160,255,.55)',
			'rgba(54,180,68,.50)',
			'rgba(240,165,30,.48)',
			'rgba(210,48,40,.48)'
		][grade] || 'rgba(32,160,255,.55)';
	const alpha = Math.sin(Math.PI * clamp(progress, 0, 1));
	ctx.save();
	ctx.globalAlpha = alpha;
	ctx.shadowColor = fill;
	ctx.shadowBlur = ctx.canvas.width / 24;
	drawCharacterPaths(ctx, character, indices, fill, 0.42);
	ctx.restore();
}
