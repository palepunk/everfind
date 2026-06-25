const assert = require('node:assert/strict');
const test = require('node:test');

const {
  normalizeVoiceLocationForExistingInventory,
  validateVoiceLocationForApply,
} = require('../components/voice/voiceLocationNormalization.ts');

const inventory = {
  rooms: [
    { id: 'room-storage', name: 'Storage Room' },
    { id: 'room-garage', name: 'Garage' },
  ],
  containers: [
    { id: 'container-shelving', name: 'Shelving Unit', roomId: 'room-storage' },
    { id: 'container-workbench', name: 'Workbench', roomId: 'room-garage' },
  ],
  boxes: [
    {
      id: 'box-diy-storage',
      name: 'DIY Box',
      parentType: 'container',
      parentId: 'container-shelving',
    },
    {
      id: 'box-diy-garage',
      name: 'DIY Box',
      parentType: 'container',
      parentId: 'container-workbench',
    },
    {
      id: 'box-cables',
      name: 'Cable Box',
      parentType: 'room',
      parentId: 'room-storage',
    },
  ],
};

test('promotes a misclassified container to an existing box and fills parent location', () => {
  const result = normalizeVoiceLocationForExistingInventory(
    { container: 'DIY Box', details: 'on the Shelving Unit' },
    inventory
  );

  assert.deepEqual(result, {
    room: 'Storage Room',
    container: 'Shelving Unit',
    box: 'DIY Box',
    details: 'on the Shelving Unit',
  });
});

test('keeps an explicit box as the target and fills missing parent location', () => {
  const result = normalizeVoiceLocationForExistingInventory(
    { box: 'Cable Box' },
    inventory
  );

  assert.deepEqual(result, {
    box: 'Cable Box',
    room: 'Storage Room',
  });
});

test('keeps a true container as a container when no exact box matches', () => {
  const result = normalizeVoiceLocationForExistingInventory(
    { container: 'Shelving Unit' },
    inventory
  );

  assert.deepEqual(result, {
    container: 'Shelving Unit',
  });
});

test('uses location details to choose between duplicate box names', () => {
  const result = normalizeVoiceLocationForExistingInventory(
    { container: 'DIY Box', details: 'on the Workbench' },
    inventory
  );

  assert.deepEqual(result, {
    room: 'Garage',
    container: 'Workbench',
    box: 'DIY Box',
    details: 'on the Workbench',
  });
});

test('validation allows an existing box under an existing container', () => {
  const result = validateVoiceLocationForApply(
    { container: 'Shelving Unit', box: 'DIY Box' },
    inventory
  );

  assert.deepEqual(result, {
    status: 'ready',
    issue: null,
  });
});

test('validation blocks a missing box with existing container but no explicit room', () => {
  const result = validateVoiceLocationForApply(
    { container: 'Shelving Unit', box: 'Small Parts Box' },
    inventory
  );

  assert.equal(result.status, 'needs_location');
  assert.match(result.issue, /Small Parts Box does not exist yet/);
});

test('validation allows a missing box with explicit room and existing container', () => {
  const result = validateVoiceLocationForApply(
    { room: 'Storage Room', container: 'Shelving Unit', box: 'Small Parts Box' },
    inventory
  );

  assert.deepEqual(result, {
    status: 'ready',
    issue: null,
  });
});

test('validation allows creating a full missing path when the room is explicit', () => {
  const result = validateVoiceLocationForApply(
    { room: 'Storage Room', container: 'Shelving Unit', box: 'DIY Box' },
    { rooms: [], containers: [], boxes: [] }
  );

  assert.deepEqual(result, {
    status: 'ready',
    issue: null,
  });
});

test('validation blocks a missing container with no room', () => {
  const result = validateVoiceLocationForApply(
    { container: 'Tall Cabinet' },
    inventory
  );

  assert.equal(result.status, 'needs_location');
  assert.match(result.issue, /Tall Cabinet does not exist yet/);
});
