export type VoiceLocationInput = {
  house?: string | null;
  room?: string | null;
  container?: string | null;
  box?: string | null;
  details?: string | null;
};

export type VoiceLocationRoom = {
  id: string;
  name?: string | null;
};

export type VoiceLocationContainer = {
  id: string;
  name?: string | null;
  roomId?: string | null;
};

export type VoiceLocationBox = {
  id: string;
  name?: string | null;
  parentType?: string | null;
  parentId?: string | null;
};

type Inventory = {
  rooms: VoiceLocationRoom[];
  containers: VoiceLocationContainer[];
  boxes: VoiceLocationBox[];
};

export type VoiceLocationValidationResult =
  | { status: 'ready'; issue: null }
  | { status: 'needs_location'; issue: string };

const clean = (value?: string | null) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

const compactLocation = (location: VoiceLocationInput) => {
  const compact: VoiceLocationInput = {};
  for (const [key, value] of Object.entries(location)) {
    const cleaned = clean(value);
    if (cleaned) {
      compact[key as keyof VoiceLocationInput] = cleaned;
    }
  }
  return compact;
};

const normalize = (value?: string | null) => clean(value)?.toLowerCase() ?? '';

const isExactNameMatch = (candidate: string | null | undefined, target: string) =>
  Boolean(candidate && normalize(candidate) === normalize(target));

const detailsContainName = (details: string | undefined, name: string | null | undefined) => {
  const normalizedDetails = normalize(details);
  const normalizedName = normalize(name);
  return Boolean(normalizedDetails && normalizedName && normalizedDetails.includes(normalizedName));
};

const findParentContainer = (box: VoiceLocationBox, containers: VoiceLocationContainer[]) => {
  if (box.parentType !== 'container' || !box.parentId) return null;
  return containers.find((container) => container.id === box.parentId) ?? null;
};

const findParentRoom = (
  box: VoiceLocationBox,
  rooms: VoiceLocationRoom[],
  containers: VoiceLocationContainer[]
) => {
  if (box.parentType === 'room' && box.parentId) {
    return rooms.find((room) => room.id === box.parentId) ?? null;
  }

  const parentContainer = findParentContainer(box, containers);
  if (!parentContainer?.roomId) return null;
  return rooms.find((room) => room.id === parentContainer.roomId) ?? null;
};

const scoreBoxForDetails = (
  box: VoiceLocationBox,
  details: string | undefined,
  rooms: VoiceLocationRoom[],
  containers: VoiceLocationContainer[]
) => {
  const parentContainer = findParentContainer(box, containers);
  const parentRoom = findParentRoom(box, rooms, containers);
  let score = 0;
  if (detailsContainName(details, parentContainer?.name)) score += 2;
  if (detailsContainName(details, parentRoom?.name)) score += 1;
  return score;
};

const chooseBox = (
  boxes: VoiceLocationBox[],
  details: string | undefined,
  rooms: VoiceLocationRoom[],
  containers: VoiceLocationContainer[]
) => {
  if (boxes.length <= 1) return boxes[0] ?? null;

  let selected = boxes[0];
  let selectedScore = scoreBoxForDetails(selected, details, rooms, containers);
  for (const box of boxes.slice(1)) {
    const score = scoreBoxForDetails(box, details, rooms, containers);
    if (score > selectedScore) {
      selected = box;
      selectedScore = score;
    }
  }
  return selected;
};

const fillParentNames = (
  location: VoiceLocationInput,
  box: VoiceLocationBox,
  rooms: VoiceLocationRoom[],
  containers: VoiceLocationContainer[],
  options?: { replaceContainer?: boolean }
) => {
  const parentContainer = findParentContainer(box, containers);
  const parentRoom = findParentRoom(box, rooms, containers);

  return {
    ...location,
    room: clean(location.room) ?? clean(parentRoom?.name),
    container: options?.replaceContainer
      ? clean(parentContainer?.name)
      : clean(location.container) ?? clean(parentContainer?.name),
    box: clean(location.box) ?? clean(box.name),
  };
};

export const normalizeVoiceLocationForExistingInventory = (
  location: VoiceLocationInput | undefined,
  { rooms, containers, boxes }: Inventory
): VoiceLocationInput | undefined => {
  if (!location) return location;

  const details = clean(location.details);
  let normalizedLocation: VoiceLocationInput = {
    house: clean(location.house),
    room: clean(location.room),
    container: clean(location.container),
    box: clean(location.box),
    details,
  };

  if (normalizedLocation.box) {
    const matchingBoxes = boxes.filter((box) => isExactNameMatch(box.name, normalizedLocation.box!));
    const selectedBox = chooseBox(matchingBoxes, details, rooms, containers);
    if (selectedBox) {
      normalizedLocation = fillParentNames(normalizedLocation, selectedBox, rooms, containers);
    }
  } else if (normalizedLocation.container) {
    const matchingBoxes = boxes.filter((box) => isExactNameMatch(box.name, normalizedLocation.container!));
    const selectedBox = chooseBox(matchingBoxes, details, rooms, containers);
    if (selectedBox) {
      normalizedLocation = fillParentNames(
        { ...normalizedLocation, box: clean(selectedBox.name) },
        selectedBox,
        rooms,
        containers,
        { replaceContainer: true }
      );
    }
  }

  if (!normalizedLocation.container && details) {
    const mentionedContainer = containers.find((container) => detailsContainName(details, container.name));
    if (mentionedContainer) {
      normalizedLocation.container = clean(mentionedContainer.name);
      if (!normalizedLocation.room && mentionedContainer.roomId) {
        const parentRoom = rooms.find((room) => room.id === mentionedContainer.roomId);
        normalizedLocation.room = clean(parentRoom?.name);
      }
    }
  }

  if (!normalizedLocation.room && details) {
    const mentionedRoom = rooms.find((room) => detailsContainName(details, room.name));
    if (mentionedRoom) {
      normalizedLocation.room = clean(mentionedRoom.name);
    }
  }

  return compactLocation(normalizedLocation);
};

export const validateVoiceLocationForApply = (
  location: VoiceLocationInput | undefined,
  { rooms, containers, boxes }: Inventory
): VoiceLocationValidationResult => {
  const roomName = clean(location?.room);
  const containerName = clean(location?.container);
  const boxName = clean(location?.box);
  const locationLabel = [containerName, boxName].filter(Boolean).join(' > ') || 'the suggested location';

  const existingContainer = containerName
    ? containers.find((container) => isExactNameMatch(container.name, containerName)) ?? null
    : null;
  const existingBox = boxName
    ? boxes.find((box) => isExactNameMatch(box.name, boxName)) ?? null
    : null;

  if (boxName && existingBox) {
    return { status: 'ready', issue: null };
  }

  if (containerName && !existingContainer && !roomName) {
    return {
      status: 'needs_location',
      issue: `I found "${locationLabel}", but ${containerName} does not exist yet and I do not know which room to create it in.`,
    };
  }

  if (boxName && !existingBox && !roomName) {
    return {
      status: 'needs_location',
      issue: `I found "${locationLabel}", but ${boxName} does not exist yet and I do not know which room to create it in.`,
    };
  }

  return { status: 'ready', issue: null };
};
