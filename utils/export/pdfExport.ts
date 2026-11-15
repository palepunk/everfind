import * as FileSystem from 'expo-file-system/legacy';
import * as ImageManipulator from 'expo-image-manipulator';
import * as Print from 'expo-print';
import { PDFDocument } from 'pdf-lib';
import type { CurrencyCode } from '../currency';
import { formatCurrencyFromCents, loadCurrencyPreference } from '../currency';
import { toAbsoluteImagePath } from '../imageUtils';
import type { ItemImageRecord } from '../itemImages';
import {
  getPowerSyncRepositoryBoxes,
  getPowerSyncRepositoryContainers,
  getPowerSyncRepositoryHouses,
  getPowerSyncRepositoryItemImages,
  getPowerSyncRepositoryItems,
  getPowerSyncRepositoryRooms,
} from '../powersync/repository';

type HouseRecord = {
  id: string;
  name: string;
  address: string | null;
  notes: string | null;
  imagePath: string | null;
};

type RoomRecord = {
  id: string;
  houseId: string;
  name: string;
  description: string | null;
  imagePath: string | null;
};

type ContainerRecord = {
  id: string;
  houseId: string;
  roomId: string;
  name: string;
  description: string | null;
  imagePath: string | null;
};

type BoxRecord = {
  id: string;
  houseId: string;
  parentType: string | null;
  parentId: string | null;
  name: string;
  description: string | null;
  imagePath: string | null;
  tags: string;
};

type ItemRecord = {
  id: string;
  houseId: string;
  parentType: string | null;
  parentId: string | null;
  name: string;
  description: string | null;
  imagePath: string | null;
  tags: string;
  purchasePriceCents: number | null;
  notes: string | null;
};

type ExportCounts = {
  houses: number;
  rooms: number;
  containers: number;
  boxes: number;
  items: number;
  images: number;
  unavailableImages: number;
};

type ResolvedImage = {
  status: 'embedded' | 'missing';
  src: string | null;
  alt: string;
};

type GeneratePdfExportResult = {
  fileUri: string;
  fileName: string;
  counts: ExportCounts;
};

type PdfExportOptions = {
  houseIds?: string[];
};

type ExportSnapshot = {
  houses: HouseRecord[];
  rooms: RoomRecord[];
  containers: ContainerRecord[];
  boxes: BoxRecord[];
  items: ItemRecord[];
  itemImagesByItemId: Map<string, ItemImageRecord[]>;
};

type ExportChunk = {
  snapshot: ExportSnapshot;
  counts: ExportCounts;
};

const compareByName = <T extends { name: string; id: string }>(left: T, right: T) => {
  const byName = left.name.localeCompare(right.name, undefined, { sensitivity: 'base' });
  if (byName !== 0) return byName;
  return left.id.localeCompare(right.id);
};

const compareItemImages = (left: ItemImageRecord, right: ItemImageRecord) => {
  if (left.position !== right.position) {
    return left.position - right.position;
  }
  return left.id.localeCompare(right.id);
};

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const getMimeType = (path: string) => {
  const sanitized = path.split('?')[0].toLowerCase();
  if (sanitized.endsWith('.png')) return 'image/png';
  if (sanitized.endsWith('.gif')) return 'image/gif';
  if (sanitized.endsWith('.webp')) return 'image/webp';
  if (sanitized.endsWith('.bmp')) return 'image/bmp';
  if (sanitized.endsWith('.heic')) return null;
  if (sanitized.endsWith('.heif')) return null;
  return 'image/jpeg';
};

const MAX_EMBED_DIMENSION = 720;
const EMBED_COMPRESS = 0.65;
const TARGET_RECORDS_PER_CHUNK = 140;

const resolveImage = async (
  imagePath: string | null | undefined,
  alt: string,
  counts: ExportCounts
): Promise<ResolvedImage | null> => {
  if (!imagePath) return null;

  counts.images += 1;

  try {
    const absolutePath = toAbsoluteImagePath(imagePath);
    const info = await FileSystem.getInfoAsync(absolutePath);
    if (!info.exists) {
      counts.unavailableImages += 1;
      return { status: 'missing', src: null, alt };
    }
    const mimeType = getMimeType(absolutePath);
    if (!mimeType) {
      counts.unavailableImages += 1;
      return { status: 'missing', src: null, alt };
    }

    let base64: string;
    try {
      const manipulated = await ImageManipulator.manipulateAsync(
        absolutePath,
        [{ resize: { width: MAX_EMBED_DIMENSION } }],
        {
          compress: EMBED_COMPRESS,
          base64: true,
          format: ImageManipulator.SaveFormat.JPEG,
        }
      );
      base64 = manipulated.base64 ?? '';
    } catch {
      base64 = await FileSystem.readAsStringAsync(absolutePath, {
        encoding: FileSystem.EncodingType.Base64,
      });
    }

    if (!base64) {
      counts.unavailableImages += 1;
      return { status: 'missing', src: null, alt };
    }

    return {
      status: 'embedded',
      src: `data:image/jpeg;base64,${base64}`,
      alt,
    };
  } catch {
    counts.unavailableImages += 1;
    return { status: 'missing', src: null, alt };
  }
};

const buildParentPath = (
  item: ItemRecord,
  houseById: Map<string, HouseRecord>,
  roomById: Map<string, RoomRecord>,
  containerById: Map<string, ContainerRecord>,
  boxById: Map<string, BoxRecord>
) => {
  const house = houseById.get(item.houseId);
  const parts = house ? [house.name] : [];

  if (item.parentType === 'room' && item.parentId) {
    const room = roomById.get(item.parentId);
    if (room) parts.push(room.name);
    return parts.join(' > ');
  }

  if (item.parentType === 'container' && item.parentId) {
    const container = containerById.get(item.parentId);
    const room = container ? roomById.get(container.roomId) : null;
    if (room) parts.push(room.name);
    if (container) parts.push(container.name);
    return parts.join(' > ');
  }

  if (item.parentType === 'box' && item.parentId) {
    const box = boxById.get(item.parentId);
    if (box?.parentType === 'container' && box.parentId) {
      const container = containerById.get(box.parentId);
      const room = container ? roomById.get(container.roomId) : null;
      if (room) parts.push(room.name);
      if (container) parts.push(container.name);
    } else if (box?.parentType === 'room' && box.parentId) {
      const room = roomById.get(box.parentId);
      if (room) parts.push(room.name);
    }
    if (box) parts.push(box.name);
  }

  return parts.join(' > ');
};

const renderSimpleDocumentHtml = async (
  snapshot: ExportSnapshot,
  exportedAtLabel: string,
  currency: CurrencyCode,
  counts: ExportCounts,
  options?: { includeTitlePage?: boolean }
) => {
  const houseById = new Map(snapshot.houses.map((house) => [house.id, house]));
  const roomById = new Map(snapshot.rooms.map((room) => [room.id, room]));
  const containerById = new Map(snapshot.containers.map((container) => [container.id, container]));
  const boxById = new Map(snapshot.boxes.map((box) => [box.id, box]));

  const groupBy = <T,>(records: T[], getKey: (record: T) => string | null | undefined) => {
    const result = new Map<string, T[]>();
    records.forEach((record) => {
      const key = getKey(record);
      if (!key) return;
      const current = result.get(key) ?? [];
      current.push(record);
      result.set(key, current);
    });
    return result;
  };

  const roomsByHouseId = groupBy(snapshot.rooms, (room) => room.houseId);
  const containersByRoomId = groupBy(snapshot.containers, (container) => container.roomId);
  const roomBoxesByRoomId = groupBy(
    snapshot.boxes.filter((box) => box.parentType === 'room'),
    (box) => box.parentId
  );
  const containerBoxesByContainerId = groupBy(
    snapshot.boxes.filter((box) => box.parentType === 'container'),
    (box) => box.parentId
  );
  const houseBoxesByHouseId = groupBy(
    snapshot.boxes.filter((box) => !box.parentType || !box.parentId),
    (box) => box.houseId
  );
  const itemsByRoomId = groupBy(
    snapshot.items.filter((item) => item.parentType === 'room'),
    (item) => item.parentId
  );
  const itemsByContainerId = groupBy(
    snapshot.items.filter((item) => item.parentType === 'container'),
    (item) => item.parentId
  );
  const itemsByBoxId = groupBy(
    snapshot.items.filter((item) => item.parentType === 'box'),
    (item) => item.parentId
  );
  const houseLooseItemsByHouseId = groupBy(
    snapshot.items.filter((item) => !item.parentType || !item.parentId),
    (item) => item.houseId
  );

  const renderImage = (image: ResolvedImage | null | undefined, className: string) => {
    if (!image) return '';
    if (image.status === 'embedded' && image.src) {
      return `<img class="${className}" src="${image.src}" alt="${escapeHtml(image.alt)}" />`;
    }
    return `<div class="${className} missing-thumb">Image unavailable</div>`;
  };

  const renderImageGallery = (images: ResolvedImage[]) => {
    if (!images.length) return '';
    return `
      <div class="image-gallery">
        ${images
          .map((image) =>
            image.status === 'embedded' && image.src
              ? `<img class="gallery-thumb" src="${image.src}" alt="${escapeHtml(image.alt)}" />`
              : '<div class="gallery-thumb missing-thumb">Image unavailable</div>'
          )
          .join('')}
      </div>
    `;
  };

  const renderItemCard = async (item: ItemRecord) => {
    const orderedImages = snapshot.itemImagesByItemId.get(item.id) ?? [];
    const imageRefs =
      orderedImages.length > 0
        ? orderedImages.map((image, index) =>
            resolveImage(image.imagePath, `${item.name} image ${index + 1}`, counts)
          )
        : [resolveImage(item.imagePath, `${item.name} cover image`, counts)];
    const resolvedImages = (await Promise.all(imageRefs)).filter(
      (image): image is ResolvedImage => Boolean(image)
    );
    const parentPath = buildParentPath(item, houseById, roomById, containerById, boxById);

    return `
      <div class="line-card item-card">
        <div class="line-content">
          <div class="line-copy">
            <div class="line-title">Item: ${escapeHtml(item.name)}</div>
            ${parentPath ? `<div class="line-meta">Location: ${escapeHtml(parentPath)}</div>` : ''}
            ${item.description ? `<div class="line-meta">Description: ${escapeHtml(item.description)}</div>` : ''}
            ${item.tags ? `<div class="line-meta">Tags: ${escapeHtml(item.tags)}</div>` : ''}
            ${item.notes ? `<div class="line-meta">Notes: ${escapeHtml(item.notes)}</div>` : ''}
            ${item.purchasePriceCents !== null && item.purchasePriceCents !== undefined ? `<div class="line-meta">Purchase price: ${escapeHtml(formatCurrencyFromCents(item.purchasePriceCents, currency))}</div>` : ''}
          </div>
          <div class="line-image-column">
            ${renderImageGallery(resolvedImages)}
          </div>
        </div>
      </div>
    `;
  };

  const renderBoxSection = async (box: BoxRecord) => {
    const image = await resolveImage(box.imagePath, `${box.name} cover image`, counts);
    const itemCards = await Promise.all(
      [...(itemsByBoxId.get(box.id) ?? [])].sort(compareByName).map(renderItemCard)
    );

    return `
      <div class="subsection">
        <div class="line-card">
          <div class="line-content">
            <div class="line-copy">
              <div class="line-title">Box: ${escapeHtml(box.name)}</div>
              ${box.tags ? `<div class="line-meta">Tags: ${escapeHtml(box.tags)}</div>` : ''}
              ${box.description ? `<div class="line-meta">Description: ${escapeHtml(box.description)}</div>` : ''}
            </div>
            <div class="line-image-column">
              ${renderImage(image, 'thumb')}
            </div>
          </div>
        </div>
        ${itemCards.join('')}
      </div>
    `;
  };

  const renderContainerSection = async (container: ContainerRecord) => {
    const image = await resolveImage(container.imagePath, `${container.name} cover image`, counts);
    const looseItemCards = await Promise.all(
      [...(itemsByContainerId.get(container.id) ?? [])].sort(compareByName).map(renderItemCard)
    );
    const boxSections = await Promise.all(
      [...(containerBoxesByContainerId.get(container.id) ?? [])].sort(compareByName).map(renderBoxSection)
    );

    return `
      <div class="subsection">
        <div class="line-card">
          <div class="line-content">
            <div class="line-copy">
              <div class="line-title">Container: ${escapeHtml(container.name)}</div>
              ${container.description ? `<div class="line-meta">Description: ${escapeHtml(container.description)}</div>` : ''}
            </div>
            <div class="line-image-column">
              ${renderImage(image, 'thumb')}
            </div>
          </div>
        </div>
        ${looseItemCards.join('')}
        ${boxSections.join('')}
      </div>
    `;
  };

  const renderRoomSection = async (room: RoomRecord) => {
    const image = await resolveImage(room.imagePath, `${room.name} cover image`, counts);
    const looseItemCards = await Promise.all(
      [...(itemsByRoomId.get(room.id) ?? [])].sort(compareByName).map(renderItemCard)
    );
    const containerSections = await Promise.all(
      [...(containersByRoomId.get(room.id) ?? [])].sort(compareByName).map(renderContainerSection)
    );
    const roomBoxSections = await Promise.all(
      [...(roomBoxesByRoomId.get(room.id) ?? [])].sort(compareByName).map(renderBoxSection)
    );

    return `
      <div class="group room-group">
        <div class="line-card room-card">
          <div class="line-content">
            <div class="line-copy">
              <div class="line-title">Room: ${escapeHtml(room.name)}</div>
              ${room.description ? `<div class="line-meta">Description: ${escapeHtml(room.description)}</div>` : ''}
            </div>
            <div class="line-image-column">
              ${renderImage(image, 'thumb')}
            </div>
          </div>
        </div>
        ${looseItemCards.join('')}
        ${containerSections.join('')}
        ${roomBoxSections.join('')}
      </div>
    `;
  };

  const houseSections = await Promise.all(
    snapshot.houses.sort(compareByName).map(async (house) => {
      const houseImage = await resolveImage(house.imagePath, `${house.name} cover image`, counts);
      const roomSections = await Promise.all(
        [...(roomsByHouseId.get(house.id) ?? [])].sort(compareByName).map(renderRoomSection)
      );
      const houseLooseItemCards = await Promise.all(
        [...(houseLooseItemsByHouseId.get(house.id) ?? [])].sort(compareByName).map(renderItemCard)
      );
      const houseBoxSections = await Promise.all(
        [...(houseBoxesByHouseId.get(house.id) ?? [])].sort(compareByName).map(renderBoxSection)
      );

      return `
        <div class="house-section">
          <div class="house-card">
            <div class="house-header">
              <div class="house-copy">
                <h2>${escapeHtml(house.name)}</h2>
                ${house.address ? `<p><strong>Address:</strong> ${escapeHtml(house.address)}</p>` : ''}
                ${house.notes ? `<p><strong>Notes:</strong> ${escapeHtml(house.notes)}</p>` : ''}
              </div>
              ${renderImage(houseImage, 'hero')}
            </div>
          </div>
          ${houseLooseItemCards.length ? `<div class="group"><div class="group-title">Loose items</div>${houseLooseItemCards.join('')}</div>` : ''}
          ${houseBoxSections.length ? `<div class="group"><div class="group-title">House boxes</div>${houseBoxSections.join('')}</div>` : ''}
          ${roomSections.join('')}
        </div>
      `;
    })
  );

  const includeTitlePage = options?.includeTitlePage ?? true;

  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <style>
          @page { margin: 24px; }
          body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            color: #111827;
            background: #ffffff;
            margin: 0;
            font-size: 12px;
            line-height: 1.45;
          }
          * { box-sizing: border-box; }
          h1, h2 { margin: 0 0 8px 0; }
          .title-page { margin-bottom: 24px; }
          .house-section {
            page-break-before: always;
            break-before: page;
          }
          .house-section:first-of-type {
            page-break-before: auto;
            break-before: auto;
          }
          p { margin: 6px 0; }
          .house-card,
          .group,
          .line-card {
            border: 1px solid #d8e1ea;
            border-radius: 12px;
            background: #ffffff;
          }
          .house-card,
          .group {
            margin-top: 14px;
            padding: 14px;
          }
          .house-header {
            width: 100%;
          }
          .house-copy {
            display: inline-block;
            vertical-align: top;
            width: 72%;
            padding-right: 12px;
          }
          .hero {
            display: inline-block;
            vertical-align: top;
            width: 24%;
            max-height: 120px;
            object-fit: contain;
            border-radius: 10px;
            border: 1px solid #d8e1ea;
          }
          .group-title {
            font-size: 11px;
            text-transform: uppercase;
            letter-spacing: 0.08em;
            color: #64748b;
            margin-bottom: 10px;
          }
          .room-group {
            padding: 12px;
          }
          .room-card {
            margin-top: 0;
          }
          .subsection {
            margin-top: 10px;
            padding-left: 10px;
            border-left: 2px solid #e2e8f0;
          }
          .line-card {
            padding: 10px 12px;
            margin-top: 8px;
            width: 100%;
          }
          .item-card {
            background: #fcfcfd;
          }
          .line-content {
            width: 100%;
            font-size: 0;
          }
          .line-copy {
            display: inline-block;
            vertical-align: top;
            width: 72%;
            padding-right: 12px;
            font-size: 12px;
          }
          .line-image-column {
            display: inline-block;
            vertical-align: top;
            width: 24%;
            text-align: right;
            font-size: 12px;
          }
          .line-title {
            font-weight: 700;
            color: #0f172a;
          }
          .line-meta {
            color: #475569;
            margin-top: 2px;
          }
          .thumb {
            display: inline-block;
            vertical-align: top;
            width: 84px;
            height: 84px;
            object-fit: cover;
            border-radius: 10px;
          }
          .image-gallery {
            font-size: 0;
            width: 100%;
            text-align: right;
          }
          .gallery-thumb {
            display: inline-block;
            width: 84px;
            height: 84px;
            object-fit: cover;
            border-radius: 10px;
            margin-left: 8px;
            margin-bottom: 8px;
          }
          .missing-thumb {
            color: #64748b;
            text-align: center;
            font-size: 10px;
            line-height: 1.3;
            padding: 8px;
            width: 84px;
            min-height: 84px;
            margin-left: auto;
            background: #f8fafc;
            border-radius: 10px;
          }
        </style>
      </head>
      <body>
        ${includeTitlePage ? `
        <div class="title-page">
          <h1>everfind Inventory Export</h1>
          <p>Generated on ${escapeHtml(exportedAtLabel)}</p>
          <p>
            ${counts.houses} houses, ${counts.rooms} rooms, ${counts.containers} containers,
            ${counts.boxes} boxes, ${counts.items} items, ${counts.images} image references
          </p>
        </div>
        ` : ''}
        ${houseSections.join('') || '<p>No exportable house data found.</p>'}
      </body>
    </html>
  `;
};

const renderPdfToFile = async (html: string) => await Print.printToFileAsync({ html });

const createExportCounts = (snapshot: ExportSnapshot): ExportCounts => ({
  houses: snapshot.houses.length,
  rooms: snapshot.rooms.length,
  containers: snapshot.containers.length,
  boxes: snapshot.boxes.length,
  items: snapshot.items.length,
  images: 0,
  unavailableImages: 0,
});

const sliceSnapshotByHouseIds = (snapshot: ExportSnapshot, houseIds: string[]): ExportSnapshot => {
  const allowedHouseIds = new Set(houseIds);
  const houses = snapshot.houses.filter((house) => allowedHouseIds.has(house.id));
  const rooms = snapshot.rooms.filter((room) => allowedHouseIds.has(room.houseId));
  const containers = snapshot.containers.filter((container) => allowedHouseIds.has(container.houseId));
  const boxes = snapshot.boxes.filter((box) => allowedHouseIds.has(box.houseId));
  const items = snapshot.items.filter((item) => allowedHouseIds.has(item.houseId));

  const itemIdSet = new Set(items.map((item) => item.id));
  const itemImagesByItemId = new Map<string, ItemImageRecord[]>();
  items.forEach((item) => {
    itemImagesByItemId.set(item.id, snapshot.itemImagesByItemId.get(item.id) ?? []);
  });
  snapshot.itemImagesByItemId.forEach((value, key) => {
    if (itemIdSet.has(key) && !itemImagesByItemId.has(key)) {
      itemImagesByItemId.set(key, value);
    }
  });

  return {
    houses,
    rooms,
    containers,
    boxes,
    items,
    itemImagesByItemId,
  };
};

const estimateHouseWeight = (snapshot: ExportSnapshot, houseId: string) => {
  const houseImages = snapshot.houses.filter((house) => house.id === houseId && house.imagePath).length;
  const roomImages = snapshot.rooms.filter((room) => room.houseId === houseId && room.imagePath).length;
  const containerImages = snapshot.containers.filter(
    (container) => container.houseId === houseId && container.imagePath
  ).length;
  const boxImages = snapshot.boxes.filter((box) => box.houseId === houseId && box.imagePath).length;
  const houseItems = snapshot.items.filter((item) => item.houseId === houseId);
  const itemImages = houseItems.reduce((total, item) => {
    const images = snapshot.itemImagesByItemId.get(item.id) ?? [];
    return total + Math.max(images.length, item.imagePath ? 1 : 0);
  }, 0);

  return (
    1 +
    snapshot.rooms.filter((room) => room.houseId === houseId).length +
    snapshot.containers.filter((container) => container.houseId === houseId).length +
    snapshot.boxes.filter((box) => box.houseId === houseId).length +
    houseItems.length +
    houseImages +
    roomImages +
    containerImages +
    boxImages +
    itemImages
  );
};

const buildExportChunks = (snapshot: ExportSnapshot): ExportChunk[] => {
  const sortedHouses = [...snapshot.houses].sort(compareByName);
  const chunks: ExportChunk[] = [];
  let currentHouseIds: string[] = [];
  let currentWeight = 0;

  sortedHouses.forEach((house) => {
    const houseWeight = estimateHouseWeight(snapshot, house.id);
    const shouldStartNewChunk =
      currentHouseIds.length > 0 && currentWeight + houseWeight > TARGET_RECORDS_PER_CHUNK;

    if (shouldStartNewChunk) {
      const chunkSnapshot = sliceSnapshotByHouseIds(snapshot, currentHouseIds);
      chunks.push({ snapshot: chunkSnapshot, counts: createExportCounts(chunkSnapshot) });
      currentHouseIds = [];
      currentWeight = 0;
    }

    currentHouseIds.push(house.id);
    currentWeight += houseWeight;
  });

  if (currentHouseIds.length > 0) {
    const chunkSnapshot = sliceSnapshotByHouseIds(snapshot, currentHouseIds);
    chunks.push({ snapshot: chunkSnapshot, counts: createExportCounts(chunkSnapshot) });
  }

  return chunks;
};

const mergePdfUris = async (chunkUris: string[], outputUri: string) => {
  const mergedPdf = await PDFDocument.create();

  for (const chunkUri of chunkUris) {
    const chunkBase64 = await FileSystem.readAsStringAsync(chunkUri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    const chunkPdf = await PDFDocument.load(chunkBase64);
    const copiedPages = await mergedPdf.copyPages(chunkPdf, chunkPdf.getPageIndices());
    copiedPages.forEach((page) => {
      mergedPdf.addPage(page);
    });
  }

  const mergedBase64 = await mergedPdf.saveAsBase64({ dataUri: false });
  await FileSystem.writeAsStringAsync(outputUri, mergedBase64, {
    encoding: FileSystem.EncodingType.Base64,
  });
};

export const generateInventoryPdfExport = async (
  options?: PdfExportOptions
): Promise<GeneratePdfExportResult> => {
  const currency = await loadCurrencyPreference();
  const [allHouses, allRooms, allContainers, allBoxes, allItems] = await Promise.all([
    getPowerSyncRepositoryHouses().then((houses) =>
      houses.map((house) => ({
        id: house.id,
        name: house.name ?? '',
        address: house.address,
        notes: house.notes,
        imagePath: house.image_path,
      }))
    ),
    getPowerSyncRepositoryRooms() as Promise<RoomRecord[]>,
    getPowerSyncRepositoryContainers() as Promise<ContainerRecord[]>,
    getPowerSyncRepositoryBoxes() as Promise<BoxRecord[]>,
    getPowerSyncRepositoryItems() as Promise<ItemRecord[]>,
  ]);

  const selectedHouseIds =
    options?.houseIds && options.houseIds.length > 0 ? new Set(options.houseIds) : null;
  const houses = selectedHouseIds
    ? allHouses.filter((house) => selectedHouseIds.has(house.id))
    : allHouses;
  const exportHouseIds = new Set(houses.map((house) => house.id));
  const rooms = allRooms.filter((room) => exportHouseIds.has(room.houseId));
  const containers = allContainers.filter((container) => exportHouseIds.has(container.houseId));
  const boxes = allBoxes.filter((box) => exportHouseIds.has(box.houseId));
  const items = allItems.filter((item) => exportHouseIds.has(item.houseId));

  const itemImagesByItemId = new Map<string, ItemImageRecord[]>();
  await Promise.all(
    items.map(async (item) => {
      const recordImages = (await getPowerSyncRepositoryItemImages(undefined, item.id)).map((image) => ({
        id: image.id,
        itemId: image.itemId,
        houseId: image.houseId,
        imagePath: image.imagePath,
        remotePath: image.remotePath,
        position: image.position,
      }));
      itemImagesByItemId.set(item.id, recordImages.sort(compareItemImages));
    })
  );

  const counts: ExportCounts = {
    houses: houses.length,
    rooms: rooms.length,
    containers: containers.length,
    boxes: boxes.length,
    items: items.length,
    images: 0,
    unavailableImages: 0,
  };

  const snapshot: ExportSnapshot = {
    houses,
    rooms,
    containers,
    boxes,
    items,
    itemImagesByItemId,
  };

  const exportedAt = new Date();
  const exportChunks = buildExportChunks(snapshot);

  const timestamp = exportedAt.toISOString().replace(/[:.]/g, '-');
  const fileName = `everfind-export-${timestamp}.pdf`;
  const baseDir = FileSystem.cacheDirectory || FileSystem.documentDirectory;
  if (!baseDir) {
    throw new Error('No writable directory available for export.');
  }
  const finalUri = `${baseDir}${fileName}`;

  const chunkUris: string[] = [];
  try {
    for (let index = 0; index < exportChunks.length; index += 1) {
      const chunk = exportChunks[index];
      const html = await renderSimpleDocumentHtml(
        chunk.snapshot,
        exportedAt.toLocaleString(),
        currency,
        chunk.counts,
        { includeTitlePage: index === 0 }
      );
      const result = await renderPdfToFile(html);
      chunkUris.push(result.uri);
    }

    if (chunkUris.length === 1) {
      await FileSystem.copyAsync({ from: chunkUris[0], to: finalUri });
    } else {
      await mergePdfUris(chunkUris, finalUri);
    }
  } finally {
    await Promise.all(
      chunkUris.map(async (uri) => {
        if (uri === finalUri) return;
        try {
          await FileSystem.deleteAsync(uri, { idempotent: true });
        } catch {
          // Best-effort cleanup.
        }
      })
    );
  }

  return {
    fileUri: finalUri,
    fileName,
    counts,
  };
};
