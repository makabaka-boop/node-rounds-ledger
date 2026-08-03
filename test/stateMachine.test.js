const test = require('node:test');
const assert = require('node:assert/strict');
const { assertTransition } = require('../src/stateMachine/roundStateMachine');
const { StateTransitionError } = require('../src/errors/AppError');

test('scheduled can transition to in_progress', () => {
  assert.doesNotThrow(() => assertTransition('scheduled', 'in_progress'));
});

test('scheduled cannot directly transition to closed', () => {
  assert.throws(
    () => assertTransition('scheduled', 'closed'),
    err => err instanceof StateTransitionError
  );
});

test('scheduled cannot transition to submitted', () => {
  assert.throws(
    () => assertTransition('scheduled', 'submitted'),
    err => err instanceof StateTransitionError
  );
});

test('in_progress can transition to submitted', () => {
  assert.doesNotThrow(() => assertTransition('in_progress', 'submitted'));
});

test('submitted can transition to closed', () => {
  assert.doesNotThrow(() => assertTransition('submitted', 'closed'));
});

test('closed cannot transition anywhere', () => {
  assert.throws(() => assertTransition('closed', 'scheduled'), StateTransitionError);
  assert.throws(() => assertTransition('closed', 'in_progress'), StateTransitionError);
  assert.throws(() => assertTransition('closed', 'submitted'), StateTransitionError);
});
