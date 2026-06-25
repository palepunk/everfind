const test = require('node:test');
const assert = require('node:assert/strict');

const { isMissingLocalRecordError } = require('../utils/entity/missingRecordRecovery.ts');

test('missing record recovery detects local database not-found errors', () => {
  assert.equal(isMissingLocalRecordError(new Error('Record not found: house-1')), true);
  assert.equal(isMissingLocalRecordError(new Error('record not found: room-2')), true);
  assert.equal(isMissingLocalRecordError(new Error('Diagnostic error: Record rooms#room-2 not found')), true);
});

test('missing record recovery ignores unrelated errors', () => {
  assert.equal(isMissingLocalRecordError(new Error('Permission denied')), false);
  assert.equal(isMissingLocalRecordError(null), false);
});
