import { useCallback, useMemo, useRef, useState } from 'react';
import { Alert, Platform, Pressable, ScrollView, View } from 'react-native';
import { BottomSheetBackdrop, BottomSheetModal, BottomSheetScrollView } from '@gorhom/bottom-sheet';
import {
  Appbar,
  Button,
  Icon,
  Surface,
  Text,
  useTheme,
} from 'react-native-paper';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { router, useFocusEffect } from 'expo-router';
import * as NavigationBar from 'expo-navigation-bar';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import type { AppTheme } from '../../../utils/theme/theme';
import { useThemePreference } from '../../../utils/theme/themePreference';
import { triggerGlobalRefresh, useActiveHouse } from '../../../utils/hooks/useDatabase';
import {
  createPowerSyncLocalBox,
  createPowerSyncLocalContainer,
  createPowerSyncLocalHouse,
  createPowerSyncLocalItem,
  createPowerSyncLocalRoom,
  updatePowerSyncLocalBox,
  updatePowerSyncLocalContainer,
  updatePowerSyncLocalHouse,
  updatePowerSyncLocalItem,
  updatePowerSyncLocalRoom,
} from '../../../utils/powersync/mutations';
import {
  getPowerSyncRepositoryBoxes,
  getPowerSyncRepositoryContainers,
  getPowerSyncRepositoryHouses,
  getPowerSyncRepositoryItems,
  getPowerSyncRepositoryRooms,
} from '../../../utils/powersync/repository';
import {
  trackCsvExported,
  trackCsvImported,
  trackPdfExported,
} from '../../../utils/analytics/AnalyticsProvider';
import { reindexAllSpotlightItems } from '../../../src/spotlight/spotlightIndex';
import { loadSpotlightItemsEnabled } from '../../../utils/spotlightPreference';
import { generateInventoryPdfExport } from '../../../utils/export/pdfExport';
import { hasFeatureEnabled } from '../../../utils/access';
import { useAuth } from '../../../utils/auth/AuthContext';
import {
  getExportableHouses,
  type ExportableHouseOption,
} from '../../../utils/export/exportableHouses';

type ExportFormat = 'csv' | 'pdf';

export default function ImportExportScreen() {
  const { colors, custom } = useTheme<AppTheme>();
  const { spacing, shapes, elevation, surfaces, opacity } = custom;
  const insets = useSafeAreaInsets();
  const { resolvedTheme } = useThemePreference();
  const { user } = useAuth();
  const { activeHouseId, setActiveHouseById } = useActiveHouse();
  const exportHouseSheetRef = useRef<BottomSheetModal>(null);
  const [importing, setImporting] = useState(false);
  const [exportingKind, setExportingKind] = useState<'csv' | 'pdf' | null>(null);
  const [lastImportSummary, setLastImportSummary] = useState<string | null>(null);
  const [lastExportPath, setLastExportPath] = useState<string | null>(null);
  const [exportHouseOptions, setExportHouseOptions] = useState<ExportableHouseOption[]>([]);
  const [selectedExportHouseIds, setSelectedExportHouseIds] = useState<string[]>([]);
  const [pendingExportFormat, setPendingExportFormat] = useState<ExportFormat | null>(null);
  const statusBarStyle = resolvedTheme === 'dark' ? 'light' : 'dark';
  const exportingCsv = exportingKind === 'csv';
  const exportingPdf = exportingKind === 'pdf';
  const exportSheetSnapPoints = useMemo(() => ['72%'], []);

  useFocusEffect(
    useCallback(() => {
      NavigationBar.setBackgroundColorAsync('transparent');
      NavigationBar.setBorderColorAsync('transparent');
      NavigationBar.setVisibilityAsync('visible');
      NavigationBar.setButtonStyleAsync(resolvedTheme === 'dark' ? 'light' : 'dark');
      NavigationBar.setBehaviorAsync('overlay-swipe');
    }, [resolvedTheme])
  );

  const renderExportSheetBackdrop = useCallback(
    (props: any) => (
      <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} pressBehavior="close" />
    ),
    []
  );

  const dismissExportSheet = useCallback(() => {
    exportHouseSheetRef.current?.dismiss();
  }, []);

  const resetExportSheetState = useCallback(() => {
    setPendingExportFormat(null);
    setExportHouseOptions([]);
    setSelectedExportHouseIds([]);
  }, []);

  const csvEscape = (value: string) => {
    const needsQuotes = /[",\n\r]/.test(value);
    const escaped = value.replace(/"/g, '""');
    return needsQuotes ? `"${escaped}"` : escaped;
  };

  const toCsv = (rows: string[][]) =>
    rows.map((row) => row.map((value) => csvEscape(value ?? '')).join(',')).join('\n');

  const formatCents = (value: number | null | undefined) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return '';
    return (value / 100).toFixed(2);
  };

  const parseCents = (value: string) => {
    const normalized = value.trim();
    if (!normalized) return null;
    const numeric = Number(normalized.replace(/[^0-9.-]/g, ''));
    if (!Number.isFinite(numeric)) return null;
    return Math.round(numeric * 100);
  };

  const parseCsv = (text: string) => {
    const rows: string[][] = [];
    let row: string[] = [];
    let current = '';
    let inQuotes = false;

    const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    for (let i = 0; i < normalized.length; i += 1) {
      const char = normalized[i];
      const nextChar = normalized[i + 1];

      if (char === '"') {
        if (inQuotes && nextChar === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = !inQuotes;
        }
        continue;
      }

      if (char === ',' && !inQuotes) {
        row.push(current);
        current = '';
        continue;
      }

      if (char === '\n' && !inQuotes) {
        row.push(current);
        rows.push(row);
        row = [];
        current = '';
        continue;
      }

      current += char;
    }

    row.push(current);
    rows.push(row);
    return rows;
  };

  const writeExportCsv = async (houseIds: string[]) => {
    if (exportingKind) return null;
    setExportingKind('csv');
    try {
      const [allHouses, allRooms, allContainers, allBoxes, allItems] = await Promise.all([
        getPowerSyncRepositoryHouses(),
        getPowerSyncRepositoryRooms(),
        getPowerSyncRepositoryContainers(),
        getPowerSyncRepositoryBoxes(),
        getPowerSyncRepositoryItems(),
      ]);

      const houseIdSet = new Set(houseIds);
      const houses = allHouses.filter((house: any) => houseIdSet.has(house.id));
      const rooms = allRooms.filter((room: any) => houseIdSet.has(room.houseId));
      const containers = allContainers.filter((container: any) => houseIdSet.has(container.houseId));
      const boxes = allBoxes.filter((box: any) => houseIdSet.has(box.houseId));
      const items = allItems.filter((item: any) => houseIdSet.has(item.houseId));

      const houseById = new Map(houses.map((house: any) => [house.id, house]));
      const roomById = new Map(rooms.map((room: any) => [room.id, room]));
      const containerById = new Map(containers.map((container: any) => [container.id, container]));
      const boxById = new Map(boxes.map((box: any) => [box.id, box]));

      const rows: string[][] = [[
        'House',
        'Room',
        'Container',
        'Box',
        'Item',
        'Box Tags',
        'Item Tags',
        'Purchase Price',
        'Notes',
      ]];

      houses.forEach((house: any) => {
        rows.push([house.name || '', '', '', '', '', '', '', '', '']);
      });

      rooms.forEach((room: any) => {
        const house = houseById.get(room.houseId);
        rows.push([house?.name || '', room.name || '', '', '', '', '', '', '', '']);
      });

      containers.forEach((container: any) => {
        const room = roomById.get(container.roomId);
        const house = room ? houseById.get(room.houseId) : null;
        rows.push([house?.name || '', room?.name || '', container.name || '', '', '', '', '', '', '']);
      });

      boxes.forEach((box: any) => {
        if (box.parentType === 'container') {
          const container = containerById.get(box.parentId);
          const room = container ? roomById.get(container.roomId) : null;
          const house = room ? houseById.get(room.houseId) : houseById.get(box.houseId);
          rows.push([
            house?.name || '',
            room?.name || '',
            container?.name || '',
            box.name || '',
            '',
            box.tags || '',
            '',
            '',
            '',
          ]);
        } else if (box.parentType === 'room') {
          const room = box.parentId ? roomById.get(box.parentId) : null;
          const house = room ? houseById.get(room.houseId) : houseById.get(box.houseId);
          rows.push([
            house?.name || '',
            room?.name || '',
            '',
            box.name || '',
            '',
            box.tags || '',
            '',
            '',
            '',
          ]);
        } else {
          const house = houseById.get(box.houseId);
          rows.push([
            house?.name || '',
            '',
            '',
            box.name || '',
            '',
            box.tags || '',
            '',
            '',
            '',
          ]);
        }
      });

      items.forEach((item: any) => {
        if (item.parentType === 'box') {
          const box = boxById.get(item.parentId);
          if (!box) {
            const house = houseById.get(item.houseId);
            rows.push([
              house?.name || '',
              '',
              '',
              '',
              item.name || '',
              '',
              item.tags || '',
              formatCents(item.purchasePriceCents),
              item.notes || '',
            ]);
            return;
          }
          if (box.parentType === 'container') {
            const container = containerById.get(box.parentId);
            const room = container ? roomById.get(container.roomId) : null;
            const house = room ? houseById.get(room.houseId) : houseById.get(box.houseId);
              rows.push([
                house?.name || '',
                room?.name || '',
                container?.name || '',
                box?.name || '',
                item.name || '',
                '',
                item.tags || '',
                formatCents(item.purchasePriceCents),
                item.notes || '',
              ]);
          } else {
            const room = box.parentId ? roomById.get(box.parentId) : null;
            const house = room ? houseById.get(room.houseId) : houseById.get(box.houseId);
            rows.push([
              house?.name || '',
              room?.name || '',
              '',
              box?.name || '',
              item.name || '',
              '',
              item.tags || '',
              formatCents(item.purchasePriceCents),
              item.notes || '',
            ]);
          }
          return;
        }

        if (item.parentType === 'container') {
          const container = containerById.get(item.parentId);
          const room = container ? roomById.get(container.roomId) : null;
          const house = room ? houseById.get(room.houseId) : houseById.get(item.houseId);
          rows.push([
            house?.name || '',
            room?.name || '',
            container?.name || '',
            '',
            item.name || '',
            '',
            item.tags || '',
            formatCents(item.purchasePriceCents),
            item.notes || '',
          ]);
          return;
        }

        if (item.parentType === 'room') {
          const room = roomById.get(item.parentId);
          const house = room ? houseById.get(room.houseId) : houseById.get(item.houseId);
          rows.push([
            house?.name || '',
            room?.name || '',
            '',
            '',
            item.name || '',
            '',
            item.tags || '',
            formatCents(item.purchasePriceCents),
            item.notes || '',
          ]);
          return;
        }

        const house = houseById.get(item.houseId);
        rows.push([
          house?.name || '',
          '',
          '',
          '',
          item.name || '',
          '',
          item.tags || '',
          formatCents(item.purchasePriceCents),
          item.notes || '',
        ]);
      });

      const csv = toCsv(rows);
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const fileName = `everfind-export-${timestamp}.csv`;
      const baseDir = FileSystem.cacheDirectory || FileSystem.documentDirectory;

      if (baseDir) {
        const fileUri = `${baseDir}${fileName}`;
        await FileSystem.writeAsStringAsync(fileUri, csv, { encoding: FileSystem.EncodingType.UTF8 });
        setLastExportPath(fileUri);
        trackCsvExported({
          houses_count: houses.length,
          rooms_count: rooms.length,
          containers_count: containers.length,
          boxes_count: boxes.length,
          items_count: items.length,
          rows_count: rows.length > 0 ? rows.length - 1 : 0,
        });
        return { fileUri, fileName, csv };
      }

      Alert.alert('Export failed', 'No writable directory available for export.');
      return null;
    } catch (error: any) {
      Alert.alert('Export failed', error?.message || 'Unable to export data.');
      return null;
    } finally {
      setExportingKind(null);
    }
  };

  const shareCsvExport = async (houseIds: string[]) => {
    const result = await writeExportCsv(houseIds);
    if (!result) return;

    const canShare = await Sharing.isAvailableAsync();
    if (canShare) {
      await Sharing.shareAsync(result.fileUri, { mimeType: 'text/csv', dialogTitle: 'Export inventory' });
    } else {
      Alert.alert('Export ready', `CSV saved to:\n${result.fileUri}`);
    }
  };

  const sharePdfExport = async (houseIds: string[]) => {
    if (exportingKind) return;

    const pdfExportEnabled = await hasFeatureEnabled('pdfexport');
    if (!pdfExportEnabled) {
      Alert.alert('Not allowed', "Your plan doesn't support PDF export.");
      return;
    }

    setExportingKind('pdf');
    try {
      const result = await generateInventoryPdfExport({ houseIds });
      setLastExportPath(result.fileUri);

      const canShare = await Sharing.isAvailableAsync();
      trackPdfExported({
        houses_count: result.counts.houses,
        rooms_count: result.counts.rooms,
        containers_count: result.counts.containers,
        boxes_count: result.counts.boxes,
        items_count: result.counts.items,
        images_count: result.counts.images,
        unavailable_images_count: result.counts.unavailableImages,
        sharing_available: canShare,
      });

      if (canShare) {
        await Sharing.shareAsync(result.fileUri, {
          mimeType: 'application/pdf',
          dialogTitle: 'Export inventory PDF',
        });
      } else {
        Alert.alert('Export ready', `PDF saved to:\n${result.fileUri}`);
      }
    } catch (error: any) {
      Alert.alert('Export failed', error?.message || 'Unable to export PDF.');
    } finally {
      setExportingKind(null);
    }
  };

  const executeExport = async (format: ExportFormat, houseIds: string[]) => {
    if (!houseIds.length) {
      Alert.alert('Not allowed', 'Select at least one house to export.');
      return;
    }

    if (format === 'csv') {
      await shareCsvExport(houseIds);
      return;
    }

    await sharePdfExport(houseIds);
  };

  const startExportFlow = async (format: ExportFormat) => {
    if (exportingKind) return;

    if (format === 'pdf') {
      const pdfExportEnabled = await hasFeatureEnabled('pdfexport');
      if (!pdfExportEnabled) {
        Alert.alert('Not allowed', "Your plan doesn't support PDF export.");
        return;
      }
    }

    const exportableHouses = await getExportableHouses(user?.id);

    if (!exportableHouses.length) {
      Alert.alert('Not allowed', 'You need owner or admin access to export a house.');
      return;
    }

    if (exportableHouses.length === 1) {
      await executeExport(format, [exportableHouses[0].id]);
      return;
    }

    setPendingExportFormat(format);
    setExportHouseOptions(exportableHouses);
    setSelectedExportHouseIds(exportableHouses.map((house) => house.id));
    exportHouseSheetRef.current?.present();
  };

  const toggleHouseSelection = useCallback((houseId: string) => {
    setSelectedExportHouseIds((current) =>
      current.includes(houseId)
        ? current.filter((id) => id !== houseId)
        : [...current, houseId]
    );
  }, []);

  const handleConfirmHouseSelection = async () => {
    if (!pendingExportFormat) return;
    if (!selectedExportHouseIds.length) {
      Alert.alert('Not allowed', 'Select at least one house to export.');
      return;
    }

    const nextFormat = pendingExportFormat;
    const nextHouseIds = [...selectedExportHouseIds];
    dismissExportSheet();
    resetExportSheetState();
    await executeExport(nextFormat, nextHouseIds);
  };

  const houseAccessLabel = (house: ExportableHouseOption) => {
    if (house.access === 'owner') return 'Owner';
    if (house.access === 'admin') return 'Admin';
    return 'Local';
  };

  const importCsvText = async (csvText: string) => {
    const cleanedText = csvText.replace(/^\uFEFF/, '');
    const rows = parseCsv(cleanedText);

      const header = rows[0]?.map((value) => value.trim().toLowerCase());
      const hasHeader =
        header?.length >= 5 &&
        header[0] === 'house' &&
        header[1] === 'room' &&
        header[2] === 'container' &&
        header[3] === 'box' &&
        header[4] === 'item';

      const dataRows = hasHeader ? rows.slice(1) : rows;

      const [houses, rooms, containers, boxes, items] = await Promise.all([
        getPowerSyncRepositoryHouses(),
        getPowerSyncRepositoryRooms(),
        getPowerSyncRepositoryContainers(),
        getPowerSyncRepositoryBoxes(),
        getPowerSyncRepositoryItems(),
      ]);

      const houseByName = new Map(houses.map((house: any) => [String(house.name ?? '').trim(), house]));
      const roomByKey = new Map(
        rooms.map((room: any) => [`${room.houseId}::${String(room.name ?? '').trim()}`, room])
      );
      const containerByKey = new Map(
        containers.map((container: any) => [`${container.roomId}::${String(container.name ?? '').trim()}`, container])
      );
      const boxByKey = new Map(
        boxes.map((box: any) => {
          const key =
            box.parentType && box.parentId
              ? `${box.parentType}::${box.parentId}::${String(box.name ?? '').trim()}`
              : `house::${box.houseId}::${String(box.name ?? '').trim()}`;
          return [key, box];
        })
      );
      const itemByKey = new Map(
        items.map((item: any) => {
          const key =
            item.parentType && item.parentId
              ? `${item.parentType}::${item.parentId}::${String(item.name ?? '').trim()}`
              : `house::${item.houseId}::${String(item.name ?? '').trim()}`;
          return [key, item];
        })
      );

      let createdHouseId: string | null = null;
      const stats = {
        created: { houses: 0, rooms: 0, containers: 0, boxes: 0, items: 0 },
        reused: { houses: 0, rooms: 0, containers: 0, boxes: 0, items: 0 },
        skipped: 0,
      };
      const reusedIds = {
        houses: new Set<string>(),
        rooms: new Set<string>(),
        containers: new Set<string>(),
        boxes: new Set<string>(),
        items: new Set<string>(),
      };
      const markReused = (key: keyof typeof reusedIds, id: string) => {
        if (reusedIds[key].has(id)) return;
        reusedIds[key].add(id);
        stats.reused[key] += 1;
      };
      const getCell = (row: string[], index: number) => (row[index] ?? '').trim();

      for (const row of dataRows) {
        const houseName = getCell(row, 0);
        const roomName = getCell(row, 1);
        const containerName = getCell(row, 2);
        const boxName = getCell(row, 3);
        const itemName = getCell(row, 4);
        const boxTags = getCell(row, 5);
        const itemTags = getCell(row, 6);
        const purchasePrice = getCell(row, 7);
        const itemNotes = getCell(row, 8);

        if (!houseName && !roomName && !containerName && !boxName && !itemName) {
          stats.skipped += 1;
          continue;
        }

        let house = houseName ? houseByName.get(houseName) : undefined;
        if (houseName && !house) {
          house = await createPowerSyncLocalHouse({ name: houseName });
          houseByName.set(houseName, house);
          createdHouseId = createdHouseId || house.id;
          stats.created.houses += 1;
        } else if (houseName) {
          if (house && house.name !== houseName) {
            house = await updatePowerSyncLocalHouse({
              houseId: house.id,
              name: houseName,
              ownerId: house.ownerId ?? house.owner_id ?? null,
              address: house.address ?? null,
              notes: house.notes ?? null,
              imagePath: house.imagePath ?? house.image_path ?? null,
            });
            houseByName.set(houseName, house);
          }
          if (house) markReused('houses', house.id);
        }

        let room: any | undefined;
        if (roomName) {
          if (!house) {
            stats.skipped += 1;
            continue;
          }
          const roomKey = `${house.id}::${roomName}`;
          room = roomByKey.get(roomKey);
          if (!room) {
            room = await createPowerSyncLocalRoom({
              houseId: house.id,
              name: roomName,
              description: null,
              imagePath: null,
            });
            roomByKey.set(roomKey, room);
            stats.created.rooms += 1;
          } else {
            if (room.houseId !== house.id || room.name !== roomName) {
              room = await updatePowerSyncLocalRoom({
                roomId: room.id,
                houseId: house.id,
                name: roomName,
                description: room.description ?? null,
                imagePath: room.imagePath ?? null,
              });
              roomByKey.set(roomKey, room);
            }
            markReused('rooms', room.id);
          }
        }

        let container: any | undefined;
        if (containerName) {
          if (!room || !house) {
            stats.skipped += 1;
            continue;
          }
          const containerKey = `${room.id}::${containerName}`;
          container = containerByKey.get(containerKey);
          if (!container) {
            container = await createPowerSyncLocalContainer({
              houseId: house.id,
              roomId: room.id,
              name: containerName,
              description: null,
              imagePath: null,
            });
            containerByKey.set(containerKey, container);
            stats.created.containers += 1;
          } else {
            if (container.houseId !== house.id || container.roomId !== room.id || container.name !== containerName) {
              container = await updatePowerSyncLocalContainer({
                containerId: container.id,
                houseId: house.id,
                roomId: room.id,
                name: containerName,
                description: container.description ?? null,
                imagePath: container.imagePath ?? null,
              });
              containerByKey.set(containerKey, container);
            }
            markReused('containers', container.id);
          }
        }

        let box: any | undefined;
        if (boxName) {
          let parentType: 'room' | 'container' | null = null;
          let parentId: string | null = null;
          let boxKey: string;
          if (container) {
            parentType = 'container';
            parentId = container.id;
            boxKey = `${parentType}::${parentId}::${boxName}`;
          } else if (room) {
            parentType = 'room';
            parentId = room.id;
            boxKey = `${parentType}::${parentId}::${boxName}`;
          } else if (house) {
            boxKey = `house::${house.id}::${boxName}`;
          } else {
            stats.skipped += 1;
            continue;
          }

          box = boxByKey.get(boxKey);
          if (!box) {
            box = await createPowerSyncLocalBox({
              houseId: house.id,
              parentType,
              parentId,
              name: boxName,
              description: null,
              imagePath: null,
              tags: boxTags || '',
            });
            boxByKey.set(boxKey, box);
            stats.created.boxes += 1;
          } else {
            if (
              box.houseId !== house.id ||
              box.parentType !== parentType ||
              box.parentId !== parentId ||
              box.name !== boxName ||
              (boxTags && box.tags !== boxTags)
            ) {
              box = await updatePowerSyncLocalBox({
                boxId: box.id,
                houseId: house.id,
                parentType,
                parentId,
                name: boxName,
                description: box.description ?? null,
                imagePath: box.imagePath ?? null,
                tags: boxTags || box.tags || '',
              });
              boxByKey.set(boxKey, box);
            }
            markReused('boxes', box.id);
          }
        }

        if (itemName) {
          let parentType: 'room' | 'container' | 'box' | null = null;
          let parentId: string | null = null;
          let itemKey = '';

          if (box) {
            parentType = 'box';
            parentId = box.id;
            itemKey = `${parentType}::${parentId}::${itemName}`;
          } else if (container) {
            parentType = 'container';
            parentId = container.id;
            itemKey = `${parentType}::${parentId}::${itemName}`;
          } else if (room) {
            parentType = 'room';
            parentId = room.id;
            itemKey = `${parentType}::${parentId}::${itemName}`;
          } else if (house) {
            itemKey = `house::${house.id}::${itemName}`;
          }

          if (!itemKey || !house) {
            stats.skipped += 1;
            continue;
          }

          const existingItem = itemByKey.get(itemKey);
          const parsedPurchasePriceCents = parseCents(purchasePrice);
          if (!existingItem) {
            const newItem = await createPowerSyncLocalItem({
              houseId: house.id,
              parentType,
              parentId,
              name: itemName,
              description: null,
              imagePath: null,
              tags: itemTags || '',
              purchasePriceCents: parsedPurchasePriceCents,
              notes: itemNotes || null,
            });
            itemByKey.set(itemKey, newItem);
            stats.created.items += 1;
          } else {
            if (
              existingItem.houseId !== house.id ||
              existingItem.parentType !== parentType ||
              existingItem.parentId !== parentId ||
              existingItem.name !== itemName ||
              (itemTags && existingItem.tags !== itemTags) ||
              (parsedPurchasePriceCents !== null && existingItem.purchasePriceCents !== parsedPurchasePriceCents) ||
              (itemNotes && existingItem.notes !== itemNotes)
            ) {
              const updatedItem = await updatePowerSyncLocalItem({
                itemId: existingItem.id,
                houseId: house.id,
                parentType,
                parentId,
                name: itemName,
                description: existingItem.description ?? null,
                imagePath: existingItem.imagePath ?? null,
                tags: itemTags || existingItem.tags || '',
                purchasePriceCents:
                  parsedPurchasePriceCents !== null
                    ? parsedPurchasePriceCents
                    : existingItem.purchasePriceCents ?? null,
                notes: itemNotes || existingItem.notes || null,
              });
              itemByKey.set(itemKey, updatedItem);
            }
            markReused('items', existingItem.id);
          }
        }
      }

      if (!activeHouseId && createdHouseId) {
        await setActiveHouseById(createdHouseId);
      }
      triggerGlobalRefresh();

      if (Platform.OS === 'ios') {
        try {
          const spotlightEnabled = await loadSpotlightItemsEnabled();
          if (spotlightEnabled) {
            await reindexAllSpotlightItems();
          }
        } catch (error) {
          console.warn('Spotlight reindex after CSV import failed', error);
        }
      }

      const summary = [
        `Created - Houses: ${stats.created.houses}, Rooms: ${stats.created.rooms}, Containers: ${stats.created.containers}, Boxes: ${stats.created.boxes}, Items: ${stats.created.items}`,
        `Reused - Houses: ${stats.reused.houses}, Rooms: ${stats.reused.rooms}, Containers: ${stats.reused.containers}, Boxes: ${stats.reused.boxes}, Items: ${stats.reused.items}`,
        `Skipped rows: ${stats.skipped}`,
      ].join('\n');

      trackCsvImported({
        created_houses: stats.created.houses,
        created_rooms: stats.created.rooms,
        created_containers: stats.created.containers,
        created_boxes: stats.created.boxes,
        created_items: stats.created.items,
        reused_houses: stats.reused.houses,
        reused_rooms: stats.reused.rooms,
        reused_containers: stats.reused.containers,
        reused_boxes: stats.reused.boxes,
        reused_items: stats.reused.items,
        skipped_rows: stats.skipped,
        processed_rows: dataRows.length,
        has_header: hasHeader,
      });

      setLastImportSummary(summary);
      Alert.alert('Import complete', summary);
  };

  const handleImport = async () => {
    if (importing) return;
    setImporting(true);
    try {
      const pickerResult = await DocumentPicker.getDocumentAsync({
        type: ['text/csv', 'text/plain', 'application/vnd.ms-excel'],
        copyToCacheDirectory: true,
      });

      if (pickerResult.canceled) {
        setImporting(false);
        return;
      }

      const file = pickerResult.assets?.[0];
      if (!file?.uri) {
        Alert.alert('Import failed', 'No file selected.');
        return;
      }

      const csvText = await FileSystem.readAsStringAsync(file.uri, {
        encoding: FileSystem.EncodingType.UTF8,
      });
      await importCsvText(csvText);
    } catch (error: any) {
      Alert.alert('Import failed', error?.message || 'Unable to import CSV.');
    } finally {
      setImporting(false);
    }
  };

  return (
    <>
      <StatusBar style={statusBarStyle} backgroundColor="transparent" translucent={false} />

      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['bottom']}>
        {/* App Bar */}
        <Appbar.Header
          style={{
            backgroundColor: colors.surface,
            elevation: elevation.level0,
          }}
        >
          <Appbar.BackAction onPress={() => router.back()} />
          <Appbar.Content title="Import / Export" style={{ alignItems: 'flex-start' }} titleStyle={{ textAlign: 'left' }} />
        </Appbar.Header>

        <ScrollView
          style={{ flex: 1, backgroundColor: colors.background }}
          contentContainerStyle={{
            padding: spacing.xxl,
            paddingBottom: spacing.xxl + insets.bottom,
            gap: spacing.lg,
          }}
        >
          {/* Import */}
          <Surface
            elevation={elevation.level1}
            style={{
              backgroundColor: surfaces.card,
              borderRadius: shapes.cornerLarge,
              padding: spacing.xxl,
            }}
          >
            <Text variant="titleMedium">Import</Text>

            <View
              style={{
                marginTop: spacing.lg,
                gap: spacing.md,
              }}
            >
              <Text variant="bodyMedium" style={{ color: colors.onSurfaceVariant }}>
                Import a CSV with columns: House, Room, Container, Box, Item.
              </Text>

              <Button
                mode="contained-tonal"
                icon="file-import-outline"
                onPress={handleImport}
                disabled={importing}
                loading={importing}
                buttonColor={colors.primaryContainer}
                textColor={colors.onPrimaryContainer}
                style={{ alignSelf: 'flex-start', borderRadius: shapes.cornerFull }}
              >
                Import CSV
              </Button>

              {lastImportSummary ? (
                <Text variant="bodySmall" style={{ color: colors.onSurfaceVariant }}>
                  {lastImportSummary}
                </Text>
              ) : null}
            </View>
          </Surface>

          {/* Export */}
          <Surface
            elevation={elevation.level1}
            style={{
              backgroundColor: surfaces.card,
              borderRadius: shapes.cornerLarge,
              padding: spacing.xxl,
            }}
          >
            <Text variant="titleMedium">Export</Text>

            <View
              style={{
                marginTop: spacing.lg,
                gap: spacing.md,
              }}
            >
              <Text variant="bodyMedium" style={{ color: colors.onSurfaceVariant }}>
                Export owner/admin houses only. If more than one house is eligible, you can choose which ones to include.
              </Text>

              <Button
                mode="contained-tonal"
                icon="file-export-outline"
                onPress={() => void startExportFlow('csv')}
                disabled={Boolean(exportingKind)}
                loading={exportingCsv}
                buttonColor={colors.primaryContainer}
                textColor={colors.onPrimaryContainer}
                style={{ alignSelf: 'flex-start', borderRadius: shapes.cornerFull }}
              >
                Export CSV
              </Button>

              <Button
                mode="contained-tonal"
                icon="file-pdf-box"
                onPress={() => void startExportFlow('pdf')}
                disabled={Boolean(exportingKind)}
                loading={exportingPdf}
                buttonColor={colors.primaryContainer}
                textColor={colors.onPrimaryContainer}
                style={{ alignSelf: 'flex-start', borderRadius: shapes.cornerFull }}
              >
                Export PDF
              </Button>

              {lastExportPath ? (
                <Text variant="bodySmall" style={{ color: colors.onSurfaceVariant }}>
                  Last export: {lastExportPath}
                </Text>
              ) : null}
            </View>
          </Surface>
        </ScrollView>
      </SafeAreaView>

      <BottomSheetModal
        ref={exportHouseSheetRef}
        snapPoints={exportSheetSnapPoints}
        enableDynamicSizing={false}
        enablePanDownToClose
        backdropComponent={renderExportSheetBackdrop}
        onDismiss={resetExportSheetState}
        handleStyle={{ paddingTop: spacing.xs }}
        handleIndicatorStyle={{
          backgroundColor: `${colors.onSurface}${opacity.alpha30}`,
          width: 36,
          height: 5,
        }}
        backgroundStyle={{
          backgroundColor: colors.surface,
          borderTopLeftRadius: 22,
          borderTopRightRadius: 22,
        }}
      >
        <BottomSheetScrollView
          contentContainerStyle={{
            paddingHorizontal: spacing.xxl,
            paddingTop: spacing.xxl,
            paddingBottom: spacing.xxl + insets.bottom,
            gap: spacing.md,
          }}
        >
          <Text variant="titleMedium">
            Select houses to export
          </Text>
          <Text variant="bodyMedium" style={{ color: colors.onSurfaceVariant }}>
            Only houses where you are owner or admin can be exported.
          </Text>

          <View style={{ gap: spacing.sm }}>
            {exportHouseOptions.map((house) => {
              const checked = selectedExportHouseIds.includes(house.id);
              return (
                <Pressable
                  key={house.id}
                  onPress={() => toggleHouseSelection(house.id)}
                  style={({ pressed }) => ({
                    backgroundColor: checked ? colors.primaryContainer : surfaces.cardLow,
                    borderRadius: shapes.cornerMedium,
                    borderWidth: 1,
                    borderColor: checked
                      ? `${colors.primary}${opacity.alpha20}`
                      : `${colors.onSurface}${opacity.alpha12}`,
                    paddingHorizontal: spacing.md,
                    paddingVertical: spacing.md,
                    opacity: pressed ? 0.9 : 1,
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  })}
                >
                  <View style={{ flex: 1, paddingRight: spacing.md }}>
                    <Text
                      variant="bodyLarge"
                      style={{ color: checked ? colors.onPrimaryContainer : colors.onSurface }}
                    >
                      {house.name}
                    </Text>
                    <Text
                      variant="bodySmall"
                      style={{
                        color: checked ? colors.onPrimaryContainer : colors.onSurfaceVariant,
                        marginTop: spacing.xs,
                      }}
                    >
                      {houseAccessLabel(house)}
                    </Text>
                  </View>
                  <Icon
                    source={checked ? 'check-circle' : 'circle-outline'}
                    size={22}
                    color={checked ? colors.onPrimaryContainer : colors.onSurfaceVariant}
                  />
                </Pressable>
              );
            })}
          </View>

          <View style={{ flexDirection: 'row', gap: spacing.md }}>
            <Button
              mode="contained-tonal"
              onPress={() => setSelectedExportHouseIds(exportHouseOptions.map((house) => house.id))}
              buttonColor={colors.primaryContainer}
              textColor={colors.onPrimaryContainer}
              style={{ flex: 1 }}
            >
              Select all
            </Button>
            <Button
              mode="contained-tonal"
              onPress={() => setSelectedExportHouseIds([])}
              buttonColor={surfaces.cardLow}
              textColor={colors.onSurface}
              style={{ flex: 1 }}
            >
              Clear
            </Button>
          </View>

          <Button
            mode="contained-tonal"
            onPress={() => void handleConfirmHouseSelection()}
            disabled={!selectedExportHouseIds.length || Boolean(exportingKind)}
            buttonColor={colors.primaryContainer}
            textColor={colors.onPrimaryContainer}
            contentStyle={{ paddingVertical: spacing.xs }}
            style={{ borderRadius: shapes.cornerFull }}
          >
            Export {pendingExportFormat === 'pdf' ? 'PDF' : 'CSV'}
          </Button>
        </BottomSheetScrollView>
      </BottomSheetModal>

    </>
  );
}
