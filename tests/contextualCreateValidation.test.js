const assert = require('node:assert/strict');
const test = require('node:test');

const {
  getContextualCreateValidationError,
} = require('../components/entity/contextualCreateValidation.ts');

const containerConfig = {
  type: 'container',
  title: 'Container',
  fields: [
    { key: 'name', label: 'Name' },
    { key: 'description', label: 'Description', optional: true },
  ],
  parent: {
    type: 'room',
    required: true,
  },
};

test('contextual container create without a name returns a sheet-visible validation error', () => {
  const error = getContextualCreateValidationError({
    config: containerConfig,
    type: 'container',
    values: { name: '', description: '' },
    houseId: 'house-1',
    parentType: '',
    parentId: 'room-1',
  });

  assert.equal(error, 'Name is required');
});

test('contextual container create with a name has no validation error', () => {
  const error = getContextualCreateValidationError({
    config: containerConfig,
    type: 'container',
    values: { name: 'Top Shelf Bin', description: '' },
    houseId: 'house-1',
    parentType: '',
    parentId: 'room-1',
  });

  assert.equal(error, null);
});
