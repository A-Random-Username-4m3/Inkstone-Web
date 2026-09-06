import test from 'node:test';
import assert from 'node:assert/strict';

import { PracticeCanvas, configurePracticeCanvas } from '../js/practice-canvas.js';

test('Reveal only applies its penalty once per character', () => {
	configurePracticeCanvas({ renderPenaltyStatus: () => {} });
	const originalDocument = globalThis.document;
	globalThis.document = {
		querySelector: () => ({ classList: { remove() {} } })
	};
	try {
		const trainer = Object.create(PracticeCanvas.prototype);
		trainer.card = { characters: [{ strokes: ['stroke'] }] };
		trainer.charIndex = 0;
		trainer.missing = [0];
		trainer._penalties = 0;
		trainer.mistakePressure = 0;
		trainer.revealed = false;
		let undoEntries = 0;
		trainer.pushPenaltyUndo = () => { undoEntries += 1; };
		trainer.flashStroke = () => {};
		trainer.setFeedback = () => {};
		trainer.draw = () => {};

		trainer.reveal();
		trainer.reveal();

		assert.equal(trainer.penalties, 4);
		assert.equal(trainer.mistakePressure, 4);
		assert.equal(undoEntries, 1);
	} finally {
		globalThis.document = originalDocument;
	}
});
