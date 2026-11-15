import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Alert, Animated, BackHandler, Platform, Pressable, Share, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, router } from 'expo-router';
import { useIsFocused } from '@react-navigation/native';
import { Appbar, Button, Icon, Snackbar, Surface, Switch, Text, TextInput, useTheme } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { BottomSheetBackdrop, BottomSheetModal, BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { FullWindowOverlay } from 'react-native-screens';
import { Q } from '@/utils/storage/query';
import type { TableName } from '@/utils/storage/database';
import {
  SheetButton,
  SheetCard,
  SheetHeader,
  SheetNotice,
  SheetRow,
  SheetTheme,
  useSheetBackHandler,
  useSheetChrome,
} from '@/components/sheets/SheetKit';

import FullScreenImageViewer from '@/app/components/FullScreenImageViewer';
import { deleteImage, isPlatformSupported, pickImage, takePhoto } from '@/utils/imageUtils';
import {
  assertCanAddItemPicture,
  assertCanSetItemPictureCount,
  HOUSE_LIMIT_ERROR,
  ITEM_LIMIT_ERROR,
  ITEM_PICTURES_PER_ITEM_LIMIT,
  ITEM_PICTURE_LIMIT_ERROR,
  STORAGE_UNIT_LIMIT_ERROR,
  getLimitErrorMessage,
  getPlanLimits,
} from '@/utils/limits';
import {
  useActiveHouse,
  useBoxes,
  useContainers,
  useDatabaseResetting,
  useGlobalRefresh,
  useHouses,
  useItemImages,
  useItems,
  useRooms,
  triggerGlobalRefresh,
} from '@/utils/hooks/useDatabase';
import { database } from '@/utils/storage/database';
import { getLegacyItemImageId, syncItemCoverImage } from '@/utils/itemImages';
import type { AppTheme } from '@/utils/theme/theme';
import { formatCentsForInput, formatCurrencyFromCents, parseCurrencyToCents, useCurrencyPreference } from '@/utils/currency';
import { EntityForm } from './EntityForm';
import { EntityOverview } from './EntityOverview';
import { ContextualCreateSheet } from './ContextualCreateSheet';
import { getContextualCreateValidationError } from './contextualCreateValidation';
import { ENTITY_CONFIGS } from './entity.config';
import type { EntityConfig, EntityType } from './entity.types';
import { AppConfirmDialog } from '@/components/AppConfirmDialog';
import { AppProgressDialog } from '@/components/AppProgressDialog';
import {
  trackRecordCreated,
  trackRecordImageAdded,
} from '@/utils/analytics/AnalyticsProvider';
import {
  pruneQueuedChangesForHouse,
} from '@/utils/sync/inventorySync';
import { enableHouseSyncForUser } from '@/utils/sync/houseSyncCoordinator';
import {
  hasAnyHouseSyncEnabled,
  ensureHouseSyncEnabled,
  isHouseSyncEnabled,
  loadSyncedHouseIds,
  saveLastSyncAt,
  saveSyncedHouseIds,
  setHouseSyncEnabled,
} from '@/utils/sync/settingsMetadata';
import { useAuth } from '@/utils/auth/AuthContext';
import { isAccountDeletionInProgress } from '@/utils/auth/accountDeletionState';
import { useSignInSheet } from '@/utils/auth/SignInSheetContext';
import { isMissingLocalRecordError } from '@/utils/entity/missingRecordRecovery';
import { isInventoryBootstrapInProgress } from '@/utils/sync/inventoryBootstrapState';
import { isActiveHouseSwitchInProgress } from '@/utils/navigation/activeHouseSwitchState';
import { syncPowerSyncConnectionForSession } from '@/utils/powersync/connectionLifecycle';
import { markApplied } from '@/src/inbox';
import {
  createHouseInvitation,
  getHouseCollaboration,
  leaveHouse,
  removeHouseMember,
  revokeHouseInvitation,
  type InviteRole,
  type HouseCollaboration,
  updateHouseMember,
} from '@/utils/collaboration/houseSharing';
import { getHouseSyncState } from '@/utils/sync/houseSyncState';
import { editionCapabilities } from '@/utils/edition/config';
import {
  createPowerSyncLocalHouse,
  createPowerSyncLocalRoom,
  createPowerSyncLocalContainer,
  createPowerSyncLocalBox,
  createPowerSyncLocalItem,
  deletePowerSyncLocalHouse,
  deletePowerSyncLocalRoom,
  deletePowerSyncLocalContainer,
  deletePowerSyncLocalBox,
  deletePowerSyncLocalItem,
  updatePowerSyncLocalHouse,
  updatePowerSyncLocalRoom,
  updatePowerSyncLocalContainer,
  updatePowerSyncLocalBox,
  updatePowerSyncLocalItem,
} from '@/utils/powersync/mutations';
import {
  getPowerSyncRepositoryBoxes,
  getPowerSyncRepositoryContainers,
  getPowerSyncRepositoryHouseById,
  getPowerSyncRepositoryItems,
  getPowerSyncRepositoryRooms,
} from '@/utils/powersync/repository';

const SUPPORTED_PARENT_TYPES: Partial<Record<EntityType, EntityType[]>> = {
  box: ['room', 'container'],
  item: ['room', 'container', 'box'],
};
const INSTALL_DEFAULT_HOUSE_ID_KEY = 'installDefaultHouseId';

type EntityScreenProps<T> = {
  config: EntityConfig<T>;
  id: string;
  entry: 'direct' | 'push';
};

type ChildSectionItem = { id: string; name: string; description?: string | null };

type LoadedEntity<T> = T & {
  id: string;
  name?: string;
  description?: string | null;
  imagePath?: string | null;
  parentType?: EntityType | null;
  parentId?: string | null;
};

type OptimisticItemImage = {
  id: string;
  itemId: string;
  houseId: string;
  imagePath: string | null;
  remotePath: string | null;
  position: number;
  createdBy?: string | null;
  updatedBy?: string | null;
};

const createItemImageId = (itemId: string, position: number) =>
  position === 0 ? getLegacyItemImageId(itemId) : `item-image-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

const itemImageIdentityKey = (image: { id?: string | null; imagePath?: string | null; remotePath?: string | null }) =>
  image.remotePath || image.imagePath || image.id || '';

const toRouteSegment = (type: EntityType) => (type === 'box' ? 'boxes' : `${type}s`);

export function EntityScreen<T>({ config, id, entry }: EntityScreenProps<T>) {
  const theme = useTheme<AppTheme>();
  const { colors, custom } = theme;
  const { spacing, typography, shapes, elevation, surfaces, opacity } = custom;
  const insets = useSafeAreaInsets();
  const sheetChrome = useSheetChrome();
  const isIos = Platform.OS === 'ios';
  const isFocused = useIsFocused();
  const { user } = useAuth();
  const { openSignIn } = useSignInSheet();

  const params = useLocalSearchParams();
  const sourceInboxEntryId = typeof params.sourceInboxEntryId === 'string' ? params.sourceInboxEntryId : undefined;
  const returnTo = typeof params.returnTo === 'string' ? params.returnTo : undefined;
  const deepLinkSource = typeof params.deepLinkSource === 'string' ? params.deepLinkSource : undefined;
  const shouldReturnToInbox = returnTo === 'inbox';
  const prefillName = typeof params.prefillName === 'string' ? params.prefillName : undefined;
  const prefillNotes = typeof params.prefillNotes === 'string' ? params.prefillNotes : undefined;
  const { activeHouseId } = useActiveHouse();
  const isDatabaseResetting = useDatabaseResetting();
  const globalRefreshKey = useGlobalRefresh();
  const { houses } = useHouses(globalRefreshKey);
  const { currency } = useCurrencyPreference();

  const isAddMode = id === 'add';
  const isEditMode = params.mode === 'edit';
  const isFormMode = isAddMode || isEditMode;
  const entityId = isAddMode ? null : (id as string);
  const isDirectEntry = entry === 'direct';
  const entityRouteSegment = toRouteSegment(config.type);

  const [entity, setEntity] = useState<LoadedEntity<T> | null>(null);
  const [loading, setLoading] = useState(!isAddMode);
  const [saving, setSaving] = useState(false);
  const [fullImageVisible, setFullImageVisible] = useState(false);
  const [entityRevision, setEntityRevision] = useState(0);
  const [fabOpen, setFabOpen] = useState(false);
  const fabAnim = useRef(new Animated.Value(0)).current;

  const defaultFieldValues = useMemo(
    () =>
      config.fields.reduce((acc, field) => {
        acc[String(field.key)] = '';
        return acc;
      }, {} as Record<string, string>),
    [config.fields]
  );

  const [fieldValues, setFieldValues] = useState<Record<string, string>>(defaultFieldValues);
  const [parentType, setParentType] = useState<EntityType | ''>('');
  const [parentId, setParentId] = useState('');
  const [selectedHouseId, setSelectedHouseId] = useState('');
  const [imagePath, setImagePath] = useState<string | null>(null);
  const [createItemImagePaths, setCreateItemImagePaths] = useState<string[]>([]);
  const [createItemImageIndex, setCreateItemImageIndex] = useState(0);
  const [imageLoading, setImageLoading] = useState(false);
  const [itemPictureLimit, setItemPictureLimit] = useState(ITEM_PICTURES_PER_ITEM_LIMIT);
  const [selectedItemImageId, setSelectedItemImageId] = useState<string | null>(null);
  const [optimisticItemImages, setOptimisticItemImages] = useState<OptimisticItemImage[]>([]);
  const [hiddenItemImageIds, setHiddenItemImageIds] = useState<Set<string>>(() => new Set());
  const [syncRefreshing, setSyncRefreshing] = useState(false);
  const [syncSnackbarVisible, setSyncSnackbarVisible] = useState(false);
  const [syncSnackbarMessage, setSyncSnackbarMessage] = useState('');
  const [houseSyncEnabled, setHouseSyncEnabledState] = useState(false);
  const [houseSyncLoading, setHouseSyncLoading] = useState(false);
  const [installDefaultHouseId, setInstallDefaultHouseId] = useState<string | null>(null);
  const [collaboration, setCollaboration] = useState<HouseCollaboration | null>(null);
  const [collaborationLoading, setCollaborationLoading] = useState(false);
  const [inviteeName, setInviteeName] = useState('');
  const [inviteRole, setInviteRole] = useState<InviteRole>('viewer');
  const [inviteCreateLoading, setInviteCreateLoading] = useState(false);
  const [latestInviteCode, setLatestInviteCode] = useState<string | null>(null);
  const [latestInviteRole, setLatestInviteRole] = useState<InviteRole | null>(null);
  const [locationPressCount, setLocationPressCount] = useState(0);
  const [recordDiagnostics, setRecordDiagnostics] = useState<string>('Loading...');
  const [recordDiagnosticsLoading, setRecordDiagnosticsLoading] = useState(false);
  const [deleteDialogVisible, setDeleteDialogVisible] = useState(false);
  const [leaveHouseDialogVisible, setLeaveHouseDialogVisible] = useState(false);
  const inviteSheetRef = useRef<BottomSheetModal>(null);
  const manageMemberSheetRef = useRef<BottomSheetModal>(null);
  const diagnosticsSheetRef = useRef<BottomSheetModal>(null);
  const handleDiagnosticsSheetChange = useSheetBackHandler(diagnosticsSheetRef);
  const createSheetRef = useRef<BottomSheetModal>(null);
  const [inviteSheetIndex, setInviteSheetIndex] = useState(-1);
  const [manageMemberSheetIndex, setManageMemberSheetIndex] = useState(-1);
  const [createSheetIndex, setCreateSheetIndex] = useState(-1);
  const [createSheetVisible, setCreateSheetVisible] = useState(false);
  const [contextualCreateType, setContextualCreateType] = useState<EntityType | null>(null);
  const [contextualCreateValues, setContextualCreateValues] = useState<Record<string, string>>({});
  const [contextualCreateParentType, setContextualCreateParentType] = useState<EntityType | ''>('');
  const [contextualCreateParentId, setContextualCreateParentId] = useState('');
  const [contextualCreateHouseId, setContextualCreateHouseId] = useState('');
  const [contextualCreateImagePath, setContextualCreateImagePath] = useState<string | null>(null);
  const [contextualCreateImagePaths, setContextualCreateImagePaths] = useState<string[]>([]);
  const [contextualCreateImageIndex, setContextualCreateImageIndex] = useState(0);
  const [contextualCreateImageLoading, setContextualCreateImageLoading] = useState(false);
  const [contextualCreateError, setContextualCreateError] = useState<string | null>(null);
  const [managedMember, setManagedMember] = useState<{ userId: string; label: string } | null>(null);
  const hasInitializedHouseRef = useRef(false);
  const prevIsFormModeRef = useRef(isFormMode);
  const hasTrackedDeepLinkOpenRef = useRef(false);
  const addDeniedAlertShownRef = useRef(false);
  const renderFabOverlay = useCallback(
    (children: React.ReactNode) =>
      isIos ? (
        <FullWindowOverlay>
          <View
            collapsable={false}
            pointerEvents="box-none"
            style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }}
          >
            {children}
          </View>
        </FullWindowOverlay>
      ) : (
        <>{children}</>
      ),
    [isIos]
  );
  const hideFabOverlay = useCallback(() => {
    fabAnim.stopAnimation();
    fabAnim.setValue(0);
    setFabOpen(false);
  }, [fabAnim]);
  const prepareForImagePicker = useCallback(async () => {
    hideFabOverlay();
    setImageLoading(true);
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }, [hideFabOverlay]);
  const collaborationHouseId = useMemo(() => {
    if (isAddMode) {
      if (config.type === 'house') {
        return null;
      }
      return selectedHouseId || activeHouseId || null;
    }
    if (config.type === 'house') {
      return entityId;
    }
    const houseIdFromEntity = (entity as any)?.houseId as string | undefined;
    return selectedHouseId || houseIdFromEntity || null;
  }, [activeHouseId, config.type, entity, entityId, isAddMode, selectedHouseId]);
  const contextualCreateConfig = useMemo(
    () => (contextualCreateType ? ENTITY_CONFIGS[contextualCreateType] : null),
    [contextualCreateType]
  );

  useEffect(() => {
    if (config.type !== 'item' || !entityId || isFormMode || !deepLinkSource || hasTrackedDeepLinkOpenRef.current) {
      return;
    }
    hasTrackedDeepLinkOpenRef.current = true;
  }, [config.type, deepLinkSource, entityId, isFormMode]);

  useEffect(() => {
    if (!isAddMode) return;
    if (!prefillName && !prefillNotes) return;
    setFieldValues((prev) => ({
      ...prev,
      ...(prefillName ? { name: shouldReturnToInbox ? prefillName : prev.name || prefillName } : {}),
      ...(prefillNotes ? { notes: shouldReturnToInbox ? prefillNotes : prev.notes || prefillNotes } : {}),
    }));
  }, [isAddMode, prefillName, prefillNotes, shouldReturnToInbox]);

  useEffect(() => {
    let isActive = true;
    const loadLimits = async () => {
      try {
        const limits = await getPlanLimits();
        if (!isActive) return;
        setItemPictureLimit(limits.itemPicturesPerItem);
      } catch {
        if (isActive) {
          setItemPictureLimit(ITEM_PICTURES_PER_ITEM_LIMIT);
        }
      }
    };

    if (config.type === 'item') {
      void loadLimits();
    }

    return () => {
      isActive = false;
    };
  }, [config.type, user?.id]);

  const loadPowerSyncEntity = useCallback(async () => {
    if (!entityId) return null;
    if (config.type === 'house') {
      const house = await getPowerSyncRepositoryHouseById(undefined, entityId);
      if (!house) return null;
      return {
        id: house.id,
        name: house.name ?? '',
        ownerId: house.owner_id,
        address: house.address,
        notes: house.notes,
        imagePath: house.image_path,
      };
    }
    if (config.type === 'room') {
      const room = (await getPowerSyncRepositoryRooms()).find((candidate) => candidate.id === entityId);
      if (!room) return null;
      return room;
    }
    if (config.type === 'container') {
      const container = (await getPowerSyncRepositoryContainers()).find((candidate) => candidate.id === entityId);
      if (!container) return null;
      return container;
    }
    if (config.type === 'box') {
      const box = (await getPowerSyncRepositoryBoxes()).find((candidate) => candidate.id === entityId);
      if (!box) return null;
      return box;
    }
    if (config.type === 'item') {
      const item = (await getPowerSyncRepositoryItems()).find((candidate) => candidate.id === entityId);
      if (!item) return null;
      return item;
    }
    return null;
  }, [config.type, entityId]);

  const loadPowerSyncEntityByType = useCallback(
    async (type: EntityType, targetId: string) => {
      if (type === 'room') {
        return (await getPowerSyncRepositoryRooms()).find((candidate) => candidate.id === targetId) ?? null;
      }
      if (type === 'container') {
        return (await getPowerSyncRepositoryContainers()).find((candidate) => candidate.id === targetId) ?? null;
      }
      if (type === 'box') {
        return (await getPowerSyncRepositoryBoxes()).find((candidate) => candidate.id === targetId) ?? null;
      }
      return null;
    },
    []
  );

  const refreshEntity = useCallback(async () => {
    if (!entityId) return;
    try {
      const powerSyncEntity = await loadPowerSyncEntity();
      if (powerSyncEntity) {
        setEntity(powerSyncEntity as unknown as LoadedEntity<T>);
        setSelectedHouseId((powerSyncEntity as any).houseId || '');
        setEntityRevision((prev) => prev + 1);
        return;
      }

      const record = await database.collections.get<any>(config.collection as TableName).find(entityId);
      setEntity(record);
      setSelectedHouseId((record as any).houseId || '');
      setEntityRevision((prev) => prev + 1);
    } catch {
      // Ignore refresh errors; initial load handles failures.
    }
  }, [config.collection, entityId, loadPowerSyncEntity]);

  const loadRecordDiagnostics = useCallback(async () => {
    if (!entityId || isAddMode) return;
    setRecordDiagnosticsLoading(true);
    try {
      let localRecord: any = null;
      try {
        localRecord = await database.collections.get<any>(config.collection as TableName).find(entityId);
      } catch {
        localRecord = null;
      }

      const itemImageRecords =
        config.type === 'item'
          ? (
              await database.collections
                .get<any>('item_images')
                .query(Q.where('item_id', entityId))
                .fetch()
            )
              .map((record: any) => ({
                id: record.id,
                itemId: record.itemId ?? null,
                houseId: record.houseId ?? null,
                imagePath: record.imagePath ?? null,
                remotePath: record.remotePath ?? null,
                position: record.position ?? null,
              }))
              .sort((left: any, right: any) => {
                const leftPosition = typeof left.position === 'number' ? left.position : 0;
                const rightPosition = typeof right.position === 'number' ? right.position : 0;
                if (leftPosition !== rightPosition) {
                  return leftPosition - rightPosition;
                }
                return String(left.id).localeCompare(String(right.id));
              })
          : [];

      const summary = {
        entityType: config.type,
        entityId,
        collection: config.collection,
        localRecord: localRecord
          ? {
              id: localRecord.id,
              houseId: localRecord.houseId ?? null,
              parentType: localRecord.parentType ?? null,
              parentId: localRecord.parentId ?? null,
              roomId: localRecord.roomId ?? null,
              imagePath: localRecord.imagePath ?? null,
            }
          : null,
        localItemImages: itemImageRecords,
        legacySyncDiagnostics: {
          status: 'removed',
        },
      };

      setRecordDiagnostics(JSON.stringify(summary, null, 2));
    } catch (error: any) {
      setRecordDiagnostics(`Failed to load diagnostics: ${String(error?.message ?? error)}`);
    } finally {
      setRecordDiagnosticsLoading(false);
    }
  }, [config.collection, config.type, entityId, isAddMode]);

  const handleLocationDiagnosticPress = useCallback(() => {
    if (isFormMode || !entityId) return;
    const nextCount = locationPressCount + 1;
    setLocationPressCount(nextCount);
    if (nextCount < 7) {
      return;
    }
    setLocationPressCount(0);
    void loadRecordDiagnostics();
    diagnosticsSheetRef.current?.present();
  }, [entityId, isFormMode, loadRecordDiagnostics, locationPressCount]);

  useEffect(() => {
    AsyncStorage.getItem(INSTALL_DEFAULT_HOUSE_ID_KEY)
      .then((value) => {
        setInstallDefaultHouseId(value || null);
      })
      .catch((error) => {
        console.warn('Failed to load install default house id', error);
        setInstallDefaultHouseId(null);
      });
  }, []);

  useEffect(() => {
    if (config.type !== 'house' || !entityId || isFormMode) return;
    let isActive = true;
    const loadHouseSyncState = async () => {
      setHouseSyncLoading(true);
      try {
        const enabled = await isHouseSyncEnabled(entityId);
        if (!isActive) return;
        setHouseSyncEnabledState(enabled);
      } catch (error) {
        console.warn('Failed to load house sync state', error);
      } finally {
        if (isActive) {
          setHouseSyncLoading(false);
        }
      }
    };
    void loadHouseSyncState();
    return () => {
      isActive = false;
    };
  }, [config.type, entityId, isFormMode]);

  const refreshCollaboration = useCallback(async () => {
    if (!collaborationHouseId || !user) {
      setCollaboration(null);
      return;
    }
    setCollaborationLoading(true);
    try {
      const syncEnabled = await isHouseSyncEnabled(collaborationHouseId);

      const houseSyncState = getHouseSyncState({
        houses,
        houseId: collaborationHouseId,
        houseSyncEnabled: syncEnabled,
        userId: user.id,
        isBootstrapInProgress: isInventoryBootstrapInProgress(),
        isDeletingAccountInProgress: isAccountDeletionInProgress(),
        isSyncing: houseSyncLoading,
      });

      if (!houseSyncState.shouldUseBackendPermissions) {
        setCollaboration(null);
        setHouseSyncEnabledState(false);
        return;
      }

      const installDefaultHouseId = await AsyncStorage.getItem(INSTALL_DEFAULT_HOUSE_ID_KEY);
      if (installDefaultHouseId === collaborationHouseId && !syncEnabled) {
        setCollaboration(null);
        setHouseSyncEnabledState(false);
        return;
      }

      const data = await getHouseCollaboration(collaborationHouseId);
      setCollaboration(data);
      if (config.type === 'house' && data.sync_required) {
        await ensureHouseSyncEnabled(collaborationHouseId);
        setHouseSyncEnabledState(true);
      }
    } catch (error) {
      console.warn('Failed to load house collaboration', error);
      setCollaboration(null);
    } finally {
      setCollaborationLoading(false);
    }
  }, [collaborationHouseId, config.type, houses, user]);

  useEffect(() => {
    void refreshCollaboration();
  }, [refreshCollaboration]);

  const handleToggleHouseSync = useCallback(
    async (nextEnabled: boolean) => {
      if (config.type !== 'house' || !entityId) return;
      if (!nextEnabled && collaboration?.sync_required) {
        Alert.alert('Required', 'Cloud sync is required while this house has members or active invites.');
        return;
      }
      if (nextEnabled && !user) {
        Alert.alert('Sign in required', 'Sign in to enable cloud sync for this house.');
        openSignIn(`/houses/${entityId}?entry=${entry}`);
        return;
      }

      setHouseSyncLoading(true);
      try {
        if (nextEnabled) {
          if (user) {
            await enableHouseSyncForUser(entityId, user.id);
          }
          await setHouseSyncEnabled(entityId, true);
          setHouseSyncEnabledState(true);
        } else {
          await setHouseSyncEnabled(entityId, false);
          setHouseSyncEnabledState(false);
          await pruneQueuedChangesForHouse(entityId);
        }
      } catch (error) {
        console.warn('Failed to update house sync state', error);
        const errorMessage = error instanceof Error ? error.message : 'Failed to update house sync setting.';
        Alert.alert('Error', __DEV__ ? errorMessage : 'Failed to update house sync setting.');
      } finally {
        setHouseSyncLoading(false);
      }
    },
    [collaboration?.sync_required, config.type, entityId, entry, openSignIn, user]
  );

  const parentTypes = useMemo(() => {
    if (SUPPORTED_PARENT_TYPES[config.type]?.length) {
      return SUPPORTED_PARENT_TYPES[config.type]!;
    }
    return config.parent ? [config.parent.type] : [];
  }, [config.parent, config.type]);

  const childParentId = entityId ?? '__new__';
  const emptyParentId = '__none__';

  const parentHouseId = selectedHouseId || activeHouseId || undefined;
  const { rooms } = useRooms(parentHouseId, globalRefreshKey);
  const { containers } = useContainers(parentHouseId);
  const { boxes } = useBoxes(parentHouseId);

  const { rooms: houseRooms } = useRooms(
    config.type === 'house' && entityId ? entityId : emptyParentId,
    globalRefreshKey
  );
  const { containers: roomContainers } = useContainers(
    undefined,
    config.type === 'room' ? childParentId : emptyParentId,
    globalRefreshKey
  );
  const { boxes: roomBoxes } = useBoxes(
    undefined,
    'room',
    config.type === 'room' ? childParentId : emptyParentId,
    globalRefreshKey
  );
  const { items: roomItems } = useItems(
    undefined,
    'room',
    config.type === 'room' ? childParentId : emptyParentId,
    globalRefreshKey
  );
  const { boxes: containerBoxes } = useBoxes(
    undefined,
    'container',
    config.type === 'container' ? childParentId : emptyParentId,
    globalRefreshKey
  );
  const { items: containerItems } = useItems(
    undefined,
    'container',
    config.type === 'container' ? childParentId : emptyParentId,
    globalRefreshKey
  );
  const { items: boxItems } = useItems(
    undefined,
    'box',
    config.type === 'box' ? childParentId : emptyParentId,
    globalRefreshKey
  );
  const {
    itemImages,
    addItemImage,
    updateItemImage,
    deleteItemImage,
  } = useItemImages(config.type === 'item' && entityId ? entityId : undefined, globalRefreshKey);
  const visibleItemImages = useMemo(
    () => (config.type === 'item' ? itemImages.filter((image) => !hiddenItemImageIds.has(image.id)) : itemImages),
    [config.type, hiddenItemImageIds, itemImages]
  );
  const mergedItemImages = useMemo(() => {
    if (config.type !== 'item') return visibleItemImages;
    const byId = new Map<string, any>();
    visibleItemImages.forEach((image) => byId.set(image.id, image));
    optimisticItemImages.forEach((image) => {
      if (image.itemId === entityId) byId.set(image.id, image);
    });
    return Array.from(byId.values());
  }, [config.type, entityId, optimisticItemImages, visibleItemImages]);
  const sortedItemImages = useMemo(
    () => {
      const preferImage = (existing: any, next: any) => {
        const existingHasLocalPath = Boolean(existing.imagePath);
        const nextHasLocalPath = Boolean(next.imagePath);
        if (existingHasLocalPath !== nextHasLocalPath) {
          return nextHasLocalPath ? next : existing;
        }

        const existingIsOptimistic = Boolean(existing.optimistic);
        const nextIsOptimistic = Boolean(next.optimistic);
        if (existingIsOptimistic !== nextIsOptimistic) {
          return existingIsOptimistic ? next : existing;
        }

        const existingHasRemotePath = Boolean(existing.remotePath);
        const nextHasRemotePath = Boolean(next.remotePath);
        if (existingHasRemotePath !== nextHasRemotePath) {
          return nextHasRemotePath ? next : existing;
        }

        return String(next.id).localeCompare(String(existing.id)) < 0 ? next : existing;
      };

      const bySlot = new Map<string, any>();
      [...mergedItemImages].forEach((image) => {
        const position = Number.isFinite(image.position) ? image.position : 0;
        const slot = `${image.itemId ?? entityId ?? ''}:${position}`;
        const existing = bySlot.get(slot);
        bySlot.set(slot, existing ? preferImage(existing, image) : image);
      });

      const byIdentity = new Map<string, any>();
      Array.from(bySlot.values()).forEach((image) => {
        const identity = itemImageIdentityKey(image);
        if (!identity) return;
        const existing = byIdentity.get(identity);
        byIdentity.set(identity, existing ? preferImage(existing, image) : image);
      });

      return Array.from(byIdentity.values()).sort((left, right) => {
        if ((left.position ?? 0) !== (right.position ?? 0)) {
          return (left.position ?? 0) - (right.position ?? 0);
        }
        return String(left.id).localeCompare(String(right.id));
      });
    },
    [entityId, mergedItemImages]
  );
  const visibleGalleryItemImages = useMemo(
    () => sortedItemImages.filter((image) => Boolean(image.imagePath)),
    [sortedItemImages]
  );
  const selectedItemImage =
    sortedItemImages.find((image) => image.id === selectedItemImageId) ?? sortedItemImages[0] ?? null;
  const selectedItemImageIndex = selectedItemImage
    ? Math.max(
        0,
        visibleGalleryItemImages.findIndex((image) => image.id === selectedItemImage.id)
      )
    : 0;
  const fullScreenImagePath =
    config.type === 'item' ? selectedItemImage?.imagePath ?? null : (entity as any)?.imagePath || null;
  const fullScreenImages = useMemo(() => {
    if (config.type !== 'item') {
      return fullScreenImagePath ? [{ id: null, imagePath: fullScreenImagePath }] : [];
    }
    return visibleGalleryItemImages
      .map((image) => ({ id: image.id, imagePath: image.imagePath as string }));
  }, [config.type, fullScreenImagePath, visibleGalleryItemImages]);
  const fullScreenImagePaths = useMemo(
    () => fullScreenImages.map((image) => image.imagePath),
    [fullScreenImages]
  );
  const fullScreenInitialImageIndex = Math.max(
    0,
    fullScreenImages.findIndex((image) => image.id === selectedItemImage?.id)
  );
  const hasReachedItemPictureLimit =
    config.type === 'item' && sortedItemImages.length >= itemPictureLimit;

  useEffect(() => {
    if (config.type !== 'item') {
      setOptimisticItemImages([]);
      setHiddenItemImageIds(new Set());
      return;
    }
    setOptimisticItemImages((current) =>
      current.filter((optimisticImage) => {
        if (optimisticImage.itemId !== entityId) return false;
        return true;
      })
    );
  }, [config.type, entityId]);

  useEffect(() => {
    setHiddenItemImageIds(new Set());
  }, [entityId]);

  useEffect(() => {
    if (config.type !== 'item') return;
    if (!sortedItemImages.length) {
      setSelectedItemImageId(null);
      return;
    }
    if (selectedItemImageId && sortedItemImages.some((image) => image.id === selectedItemImageId)) {
      return;
    }
    setSelectedItemImageId(sortedItemImages[0].id);
  }, [config.type, selectedItemImageId, sortedItemImages]);

  const roomMap = useMemo(() => new Map(rooms.map((room) => [room.id, room])), [rooms]);
  const containerMap = useMemo(
    () => new Map(containers.map((container) => [container.id, container])),
    [containers]
  );

  const joinLocation = useCallback(
    (parts: Array<string | undefined | null>) => parts.filter(Boolean).join(' > '),
    []
  );

  const getRoomName = useCallback(
    (roomId?: string | null) => {
      if (!roomId) return '';
      const room = roomMap.get(roomId);
      return room?.name || '';
    },
    [roomMap]
  );

  const getContainerLocationLabel = useCallback(
    (containerId?: string | null) => {
      if (!containerId) return '';
      const container = containerMap.get(containerId);
      if (!container) return '';
      const room = container.roomId ? roomMap.get(container.roomId) : undefined;
      return room?.name || '';
    },
    [containerMap, roomMap]
  );

  const getBoxLocationLabel = useCallback(
    (boxId?: string | null) => {
      if (!boxId) return '';
      const box = boxes.find((b) => b.id === boxId);
      if (!box) return '';
      if (box.parentType === 'room') {
        return getRoomName(box.parentId);
      }
      if (box.parentType === 'container') {
        const container = box.parentId ? containerMap.get(box.parentId) : undefined;
        const room = container?.roomId ? roomMap.get(container.roomId) : undefined;
        return joinLocation([room?.name, container?.name]);
      }
      return '';
    },
    [boxes, containerMap, getRoomName, joinLocation, roomMap]
  );

  const parentOptions = useMemo(
    () => ({
      room: rooms.map((room) => ({
        id: room.id,
        name: room.name,
        location: '',
      })),
      container: containers.map((container) => ({
        id: container.id,
        name: container.name,
        location: getContainerLocationLabel(container.id),
      })),
      box: boxes.map((box) => ({
        id: box.id,
        name: box.name,
        location: getBoxLocationLabel(box.id),
      })),
    }),
    [
      boxes,
      containers,
      getBoxLocationLabel,
      getContainerLocationLabel,
      rooms,
    ]
  );

  const resetContextualCreateState = useCallback(() => {
    setContextualCreateType(null);
    setContextualCreateValues({});
    setContextualCreateParentType('');
    setContextualCreateParentId('');
    setContextualCreateHouseId('');
    setContextualCreateImagePath(null);
    setContextualCreateImagePaths([]);
    setContextualCreateImageIndex(0);
    setContextualCreateImageLoading(false);
    setContextualCreateError(null);
  }, []);

  const openContextualCreateSheet = useCallback(
    (childType: EntityType) => {
      if (!entityId || isFormMode) return;

      const childConfig = ENTITY_CONFIGS[childType];
      if (!childConfig) return;

      const nextValues = childConfig.fields.reduce((acc, field) => {
        acc[String(field.key)] = '';
        return acc;
      }, {} as Record<string, string>);

      const currentHouseId =
        config.type === 'house'
          ? entityId
          : ((entity as any)?.houseId as string | undefined) || selectedHouseId || activeHouseId || '';

      let nextParentType: EntityType | '' = '';
      let nextParentId = '';

      if (config.type === 'room') {
        nextParentId = entityId;
        if (childType === 'box' || childType === 'item') {
          nextParentType = 'room';
        }
      } else if (config.type === 'container') {
        nextParentType = 'container';
        nextParentId = entityId;
      } else if (config.type === 'box') {
        nextParentType = 'box';
        nextParentId = entityId;
      }

      setCreateSheetVisible(true);
      setContextualCreateType(childType);
      setContextualCreateValues(nextValues);
      setContextualCreateParentType(nextParentType);
      setContextualCreateParentId(nextParentId);
      setContextualCreateHouseId(currentHouseId);
      setContextualCreateImagePath(null);
      setContextualCreateImagePaths([]);
      setContextualCreateImageIndex(0);
      setContextualCreateImageLoading(false);
      setContextualCreateError(null);
    },
    [activeHouseId, config.type, entity, entityId, isFormMode, selectedHouseId]
  );

  const closeContextualCreateSheet = useCallback(() => {
    setCreateSheetVisible(false);
    createSheetRef.current?.dismiss();
  }, []);

  const childItemsByType = useMemo(
    () => ({
      room: houseRooms.map((room) => ({ id: room.id, name: room.name, description: room.description })),
      container: roomContainers.map((container) => ({
        id: container.id,
        name: container.name,
        description: container.description,
      })),
      box: (config.type === 'room' ? roomBoxes : containerBoxes).map((box) => ({
        id: box.id,
        name: box.name,
        description: box.description,
      })),
      item: (config.type === 'room' ? roomItems : config.type === 'container' ? containerItems : boxItems).map(
        (item) => ({
          id: item.id,
          name: item.name,
          description: item.description,
        })
      ),
    }),
    [
      boxItems,
      config.type,
      containerBoxes,
      containerItems,
      houseRooms,
      roomBoxes,
      roomContainers,
      roomItems,
    ]
  );

  const childSections = useMemo(() => {
    if (!entityId) return [] as { type: EntityType; label: string; icon: string; items: ChildSectionItem[] }[];

    return (config.children || []).map((child) => ({
      type: child.type,
      label: child.label,
      icon: child.icon,
      items: childItemsByType[child.type as keyof typeof childItemsByType] || [],
    }));
  }, [childItemsByType, config.children, entityId]);

  const locationPath = useMemo(() => {
    if (!entity) return null;
    if (config.type === 'house') return undefined;

    const houseName = houses.find((house) => house.id === (entity as any).houseId)?.name;
    if (config.type === 'room') {
      return houseName || null;
    }

    if (config.type === 'container') {
      const roomName = rooms.find((r) => r.id === (entity as any).roomId)?.name;
      const parts = [];
      if (houseName) parts.push(houseName);
      if (roomName) parts.push(roomName);
      return parts.length > 0 ? parts.join(' > ') : null;
    }

    const parts: string[] = [];
    if (houseName) parts.push(houseName);
    if ((entity as any).parentType === 'room') {
      const roomName = rooms.find((r) => r.id === (entity as any).parentId)?.name;
      if (roomName) parts.push(roomName);
    }

    if ((entity as any).parentType === 'container') {
      const container = containers.find((c) => c.id === (entity as any).parentId);
      if (container) {
        const roomName = rooms.find((r) => r.id === container.roomId)?.name;
        if (roomName) parts.push(roomName);
        parts.push(container.name);
      }
    }

    if ((entity as any).parentType === 'box') {
      const box = boxes.find((b) => b.id === (entity as any).parentId);
      if (box) {
        if (box.parentType === 'room') {
          const roomName = rooms.find((r) => r.id === box.parentId)?.name;
          if (roomName) parts.push(roomName);
        }
        if (box.parentType === 'container') {
          const container = containers.find((c) => c.id === box.parentId);
          if (container) {
            const roomName = rooms.find((r) => r.id === container.roomId)?.name;
            if (roomName) parts.push(roomName);
            parts.push(container.name);
          }
        }
        parts.push(box.name);
      }
    }

    return parts.length > 0 ? parts.join(' > ') : null;
  }, [boxes, config.type, containers, entity, entityRevision, houses, rooms]);

  /* ----------------------------- Back handling ----------------------------- */
  const completeBackNavigation = useCallback(() => {
    if (shouldReturnToInbox) {
      router.replace('/inbox');
      return;
    }
    if (isDirectEntry || !router.canGoBack()) {
      router.replace('/');
    } else {
      router.back();
    }
  }, [isDirectEntry, shouldReturnToInbox]);

  const handleBack = useCallback(() => {
    if (createSheetIndex >= 0) {
      createSheetRef.current?.dismiss();
      return;
    }
    if (inviteSheetIndex >= 0 || manageMemberSheetIndex >= 0) {
      inviteSheetRef.current?.dismiss();
      manageMemberSheetRef.current?.dismiss();
      return;
    }
    completeBackNavigation();
  }, [completeBackNavigation, createSheetIndex, inviteSheetIndex, manageMemberSheetIndex]);

  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        handleBack();
        return true;
      });

      return () => sub.remove();
    }, [handleBack])
  );

  useFocusEffect(
    useCallback(() => {
      if (isFormMode || !entityId) return;

      refreshEntity();
    }, [entityId, isFormMode, refreshEntity])
  );

  const getPurchasePriceInputValue = useCallback((record: any) => {
    if (!record) return '';
    if (typeof record.purchasePriceCents === 'number') {
      return formatCentsForInput(record.purchasePriceCents);
    }
    return '';
  }, []);

  /* ----------------------------- DATA LOAD ----------------------------- */
  useEffect(() => {
    if (prevIsFormModeRef.current && !isFormMode) {
      refreshEntity();
    }
    prevIsFormModeRef.current = isFormMode;
  }, [isFormMode, refreshEntity]);

  useEffect(() => {
    hasInitializedHouseRef.current = false;
  }, [entityId, isAddMode, isEditMode]);

  useEffect(() => {
    const load = async () => {
      try {
        if (!isAddMode && entityId) {
          const record = (await loadPowerSyncEntity()) ?? await database.collections.get<any>(config.collection as TableName).find(entityId);
          setEntity(record);

          if (isEditMode) {
            const nextFieldValues = { ...defaultFieldValues };
            config.fields.forEach((field) => {
              if (field.key === 'purchasePrice') {
                nextFieldValues[String(field.key)] = getPurchasePriceInputValue(record);
              } else {
                nextFieldValues[String(field.key)] = (record as any)[field.key] || '';
              }
            });
            setFieldValues(nextFieldValues);
            if (config.type === 'container') {
              setParentType('room');
              setParentId((record as any).roomId || '');
            } else {
              setParentType(((record as any).parentType || '') as EntityType | '');
              setParentId((record as any).parentId || '');
            }
            if (!hasInitializedHouseRef.current) {
              setSelectedHouseId((record as any).houseId || '');
              hasInitializedHouseRef.current = true;
            }
            if (config.type !== 'item') {
              setImagePath((record as any).imagePath || null);
            }
          } else {
            setSelectedHouseId((record as any).houseId || '');
          }
        } else {
          const defaultParentType = parentTypes.length === 1 ? parentTypes[0] : '';
          setParentType(((params.parentType as EntityType) || defaultParentType || '') as EntityType | '');
          setParentId((params.parentId as string) || (params.roomId as string) || '');

          let nextHouseId = (params.houseId as string) || '';
          const paramParentType = params.parentType as EntityType | undefined;
          const paramParentId = params.parentId as string | undefined;
          if (!nextHouseId && paramParentType === 'house' && paramParentId) {
            nextHouseId = paramParentId;
          }
          if (!nextHouseId && paramParentType && paramParentId && paramParentType !== 'house') {
            const collection =
              paramParentType === 'room'
                ? 'rooms'
                : paramParentType === 'container'
                ? 'containers'
                : 'boxes';
            try {
              const parentRecord = await database.collections.get<any>(collection).find(paramParentId);
              nextHouseId = parentRecord?.houseId || '';
            } catch {
              nextHouseId = '';
            }
          }
          if (!nextHouseId && paramParentType && paramParentId && paramParentType !== 'house') {
            const parentRecord = await loadPowerSyncEntityByType(paramParentType, paramParentId);
            nextHouseId = (parentRecord as any)?.houseId || '';
          }
          if (!nextHouseId && activeHouseId) {
            nextHouseId = activeHouseId;
          }
          if (!hasInitializedHouseRef.current) {
            setSelectedHouseId(nextHouseId);
            hasInitializedHouseRef.current = true;
          }
        }
      } catch (error) {
        if (
          !isDatabaseResetting &&
          !isAccountDeletionInProgress() &&
          !isInventoryBootstrapInProgress() &&
          !isAddMode &&
          isMissingLocalRecordError(error)
        ) {
          if (router.canGoBack()) {
            router.back();
          } else {
            router.replace('/');
          }
          return;
        }
        if (
          !isDatabaseResetting &&
          !isAccountDeletionInProgress() &&
          !isActiveHouseSwitchInProgress() &&
          !isInventoryBootstrapInProgress()
        ) {
          Alert.alert('Error', `Failed to load ${config.title.toLowerCase()}`);
        }
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [
    config.collection,
    config.fields,
    config.title,
    defaultFieldValues,
    entityId,
    loadPowerSyncEntity,
    loadPowerSyncEntityByType,
    isAddMode,
    isEditMode,
    activeHouseId,
    params.parentId,
    params.parentType,
    params.houseId,
    params.roomId,
    parentTypes,
  ]);

  /* ----------------------------- Reset add form ----------------------------- */

  useFocusEffect(
    useCallback(() => {
      if (!isAddMode) return;

      let isActive = true;
      const resetForm = async () => {
        setFieldValues({
          ...defaultFieldValues,
          ...(prefillName ? { name: shouldReturnToInbox ? prefillName : prefillName } : {}),
          ...(prefillNotes ? { notes: shouldReturnToInbox ? prefillNotes : prefillNotes } : {}),
        });
        setImagePath(null);
        setCreateItemImagePaths([]);
        setCreateItemImageIndex(0);
        const defaultParentType = parentTypes.length === 1 ? parentTypes[0] : '';
        setParentType(((params.parentType as EntityType) || defaultParentType || '') as EntityType | '');
        setParentId((params.parentId as string) || (params.roomId as string) || '');

        let nextHouseId = (params.houseId as string) || '';
        const paramParentType = params.parentType as EntityType | undefined;
        const paramParentId = params.parentId as string | undefined;
        if (!nextHouseId && paramParentType === 'house' && paramParentId) {
          nextHouseId = paramParentId;
        }
        if (!nextHouseId && paramParentType && paramParentId && paramParentType !== 'house') {
          const collection =
            paramParentType === 'room'
              ? 'rooms'
              : paramParentType === 'container'
              ? 'containers'
              : 'boxes';
          try {
            const parentRecord = await database.collections.get<any>(collection).find(paramParentId);
            nextHouseId = parentRecord?.houseId || '';
          } catch {
            nextHouseId = '';
          }
        }
        if (!nextHouseId && paramParentType && paramParentId && paramParentType !== 'house') {
          const parentRecord = await loadPowerSyncEntityByType(paramParentType, paramParentId);
          nextHouseId = (parentRecord as any)?.houseId || '';
        }
        if (!nextHouseId && activeHouseId) {
          nextHouseId = activeHouseId;
        }
        if (isActive) {
          setSelectedHouseId(nextHouseId);
        }
      };
      resetForm();
      return () => {
        isActive = false;
      };
    }, [
      activeHouseId,
      defaultFieldValues,
      isAddMode,
      prefillName,
      prefillNotes,
      loadPowerSyncEntityByType,
      params.houseId,
      params.parentId,
      params.parentType,
      params.roomId,
      parentTypes,
      shouldReturnToInbox,
    ])
  );

  /* ----------------------------- Image helpers ----------------------------- */

  async function handlePickImage() {
    if (!isPlatformSupported()) {
      Alert.alert('Not supported', 'Image upload not supported');
      return;
    }
    await prepareForImagePicker();
    try {
      const result = await pickImage();
      if (result) {
        if (config.type === 'item' && isAddMode) {
          setCreateItemImagePaths((prev) => {
            if (!prev.length) {
              setCreateItemImageIndex(0);
              return [result.uri];
            }
            const next = [...prev];
            next[Math.min(createItemImageIndex, next.length - 1)] = result.uri;
            return next;
          });
        } else {
          setImagePath(result.uri);
        }
        trackRecordImageAdded(config.type, { source: 'form' });
      }
    } finally {
      setImageLoading(false);
    }
  }

  async function handleTakePhoto() {
    if (!isPlatformSupported()) {
      Alert.alert('Not supported', 'Camera not supported');
      return;
    }
    await prepareForImagePicker();
    try {
      const result = await takePhoto();
      if (result) {
        if (config.type === 'item' && isAddMode) {
          setCreateItemImagePaths((prev) => {
            if (!prev.length) {
              setCreateItemImageIndex(0);
              return [result.uri];
            }
            const next = [...prev];
            next[Math.min(createItemImageIndex, next.length - 1)] = result.uri;
            return next;
          });
        } else {
          setImagePath(result.uri);
        }
        trackRecordImageAdded(config.type, { source: 'form' });
      }
    } finally {
      setImageLoading(false);
    }
  }

  async function handleDeleteImage() {
    if (config.type === 'item' && isAddMode) {
      const currentPath = createItemImagePaths[createItemImageIndex];
      if (!currentPath) return;
      setImageLoading(true);
      try {
        await deleteImage(currentPath);
        setCreateItemImagePaths((prev) => {
          const next = prev.filter((_, index) => index !== createItemImageIndex);
          const nextIndex = next.length ? Math.min(createItemImageIndex, next.length - 1) : 0;
          setCreateItemImageIndex(nextIndex);
          return next;
        });
      } finally {
        setImageLoading(false);
      }
      return;
    }
    if (!imagePath) return;
    setImageLoading(true);
    try {
      await deleteImage(imagePath);
      setImagePath(null);
    } finally {
      setImageLoading(false);
    }
  }

  async function handleContextualCreatePickImage() {
    if (!contextualCreateType) return;
    if (!isPlatformSupported()) {
      Alert.alert('Not supported', 'Image upload not supported');
      return;
    }
    setContextualCreateImageLoading(true);
    try {
      const result = await pickImage();
      if (result) {
        if (contextualCreateType === 'item') {
          setContextualCreateImagePaths((prev) => {
            if (!prev.length) {
              setContextualCreateImageIndex(0);
              return [result.uri];
            }
            const next = [...prev];
            next[Math.min(contextualCreateImageIndex, next.length - 1)] = result.uri;
            return next;
          });
          setContextualCreateImagePath(result.uri);
        } else {
          setContextualCreateImagePath(result.uri);
        }
        trackRecordImageAdded(contextualCreateType, { source: 'form' });
      }
    } finally {
      setContextualCreateImageLoading(false);
    }
  }

  async function handleContextualCreateTakePhoto() {
    if (!contextualCreateType) return;
    if (!isPlatformSupported()) {
      Alert.alert('Not supported', 'Camera not supported');
      return;
    }
    setContextualCreateImageLoading(true);
    try {
      const result = await takePhoto();
      if (result) {
        if (contextualCreateType === 'item') {
          setContextualCreateImagePaths((prev) => {
            if (!prev.length) {
              setContextualCreateImageIndex(0);
              return [result.uri];
            }
            const next = [...prev];
            next[Math.min(contextualCreateImageIndex, next.length - 1)] = result.uri;
            return next;
          });
          setContextualCreateImagePath(result.uri);
        } else {
          setContextualCreateImagePath(result.uri);
        }
        trackRecordImageAdded(contextualCreateType, { source: 'form' });
      }
    } finally {
      setContextualCreateImageLoading(false);
    }
  }

  async function handleContextualCreateDeleteImage() {
    if (contextualCreateType === 'item') {
      const currentPath = contextualCreateImagePaths[contextualCreateImageIndex];
      if (!currentPath) return;
      setContextualCreateImageLoading(true);
      try {
        await deleteImage(currentPath);
        setContextualCreateImagePaths((prev) => {
          const next = prev.filter((_, index) => index !== contextualCreateImageIndex);
          const nextIndex = next.length ? Math.min(contextualCreateImageIndex, next.length - 1) : 0;
          setContextualCreateImageIndex(nextIndex);
          setContextualCreateImagePath(next[nextIndex] ?? null);
          return next;
        });
      } finally {
        setContextualCreateImageLoading(false);
      }
      return;
    }
    if (!contextualCreateImagePath) return;
    setContextualCreateImageLoading(true);
    try {
      await deleteImage(contextualCreateImagePath);
      setContextualCreateImagePath(null);
    } finally {
      setContextualCreateImageLoading(false);
    }
  }

  const handleCreateItemAddImage = useCallback(
    async (source: 'gallery' | 'camera') => {
      if (config.type !== 'item' || !isAddMode) return;
      if (!isPlatformSupported()) {
        Alert.alert('Not supported', source === 'gallery' ? 'Image upload not supported' : 'Camera not supported');
        return;
      }
      await prepareForImagePicker();
      try {
        await assertCanSetItemPictureCount(createItemImagePaths.length + 1);
        const result = source === 'gallery' ? await pickImage() : await takePhoto();
        if (!result) return;
        setCreateItemImagePaths((prev) => [...prev, result.uri]);
        setCreateItemImageIndex(createItemImagePaths.length);
        trackRecordImageAdded(config.type, { source: 'form' });
      } catch (error: any) {
        if (error?.message === ITEM_PICTURE_LIMIT_ERROR) {
          Alert.alert('Picture limit reached', `This plan supports up to ${itemPictureLimit} pictures per item.`);
          return;
        }
        throw error;
      } finally {
        setImageLoading(false);
      }
    },
    [config.type, createItemImagePaths.length, isAddMode, itemPictureLimit, prepareForImagePicker]
  );

  const handleContextualCreateAddImage = useCallback(
    async (source: 'gallery' | 'camera') => {
      if (contextualCreateType !== 'item') return;
      if (!isPlatformSupported()) {
        Alert.alert('Not supported', source === 'gallery' ? 'Image upload not supported' : 'Camera not supported');
        return;
      }
      setContextualCreateImageLoading(true);
      try {
        await assertCanSetItemPictureCount(contextualCreateImagePaths.length + 1);
        const result = source === 'gallery' ? await pickImage() : await takePhoto();
        if (!result) return;
        setContextualCreateImagePaths((prev) => [...prev, result.uri]);
        setContextualCreateImageIndex(contextualCreateImagePaths.length);
        setContextualCreateImagePath(result.uri);
        trackRecordImageAdded(contextualCreateType, { source: 'form' });
      } catch (error: any) {
        if (error?.message === ITEM_PICTURE_LIMIT_ERROR) {
          Alert.alert('Picture limit reached', `This plan supports up to ${itemPictureLimit} pictures per item.`);
          return;
        }
        throw error;
      } finally {
        setContextualCreateImageLoading(false);
      }
    },
    [contextualCreateImagePaths.length, contextualCreateType, itemPictureLimit]
  );

  const syncPowerSyncItemCoverImage = useCallback(
    async (nextCoverPath: string | null) => {
      if (!entityId || config.type !== 'item' || !entity) return null;
      const updated = await updatePowerSyncLocalItem({
        itemId: entityId,
        houseId: (entity as any).houseId,
        parentType: (entity as any).parentType ?? null,
        parentId: (entity as any).parentId ?? null,
        name: ((entity as any).name ?? '').trim(),
        description: (entity as any).description ?? null,
        imagePath: nextCoverPath,
        tags: (entity as any).tags ?? '',
        purchasePriceCents: (entity as any).purchasePriceCents ?? null,
        notes: (entity as any).notes ?? null,
        syncImageStorage: false,
      });
      setEntity(updated as unknown as LoadedEntity<T>);
      return updated;
    },
    [config.type, entity, entityId]
  );

  const updateItemImagePositions = useCallback(
    async (images: Array<{ id: string; position: number }>) => {
      for (const image of images) {
        await updateItemImage(image.id, { position: image.position }, { imageChanged: false });
      }
    },
    [updateItemImage]
  );

  const handleItemDetailAddImage = useCallback(
    async (source: 'gallery' | 'camera') => {
      if (!entityId || !entity || config.type !== 'item') return;
      if (!isPlatformSupported()) {
        Alert.alert('Not supported', source === 'gallery' ? 'Image upload not supported' : 'Camera not supported');
        return;
      }

      await prepareForImagePicker();
      let pendingOptimisticId: string | null = null;
      try {
        await assertCanAddItemPicture(entityId, sortedItemImages.length);
        const result = source === 'gallery' ? await pickImage() : await takePhoto();
        if (!result) return;

        const nextPosition =
          sortedItemImages.length > 0
            ? Math.max(...sortedItemImages.map((image) => image.position ?? 0)) + 1
            : 0;
        const optimisticId = createItemImageId(entityId, nextPosition);
        pendingOptimisticId = optimisticId;
        const optimisticImage: OptimisticItemImage = {
          id: optimisticId,
          itemId: entityId,
          houseId: (entity as any).houseId,
          imagePath: result.uri,
          remotePath: null,
          position: nextPosition,
          createdBy: null,
          updatedBy: null,
        };
        setOptimisticItemImages((current) => [...current, optimisticImage]);
        setSelectedItemImageId(optimisticId);

        const itemImage = await addItemImage(entityId, (entity as any).houseId, result.uri, nextPosition, optimisticId);
        if (nextPosition === 0) {
          await syncPowerSyncItemCoverImage(result.uri);
        }
        setHiddenItemImageIds((current) => {
          if (!current.has(itemImage.id)) return current;
          const next = new Set(current);
          next.delete(itemImage.id);
          return next;
        });
        setOptimisticItemImages((current) =>
          current.map((image) =>
            image.id === optimisticId
              ? {
                  ...image,
                  id: itemImage.id,
                  itemId: (itemImage as any).itemId ?? entityId,
                  houseId: (itemImage as any).houseId ?? (entity as any).houseId,
                  imagePath: (itemImage as any).imagePath ?? result.uri,
                  remotePath: (itemImage as any).remotePath ?? null,
                  position: (itemImage as any).position ?? nextPosition,
                }
              : image
          )
        );
        setSelectedItemImageId(itemImage.id);
        trackRecordImageAdded(config.type, { source: 'detail' });
        triggerGlobalRefresh();
      } catch (error: any) {
        if (pendingOptimisticId) {
          setOptimisticItemImages((current) => current.filter((image) => image.id !== pendingOptimisticId));
        }
        if (error?.message === ITEM_PICTURE_LIMIT_ERROR) {
          Alert.alert(
            'Picture limit reached',
            `This plan supports up to ${itemPictureLimit} pictures per item.`
          );
          return;
        }
        throw error;
      } finally {
        setImageLoading(false);
      }
    },
    [
      addItemImage,
      config.type,
      entity,
      entityId,
      itemPictureLimit,
      prepareForImagePicker,
      sortedItemImages,
      syncPowerSyncItemCoverImage,
    ]
  );

  const handleItemDetailDeleteImage = useCallback(async () => {
    if (!entityId || config.type !== 'item' || !selectedItemImage) return;

    setImageLoading(true);
    const deletedImageId = selectedItemImage.id;
    const remainingVisibleImages = sortedItemImages.filter((image) => image.id !== deletedImageId);
    const nextCoverImage = remainingVisibleImages[0] ?? null;
    setHiddenItemImageIds((current) => new Set(current).add(deletedImageId));
    setOptimisticItemImages((current) => current.filter((image) => image.id !== deletedImageId));
    setSelectedItemImageId(nextCoverImage?.id ?? null);
    if (!nextCoverImage && config.type === 'item') {
      setEntity((current) => (current ? { ...current, imagePath: null } : current));
    }
    try {
      await deleteItemImage(selectedItemImage.id);

      const remaining = remainingVisibleImages.map((image, index) => ({ id: image.id, position: index }));
      await updateItemImagePositions(remaining);
      await syncPowerSyncItemCoverImage(nextCoverImage?.imagePath ?? null);
    } catch (error) {
      setHiddenItemImageIds((current) => {
        const next = new Set(current);
        next.delete(deletedImageId);
        return next;
      });
      throw error;
    } finally {
      setImageLoading(false);
    }
  }, [
    config.type,
    deleteItemImage,
    entityId,
    selectedItemImage,
    sortedItemImages,
    syncPowerSyncItemCoverImage,
    updateItemImagePositions,
  ]);

  const handleItemDetailReplaceImage = useCallback(
    async (source: 'gallery' | 'camera') => {
      if (config.type !== 'item') return;
      if (!selectedItemImage) {
        await handleItemDetailAddImage(source);
        return;
      }
      if (!isPlatformSupported()) {
        Alert.alert('Not supported', source === 'gallery' ? 'Image upload not supported' : 'Camera not supported');
        return;
      }

      await prepareForImagePicker();
      try {
        const result = source === 'gallery' ? await pickImage() : await takePhoto();
        if (!result) return;

        setHiddenItemImageIds((current) => {
          if (!current.has(selectedItemImage.id)) return current;
          const next = new Set(current);
          next.delete(selectedItemImage.id);
          return next;
        });
        setOptimisticItemImages((current) => {
          const nextImage: OptimisticItemImage = {
            id: selectedItemImage.id,
            itemId: selectedItemImage.itemId,
            houseId: selectedItemImage.houseId,
            imagePath: result.uri,
            remotePath: null,
            position: selectedItemImage.position ?? 0,
            createdBy: (selectedItemImage as any).createdBy ?? null,
            updatedBy: (selectedItemImage as any).updatedBy ?? null,
          };
          const withoutCurrent = current.filter((image) => image.id !== selectedItemImage.id);
          return [...withoutCurrent, nextImage];
        });
        setSelectedItemImageId(selectedItemImage.id);

        await updateItemImage(
          selectedItemImage.id,
          { imagePath: result.uri, remotePath: null },
          { imageChanged: true }
        );
        if (entityId) {
          if (selectedItemImage.position === 0) {
            await syncPowerSyncItemCoverImage(result.uri);
          }
        }
        trackRecordImageAdded(config.type, { source: 'detail' });
      } finally {
        setImageLoading(false);
      }
    },
    [
      config.type,
      entityId,
      handleItemDetailAddImage,
      prepareForImagePicker,
      selectedItemImage,
      syncPowerSyncItemCoverImage,
      updateItemImage,
    ]
  );

  const isLocalOwnerForCollaborationHouse = Boolean(
    user?.id &&
      collaborationHouseId &&
      houses.some((house) => house.id === collaborationHouseId && house.ownerId === user.id)
  );
  const isLocalOwnerlessCollaborationHouse = Boolean(
    collaborationHouseId &&
      houses.some((house) => house.id === collaborationHouseId && !house.ownerId)
  );
  const isBootstrapDefaultHouse =
    config.type === 'house' && Boolean(entityId) && entityId === installDefaultHouseId;
  const isInstallDefaultCollaborationHouse =
    Boolean(collaborationHouseId) && collaborationHouseId === installDefaultHouseId;
  const houseSyncState = getHouseSyncState({
    houses,
    houseId: collaborationHouseId,
    houseSyncEnabled: houseSyncEnabled,
    userId: user?.id,
    isBootstrapInProgress: isInventoryBootstrapInProgress(),
    isDeletingAccountInProgress: isAccountDeletionInProgress(),
    isSyncing: houseSyncLoading,
  });
  const isLocalUnsyncedEditableHouse = houseSyncState.isEditableLocally;
  const isLocalOwner =
    config.type === 'house' &&
    Boolean(user?.id) &&
    Boolean(entityId) &&
    (((entity as any)?.ownerId as string | undefined) === user?.id);
  const collaborationDenied = collaboration?.allowed === false;
  const isCollaborationOwner =
    collaboration?.permissions?.is_owner === true || collaboration?.my_role === 'owner';
  const canWriteFromRole =
    isCollaborationOwner ||
    collaboration?.my_role === 'admin' ||
    collaboration?.my_role === 'editor';
  const canEditFromRole = isCollaborationOwner || collaboration?.my_role === 'admin';
  const canWriteContent = !user
    ? true
    : !collaborationHouseId
    ? true
    : isInstallDefaultCollaborationHouse || isLocalOwnerlessCollaborationHouse || isLocalUnsyncedEditableHouse
    ? true
    : collaborationDenied
    ? false
    : canWriteFromRole || (collaboration?.permissions?.can_write_content ?? true);
  const canEditHouse = !user
    ? true
    : !collaborationHouseId
    ? true
    : isBootstrapDefaultHouse ||
      isInstallDefaultCollaborationHouse ||
      isLocalOwner ||
      isLocalOwnerlessCollaborationHouse ||
      isLocalUnsyncedEditableHouse
    ? true
    : collaborationDenied
    ? false
    : canEditFromRole || (collaboration?.permissions?.can_edit_house ?? true);
  const canAdminHouse =
    (collaboration?.permissions?.can_admin ??
      (collaboration?.my_role === 'owner' || collaboration?.my_role === 'admin')) ||
    isLocalOwner;
  const canLeaveHouse =
    config.type === 'house' &&
    !isLocalOwner &&
    !(collaboration?.permissions?.is_owner ?? false) &&
    (collaboration?.permissions?.can_leave ?? false);
  const isHouseOwner = !user
    ? true
    : !collaborationHouseId
    ? true
    : isBootstrapDefaultHouse || isInstallDefaultCollaborationHouse || isLocalOwner || isLocalOwnerlessCollaborationHouse
    ? true
    : collaborationDenied
    ? false
    : isCollaborationOwner || (collaboration?.permissions?.is_owner ?? isLocalOwnerForCollaborationHouse);
  const canModifyCurrentEntity = config.type === 'house' ? canEditHouse : canWriteContent;
  const canDeleteCurrentEntity = config.type === 'house' ? isHouseOwner : canWriteContent;

  useEffect(() => {
    if (!isAddMode || config.type === 'house') {
      addDeniedAlertShownRef.current = false;
      return;
    }
    if (isAccountDeletionInProgress()) {
      addDeniedAlertShownRef.current = false;
      return;
    }
    if (!user || !collaborationHouseId || collaborationLoading) return;
    if (canWriteContent) {
      addDeniedAlertShownRef.current = false;
      return;
    }
    if (addDeniedAlertShownRef.current) return;
    addDeniedAlertShownRef.current = true;
    Alert.alert(
      'Not allowed',
      'You have view-only access in this house and cannot add records.',
      [
        {
          text: 'OK',
          onPress: () => {
            if (router.canGoBack()) {
              router.back();
            } else {
              router.replace('/');
            }
          },
        },
      ]
    );
  }, [canWriteContent, collaborationHouseId, collaborationLoading, config.type, isAddMode, user]);

  /* ----------------------------- SAVE ----------------------------- */
  const handleContextualCreateSave = async () => {
    if (!contextualCreateConfig || !contextualCreateType) return;
    if (!canWriteContent) {
      Alert.alert('Not allowed', 'You do not have permission to add records in this house.');
      return;
    }

    const validationError = getContextualCreateValidationError({
      config: contextualCreateConfig,
      type: contextualCreateType,
      values: contextualCreateValues,
      houseId: contextualCreateHouseId,
      parentType: contextualCreateParentType,
      parentId: contextualCreateParentId,
    });

    if (validationError) {
      setContextualCreateError(validationError);
      return;
    }
    setContextualCreateError(null);

    const contextualCreateItemImages =
      contextualCreateType === 'item'
        ? contextualCreateImagePaths.filter(Boolean)
        : [];

    setSaving(true);
    try {
      if (contextualCreateConfig.limits?.check) {
        await contextualCreateConfig.limits.check();
      }

      if (['room', 'container', 'box', 'item'].includes(contextualCreateType)) {
        if (contextualCreateType === 'item' && contextualCreateItemImages.length) {
          await assertCanSetItemPictureCount(contextualCreateItemImages.length);
        }

        const created =
          contextualCreateType === 'room'
            ? await createPowerSyncLocalRoom({
                houseId: contextualCreateHouseId,
                name: contextualCreateValues.name?.trim() || '',
                description: contextualCreateValues.description?.trim() || null,
                imagePath: contextualCreateImagePath || null,
              })
            : contextualCreateType === 'container'
              ? await createPowerSyncLocalContainer({
                  houseId: contextualCreateHouseId,
                  roomId: contextualCreateParentId,
                  name: contextualCreateValues.name?.trim() || '',
                  description: contextualCreateValues.description?.trim() || null,
                  imagePath: contextualCreateImagePath || null,
                })
              : contextualCreateType === 'box'
                ? await createPowerSyncLocalBox({
                    houseId: contextualCreateHouseId,
                    parentType: contextualCreateParentType || null,
                    parentId: contextualCreateParentId || null,
                    name: contextualCreateValues.name?.trim() || '',
                    description: contextualCreateValues.description?.trim() || null,
                    imagePath: contextualCreateImagePath || null,
                  })
                : await createPowerSyncLocalItem({
                    houseId: contextualCreateHouseId,
                    parentType: contextualCreateParentType || null,
                    parentId: contextualCreateParentId || null,
                    name: contextualCreateValues.name?.trim() || '',
                    description: contextualCreateValues.description?.trim() || null,
                    imagePath: contextualCreateItemImages[0] ?? null,
                    tags: contextualCreateValues.tags ?? '',
                    purchasePriceCents: parseCurrencyToCents(contextualCreateValues.purchasePrice ?? ''),
                    notes: contextualCreateValues.notes?.trim() || null,
                    syncImageStorage: contextualCreateItemImages.length === 0,
                  });

        if (contextualCreateType === 'item' && contextualCreateItemImages.length) {
          for (const [index, currentImagePath] of contextualCreateItemImages.entries()) {
            await addItemImage(created.id, created.houseId, currentImagePath, index);
          }
        }

        trackRecordCreated(contextualCreateType, { source: 'form' });
        closeContextualCreateSheet();
        triggerGlobalRefresh();
        router.push(`/${toRouteSegment(contextualCreateType)}/${created.id}` as any);
        return;
      }

      const created = await database.write(async () =>
        database.collections.get<any>(contextualCreateConfig.collection as TableName).create((record: any) => {
          contextualCreateConfig.fields.forEach((field) => {
            const value = contextualCreateValues[String(field.key)]?.trim() || '';
            if (field.key === 'purchasePrice') {
              record.purchasePriceCents = parseCurrencyToCents(value);
              return;
            }
            record[field.key] = value;
          });

          if (contextualCreateType === 'container') {
            record.roomId = contextualCreateParentId;
          } else if (contextualCreateType === 'box' || contextualCreateType === 'item') {
            record.parentType = contextualCreateParentType || null;
            record.parentId = contextualCreateParentId || null;
          }

          record.imagePath =
            contextualCreateType === 'item'
              ? contextualCreateItemImages[0] ?? null
              : contextualCreateImagePath || null;
          if (contextualCreateType !== 'house') {
            record.houseId = contextualCreateHouseId;
          }
        })
      );

      if (!created?.id) {
        Alert.alert('Error', `Failed to save ${contextualCreateConfig.title.toLowerCase()}`);
        return;
      }

      if (contextualCreateType === 'item') {
        if (contextualCreateItemImages.length) {
          await assertCanSetItemPictureCount(contextualCreateItemImages.length);
          for (const [index, currentImagePath] of contextualCreateItemImages.entries()) {
            await database.write(async () => {
              await database.collections.get<any>('item_images').create((record: any) => {
                if (index === 0) {
                  record._raw.id = getLegacyItemImageId(created.id);
                }
                record.itemId = created.id;
                record.houseId = created.houseId;
                record.imagePath = currentImagePath;
                record.remotePath = null;
                record.position = index;
              });
            });
          }
          await syncItemCoverImage(created.id);
        }
      }

      trackRecordCreated(contextualCreateType, { source: 'form' });
      closeContextualCreateSheet();
      router.push(`/${toRouteSegment(contextualCreateType)}/${created.id}` as any);
    } catch (e: any) {
      const errorCode = e?.message;
      if (
        errorCode === HOUSE_LIMIT_ERROR ||
        errorCode === STORAGE_UNIT_LIMIT_ERROR ||
        errorCode === ITEM_LIMIT_ERROR ||
        errorCode === ITEM_PICTURE_LIMIT_ERROR
      ) {
        let message = getLimitErrorMessage(errorCode);
        try {
          const limits = await getPlanLimits();
          message = getLimitErrorMessage(errorCode, limits);
        } catch {
          // Fallback to defaults if backend limits cannot be loaded.
        }
        Alert.alert('Limit reached', message ?? 'Plan limit reached.');
      } else {
        Alert.alert('Error', `Failed to save ${contextualCreateConfig.title.toLowerCase()}`);
      }
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async () => {
    if (!canModifyCurrentEntity) {
      Alert.alert('Not allowed', 'You do not have permission to modify this record.');
      return;
    }
    const missingField = config.fields.find(
      (field) => !field.optional && !fieldValues[String(field.key)].trim()
    );

    if (missingField) {
      Alert.alert('Error', `${missingField.label} is required`);
      return;
    }

    if (config.type !== 'house' && !selectedHouseId) {
      Alert.alert('Error', 'House selection is required');
      return;
    }

    if (config.parent?.required && (!parentType || !parentId)) {
      Alert.alert('Error', 'Parent selection is required');
      return;
    }

    const createModeItemImages =
      config.type === 'item' && isAddMode ? createItemImagePaths.filter(Boolean) : [];

    setSaving(true);
    try {
      if (isEditMode && entityId) {
        let updatedRecord: any;
        if (config.type === 'house') {
          updatedRecord = await updatePowerSyncLocalHouse({
            houseId: entityId,
            name: fieldValues.name.trim(),
            ownerId: user?.id,
            address: fieldValues.address?.trim() || null,
            notes: fieldValues.notes?.trim() || null,
            imagePath,
          });
        } else if (config.type === 'room') {
          updatedRecord = await updatePowerSyncLocalRoom({
            roomId: entityId,
            houseId: selectedHouseId || undefined,
            name: fieldValues.name.trim(),
            description: fieldValues.description?.trim() || null,
            imagePath,
          });
        } else if (config.type === 'container') {
          updatedRecord = await updatePowerSyncLocalContainer({
            containerId: entityId,
            houseId: selectedHouseId || undefined,
            roomId: parentId || (entity as any)?.roomId || undefined,
            name: fieldValues.name.trim(),
            description: fieldValues.description?.trim() || null,
            imagePath,
          });
        } else if (config.type === 'box') {
          updatedRecord = await updatePowerSyncLocalBox({
            boxId: entityId,
            houseId: selectedHouseId || undefined,
            parentType: parentType || (entity as any)?.parentType || undefined,
            parentId: parentId || (entity as any)?.parentId || undefined,
            name: fieldValues.name.trim(),
            description: fieldValues.description?.trim() || null,
            imagePath,
          });
        } else {
          updatedRecord = await updatePowerSyncLocalItem({
            itemId: entityId,
            houseId: selectedHouseId || undefined,
            parentType: parentType || (entity as any)?.parentType || undefined,
            parentId: parentId || (entity as any)?.parentId || undefined,
            name: fieldValues.name.trim(),
            description: fieldValues.description?.trim() || null,
            imagePath: (entity as any)?.imagePath ?? null,
            tags: fieldValues.tags ?? '',
            purchasePriceCents: parseCurrencyToCents(fieldValues.purchasePrice ?? ''),
            notes: fieldValues.notes?.trim() || null,
          });
        }
        setEntity(updatedRecord);
        setEntityRevision((prev) => prev + 1);
        triggerGlobalRefresh();
        router.back();
      } else {
        if (config.limits?.check) {
          await config.limits.check();
        }
        const created =
          config.type === 'house'
            ? await createPowerSyncLocalHouse({
                name: fieldValues.name.trim(),
                ownerId: user?.id ?? null,
                address: fieldValues.address?.trim() || null,
                notes: fieldValues.notes?.trim() || null,
                imagePath: imagePath || null,
              })
            : config.type === 'room'
              ? await createPowerSyncLocalRoom({
                  houseId: selectedHouseId,
                  name: fieldValues.name.trim(),
                  description: fieldValues.description?.trim() || null,
                  imagePath: imagePath || null,
                })
              : config.type === 'container'
                ? await createPowerSyncLocalContainer({
                    houseId: selectedHouseId,
                    roomId: parentId,
                    name: fieldValues.name.trim(),
                    description: fieldValues.description?.trim() || null,
                    imagePath: imagePath || null,
                  })
                : config.type === 'box'
                  ? await createPowerSyncLocalBox({
                      houseId: selectedHouseId,
                      parentType: parentType || null,
                      parentId: parentId || null,
                      name: fieldValues.name.trim(),
                      description: fieldValues.description?.trim() || null,
                      imagePath: imagePath || null,
                    })
                  : await createPowerSyncLocalItem({
                      houseId: selectedHouseId,
                      parentType: parentType || null,
                      parentId: parentId || null,
                      name: fieldValues.name.trim(),
                      description: fieldValues.description?.trim() || null,
                      imagePath: createModeItemImages[0] ?? null,
                      tags: fieldValues.tags ?? '',
                      purchasePriceCents: parseCurrencyToCents(fieldValues.purchasePrice ?? ''),
                      notes: fieldValues.notes?.trim() || null,
                      syncImageStorage: createModeItemImages.length === 0,
                    });

        if (config.type === 'item' && createModeItemImages.length) {
          await assertCanSetItemPictureCount(createModeItemImages.length);
          for (const [index, currentImagePath] of createModeItemImages.entries()) {
            await addItemImage(created.id, (created as any).houseId, currentImagePath, index);
          }
        }

        setEntity(created as unknown as LoadedEntity<T>);
        setSelectedHouseId((created as any).houseId || selectedHouseId);
        if (config.type !== 'item') {
          setImagePath((created as any).imagePath ?? imagePath ?? null);
        }
        setEntityRevision((prev) => prev + 1);
        trackRecordCreated(config.type, { source: 'form' });
        triggerGlobalRefresh();
        router.replace({
          pathname: `/${entityRouteSegment}/[id]` as any,
          params: {
            id: created.id,
            ...(entry === 'direct' ? { entry: 'direct' } : {}),
            mode: undefined,
            parentType: undefined,
            parentId: undefined,
            roomId: undefined,
            houseId: undefined,
            prefillName: undefined,
            prefillNotes: undefined,
            sourceInboxEntryId: undefined,
            deepLinkSource: undefined,
          },
        });
      }
    } catch (e: any) {
      const errorCode = e?.message;
      if (
        errorCode === HOUSE_LIMIT_ERROR ||
        errorCode === STORAGE_UNIT_LIMIT_ERROR ||
        errorCode === ITEM_LIMIT_ERROR ||
        errorCode === ITEM_PICTURE_LIMIT_ERROR
      ) {
        let message = getLimitErrorMessage(errorCode);
        try {
          const limits = await getPlanLimits();
          message = getLimitErrorMessage(errorCode, limits);
        } catch {
          // Fallback to defaults if backend limits cannot be loaded.
        }
        Alert.alert('Limit reached', message ?? 'Plan limit reached.');
      } else {
        Alert.alert('Error', `Failed to save ${config.title.toLowerCase()}`);
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = useCallback(() => {
    if (!entityId) return;
    if (!canDeleteCurrentEntity) {
      Alert.alert('Not allowed', 'You do not have permission to delete this record.');
      return;
    }

    if (config.type === 'house' && entityId === activeHouseId) {
      Alert.alert('Cannot delete', 'The active house cannot be deleted.');
      return;
    }

    setDeleteDialogVisible(true);
  }, [activeHouseId, canDeleteCurrentEntity, config.type, entityId]);

  const confirmDelete = useCallback(async () => {
    if (!entityId) return;
    setSaving(true);
    try {
      if (config.type === 'house') {
        await deletePowerSyncLocalHouse({ houseId: entityId });
      } else if (config.type === 'room') {
        await deletePowerSyncLocalRoom({ roomId: entityId });
      } else if (config.type === 'container') {
        await deletePowerSyncLocalContainer({ containerId: entityId });
      } else if (config.type === 'box') {
        await deletePowerSyncLocalBox({ boxId: entityId });
      } else {
        await deletePowerSyncLocalItem({ itemId: entityId });
      }
      setDeleteDialogVisible(false);
      triggerGlobalRefresh();
      handleBack();
    } catch (error) {
      console.warn('Failed to delete record', error);
      Alert.alert('Error', `Failed to delete ${config.title.toLowerCase()}`);
    } finally {
      setSaving(false);
    }
  }, [config.title, config.type, entityId, handleBack]);

  /* ============================= RENDER ============================= */
  const renderTitle = () => {
    if (isAddMode) return `New ${config.title}`;
    if (isEditMode) return `Edit ${config.title}`;
    return config.title;
  };

  const childFabActions = useMemo(() => {
    if (isFormMode) return [];
    if (!['room', 'container', 'box'].includes(config.type)) return [];
    if (!entityId) return [];
    if (!canWriteContent) return [];

    const actions: { key: string; label: string; icon: string; onPress: () => void }[] = (
      config.children || []
    ).map((child) => ({
      key: child.type,
      label: `Add ${child.label.endsWith('es') ? child.label.slice(0, -2) : child.label.endsWith('s') ? child.label.slice(0, -1) : child.label}`,
      icon: child.icon,
      onPress: () => openContextualCreateSheet(child.type),
    }));

    if (config.type === 'container' || config.type === 'box') {
      actions.push({
        key: 'bulk-voice-add',
        label: 'Bulk voice add',
        icon: 'microphone-plus',
        onPress: () =>
          router.push(`/items/voice-add?parentType=${config.type}&parentId=${entityId}`),
      });
    }

    return actions;
  }, [canWriteContent, config.children, config.type, entityId, isFormMode, openContextualCreateSheet]);
  const childFabCount = childFabActions?.length ?? 0;
  const shouldRenderFabOverlay =
    !isFormMode && childFabCount > 0 && isFocused && !createSheetVisible && !imageLoading && !fullImageVisible;

  useEffect(() => {
    if (!shouldRenderFabOverlay && fabOpen) {
      fabAnim.stopAnimation();
      fabAnim.setValue(0);
      setFabOpen(false);
    }
  }, [fabAnim, fabOpen, shouldRenderFabOverlay]);

  const fabOffsets = useMemo(
    () => [spacing.fabStackOffset1, spacing.fabStackOffset2, spacing.fabStackOffset3, spacing.fabStackOffset4],
    [spacing.fabStackOffset1, spacing.fabStackOffset2, spacing.fabStackOffset3, spacing.fabStackOffset4]
  );

  const updateEntityImagePath = useCallback(
    async (nextImagePath: string | null) => {
      if (!entityId) return;
      let updatedRecord: any;
      if (config.type === 'house') {
        updatedRecord = await updatePowerSyncLocalHouse({
          houseId: entityId,
          name: ((entity as any)?.name ?? '').trim(),
          ownerId: user?.id,
          address: (entity as any)?.address ?? null,
          notes: (entity as any)?.notes ?? null,
          imagePath: nextImagePath,
        });
      } else if (config.type === 'room') {
        updatedRecord = await updatePowerSyncLocalRoom({
          roomId: entityId,
          houseId: (entity as any)?.houseId,
          name: ((entity as any)?.name ?? '').trim(),
          description: (entity as any)?.description ?? null,
          imagePath: nextImagePath,
        });
      } else if (config.type === 'container') {
        updatedRecord = await updatePowerSyncLocalContainer({
          containerId: entityId,
          houseId: (entity as any)?.houseId,
          roomId: (entity as any)?.roomId,
          name: ((entity as any)?.name ?? '').trim(),
          description: (entity as any)?.description ?? null,
          imagePath: nextImagePath,
        });
      } else if (config.type === 'box') {
        updatedRecord = await updatePowerSyncLocalBox({
          boxId: entityId,
          houseId: (entity as any)?.houseId,
          parentType: (entity as any)?.parentType ?? null,
          parentId: (entity as any)?.parentId ?? null,
          name: ((entity as any)?.name ?? '').trim(),
          description: (entity as any)?.description ?? null,
          imagePath: nextImagePath,
          tags: (entity as any)?.tags ?? '',
        });
      } else {
        updatedRecord = await updatePowerSyncLocalItem({
          itemId: entityId,
          houseId: (entity as any)?.houseId,
          parentType: (entity as any)?.parentType ?? null,
          parentId: (entity as any)?.parentId ?? null,
          name: ((entity as any)?.name ?? '').trim(),
          description: (entity as any)?.description ?? null,
          imagePath: nextImagePath,
          tags: (entity as any)?.tags ?? '',
          purchasePriceCents: (entity as any)?.purchasePriceCents ?? null,
          notes: (entity as any)?.notes ?? null,
        });
      }
      setEntity({
        ...(updatedRecord as LoadedEntity<T>),
        imagePath: nextImagePath,
      });
      setImagePath(nextImagePath);
      setEntityRevision((prev) => prev + 1);
      triggerGlobalRefresh();
    },
    [config.type, entity, entityId, user?.id]
  );

  const handleViewPickImage = useCallback(async () => {
    if (config.type === 'item') {
      await handleItemDetailReplaceImage('gallery');
      return;
    }
    if (!isPlatformSupported()) {
      Alert.alert('Not supported', 'Image upload not supported');
      return;
    }
    if (!entityId) return;
    await prepareForImagePicker();
    try {
      const result = await pickImage();
      if (result) {
        await updateEntityImagePath(result.uri);
        trackRecordImageAdded(config.type, { source: 'detail' });
      }
    } finally {
      setImageLoading(false);
    }
  }, [config.type, entityId, handleItemDetailReplaceImage, prepareForImagePicker, updateEntityImagePath]);

  const handleViewTakePhoto = useCallback(async () => {
    if (config.type === 'item') {
      await handleItemDetailReplaceImage('camera');
      return;
    }
    if (!isPlatformSupported()) {
      Alert.alert('Not supported', 'Camera not supported');
      return;
    }
    if (!entityId) return;
    await prepareForImagePicker();
    try {
      const result = await takePhoto();
      if (result) {
        await updateEntityImagePath(result.uri);
        trackRecordImageAdded(config.type, { source: 'detail' });
      }
    } finally {
      setImageLoading(false);
    }
  }, [config.type, entityId, handleItemDetailReplaceImage, prepareForImagePicker, updateEntityImagePath]);

  const handleViewDeleteImage = useCallback(async () => {
    if (config.type === 'item') {
      await handleItemDetailDeleteImage();
      return;
    }
    if (!entityId) return;
    const existingImagePath = (entity as any)?.imagePath;
    if (!existingImagePath) return;
    setImageLoading(true);
    try {
      await deleteImage(existingImagePath);
      await updateEntityImagePath(null);
    } finally {
      setImageLoading(false);
    }
  }, [config.type, entity, entityId, handleItemDetailDeleteImage, updateEntityImagePath]);

  const handlePullToRefresh = useCallback(async () => {
    if (syncRefreshing) return;
    if (!user) {
      setSyncSnackbarMessage('Sign in to sync');
      setSyncSnackbarVisible(true);
      return;
    }
    if (config.type === 'house' && entityId) {
      setSyncRefreshing(true);
      try {
        const houseIds = await loadSyncedHouseIds();
        const houseEnabled = houseIds.includes(entityId);
        if (houseEnabled) {
          await syncPowerSyncConnectionForSession(true);
          await saveLastSyncAt(Date.now());
        }
        await refreshCollaboration();
        await refreshEntity();
        setSyncSnackbarMessage(houseEnabled ? 'Sync completed' : 'Members updated');
        setSyncSnackbarVisible(true);
      } catch (error) {
        console.warn('Record pull-to-refresh sync failed', error);
        setSyncSnackbarMessage('Sync failed');
        setSyncSnackbarVisible(true);
      } finally {
        setSyncRefreshing(false);
      }
      return;
    }

    const houseIds = await loadSyncedHouseIds();
    if (!houseIds.length) {
      setSyncSnackbarMessage('Cloud sync is disabled for all houses');
      setSyncSnackbarVisible(true);
      return;
    }

    const enabled = await hasAnyHouseSyncEnabled();
    if (!enabled) {
      setSyncSnackbarMessage('Cloud sync is disabled for all houses');
      setSyncSnackbarVisible(true);
      return;
    }

    setSyncRefreshing(true);
    try {
      await syncPowerSyncConnectionForSession(true);
      await saveLastSyncAt(Date.now());
      await refreshEntity();
      setSyncSnackbarMessage('Sync completed');
      setSyncSnackbarVisible(true);
    } catch (error) {
      console.warn('Record pull-to-refresh sync failed', error);
      setSyncSnackbarMessage('Sync failed');
      setSyncSnackbarVisible(true);
    } finally {
      setSyncRefreshing(false);
    }
  }, [config.type, entityId, refreshCollaboration, refreshEntity, syncRefreshing, user]);

  const handleCreateInvite = useCallback(async () => {
    if (!entityId || config.type !== 'house') return;
    if (!user) {
      Alert.alert('Sign in required', 'Sign in to invite members.');
      openSignIn(`/houses/${entityId}?entry=${entry}`);
      return;
    }
    if (!houseSyncEnabled) {
      Alert.alert(
        'Sync required',
        'Enable cloud sync for this house before inviting members.'
      );
      return;
    }
    const trimmed = inviteeName.trim();
    if (!trimmed) {
      Alert.alert('Missing name', 'Enter a member name before creating an invitation.');
      return;
    }
    setInviteCreateLoading(true);
    try {
      const latestCollaboration = await getHouseCollaboration(entityId);
      setCollaboration(latestCollaboration);
      const backendCanAdmin =
        latestCollaboration?.permissions?.can_admin === true ||
        latestCollaboration?.my_role === 'owner' ||
        latestCollaboration?.my_role === 'admin';
      if (!backendCanAdmin) {
        Alert.alert('Not allowed', 'You need to be owner or admin to invite members.');
        return;
      }
      if (!latestCollaboration?.sharing_active) {
        Alert.alert('Not allowed', 'Home sharing is not enabled for your current plan.');
        return;
      }

      const invite = await createHouseInvitation({
        houseId: entityId,
        inviteeName: trimmed,
        role: inviteRole,
      });
      setLatestInviteCode(invite.code);
      setLatestInviteRole(invite.role);
      setInviteeName('');
      await refreshCollaboration();
    } catch (error: any) {
      Alert.alert('Error', error?.message ?? 'Failed to create invitation.');
    } finally {
      setInviteCreateLoading(false);
    }
  }, [config.type, entityId, entry, inviteRole, inviteeName, openSignIn, refreshCollaboration, user]);

  const handleShareLatestInvite = useCallback(async () => {
    if (!latestInviteCode) return;
    const shareRole = latestInviteRole ?? 'viewer';
    const link = `https://everfind.online/invite?code=${latestInviteCode}`;
    const message = `Join my house in everfind as ${shareRole}. Code: ${latestInviteCode}\n${link}`;
    try {
      await Share.share({
        message,
        url: link,
      });
    } catch (error) {
      console.warn('Failed to share invitation', error);
    }
  }, [latestInviteCode, latestInviteRole]);

  const handleRevokeInvite = useCallback(
    async (invitationId: string) => {
      try {
        await revokeHouseInvitation(invitationId);
        await refreshCollaboration();
      } catch (error: any) {
        Alert.alert('Error', error?.message ?? 'Failed to revoke invitation.');
      }
    },
    [refreshCollaboration]
  );

  const handleManageMember = useCallback((memberUserId: string, memberLabel: string) => {
    setManagedMember({ userId: memberUserId, label: memberLabel });
    manageMemberSheetRef.current?.present();
  }, []);

  const handleSetManagedMemberRole = useCallback(
    async (role: InviteRole) => {
      if (!entityId || !managedMember) return;
      try {
        await updateHouseMember({
          houseId: entityId,
          userId: managedMember.userId,
          role,
        });
        manageMemberSheetRef.current?.dismiss();
        await refreshCollaboration();
      } catch (error: any) {
        Alert.alert('Error', error?.message ?? 'Failed to update member.');
      }
    },
    [entityId, managedMember, refreshCollaboration]
  );

  const handleRemoveManagedMember = useCallback(async () => {
    if (!entityId || !managedMember) return;
    try {
      await removeHouseMember({
        houseId: entityId,
        userId: managedMember.userId,
      });
      manageMemberSheetRef.current?.dismiss();
      await refreshCollaboration();
    } catch (error: any) {
      Alert.alert('Error', error?.message ?? 'Failed to remove member.');
    }
  }, [entityId, managedMember, refreshCollaboration]);

  const handleLeaveHouse = useCallback(async () => {
    if (!collaborationHouseId) return;
    if (isLocalOwner || collaboration?.permissions?.is_owner) {
      Alert.alert('Not allowed', 'Owner cannot leave own house.');
      return;
    }
    setLeaveHouseDialogVisible(true);
  }, [collaboration?.permissions?.is_owner, collaborationHouseId, isLocalOwner]);

  const confirmLeaveHouse = useCallback(async () => {
    if (!collaborationHouseId) return;
    setSaving(true);
    try {
      await leaveHouse(collaborationHouseId);
      await pruneQueuedChangesForHouse(collaborationHouseId);
      const syncedHouseIds = await loadSyncedHouseIds();
      await saveSyncedHouseIds(syncedHouseIds.filter((houseId) => houseId !== collaborationHouseId));

      await database.write(async () => {
        const items = await database.collections.get<any>('items').query(Q.where('house_id', collaborationHouseId)).fetch();
        const boxes = await database.collections.get<any>('boxes').query(Q.where('house_id', collaborationHouseId)).fetch();
        const containers = await database.collections.get<any>('containers').query(Q.where('house_id', collaborationHouseId)).fetch();
        const rooms = await database.collections.get<any>('rooms').query(Q.where('house_id', collaborationHouseId)).fetch();

        for (const item of items) {
          await item.destroyPermanently();
        }
        for (const box of boxes) {
          await box.destroyPermanently();
        }
        for (const container of containers) {
          await container.destroyPermanently();
        }
        for (const room of rooms) {
          await room.destroyPermanently();
        }

        try {
          const house = await database.collections.get<any>('houses').find(collaborationHouseId);
          await house.destroyPermanently();
        } catch {
          // House may already be absent locally.
        }
      });

      setLeaveHouseDialogVisible(false);
      router.replace('/');
    } catch (error: any) {
      Alert.alert('Error', error?.message ?? 'Failed to leave house.');
    } finally {
      setSaving(false);
    }
  }, [collaborationHouseId]);

  const inviteSheetSnapPoints = useMemo(() => ['90%'], []);
  const manageMemberSheetSnapPoints = useMemo(() => ['56%'], []);
  const createSheetSnapPoints = useMemo(() => ['92%'], []);
  const renderInviteSheetBackdrop = useCallback(
    (props: any) => (
      <BottomSheetBackdrop
        {...props}
        appearsOnIndex={0}
        disappearsOnIndex={-1}
        pressBehavior="close"
      />
    ),
    []
  );
  const openInviteSheet = useCallback(() => {
    if (!canAdminHouse) {
      Alert.alert('Not allowed', 'Only owner and admins can invite members.');
      return;
    }
    setInviteeName('');
    setInviteRole('viewer');
    setLatestInviteCode(null);
    setLatestInviteRole(null);
    inviteSheetRef.current?.present();
  }, [canAdminHouse]);

  useLayoutEffect(() => {
    if (!contextualCreateType) return;
    createSheetRef.current?.present();
  }, [contextualCreateType]);

  const memberRows = useMemo(() => {
    if (!collaboration) return [] as Array<{
      key: string;
      name: string;
      role: string;
      status: 'active' | 'invited';
      canManage: boolean;
      onManage?: () => void;
    }>;

    const members = Array.isArray(collaboration.members) ? collaboration.members : [];
    const invites = Array.isArray(collaboration.invites) ? collaboration.invites : [];

    const activeRows = members.map((member) => {
      const name =
        member.user_id === user?.id
          ? 'You'
          : (member.display_name?.trim() || member.profile_display_name?.trim() || 'Member');
      const canManageMemberRow =
        canAdminHouse && member.role !== 'owner' && member.user_id !== user?.id;
      return {
        key: `member:${member.user_id}`,
        name,
        role: member.role,
        status: 'active' as const,
        canManage: canManageMemberRow,
        onManage:
          canManageMemberRow
            ? () => handleManageMember(member.user_id, name)
            : undefined,
      };
    });

    const invitedRows = invites.map((invite) => ({
      key: `invite:${invite.id}`,
      name: invite.invitee_name,
      role: invite.role,
      status: 'invited' as const,
      canManage: canAdminHouse,
      onManage: canAdminHouse ? () => void handleRevokeInvite(invite.id) : undefined,
    }));

    return [...activeRows, ...invitedRows];
  }, [canAdminHouse, collaboration, handleManageMember, handleRevokeInvite, user?.id]);
  const collaborationLimits = useMemo(
    () => ({
      member_count: collaboration?.limits?.member_count ?? 0,
      member_limit: collaboration?.limits?.member_limit ?? 0,
      active_invite_count: collaboration?.limits?.active_invite_count ?? 0,
      slots_left: collaboration?.limits?.slots_left ?? 0,
    }),
    [collaboration]
  );
  const planSupportsSharing = collaboration?.sharing_active;
  const contextualCreateLocationLabel = useMemo(() => {
    if (!contextualCreateType || !entity) return undefined;
    if (config.type === 'house') {
      return (entity as any)?.name || '';
    }
    return joinLocation([locationPath, (entity as any)?.name]) || (entity as any)?.name || locationPath || '';
  }, [config.type, contextualCreateType, entity, joinLocation, locationPath]);

  if (loading) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['bottom']}>
        <Appbar.Header>
          <Appbar.BackAction onPress={handleBack} />
          <Appbar.Content title={renderTitle()} />
        </Appbar.Header>
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <Text>Loading...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!isAddMode && !entity) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['bottom']}>
        <Appbar.Header>
          <Appbar.BackAction onPress={handleBack} />
          <Appbar.Content title={renderTitle()} />
        </Appbar.Header>
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <Text>{`${config.title} not found`}</Text>
        </View>
      </SafeAreaView>
    );
  }

  const shouldSimplifyOverview = ['room', 'container', 'box', 'item'].includes(config.type);
  const rawTags = (entity as any)?.tags as string | undefined;
  const overviewFields = config.fields
    .filter((field) => !(shouldSimplifyOverview && field.key === 'name'))
    .filter((field) => field.key !== 'tags')
    .map((field) => {
      const rawValue =
        field.key === 'purchasePrice'
          ? formatCurrencyFromCents((entity as any)?.purchasePriceCents, currency)
          : ((entity as any)?.[field.key] as string) || '';
      const value =
        !shouldSimplifyOverview && field.optional && !rawValue
          ? `No ${field.label.toLowerCase()}`
          : rawValue;
      return {
        label: field.label,
        value,
        key: field.key,
        optional: field.optional,
      };
    })
    .filter((field) => {
      if (!shouldSimplifyOverview) return true;
      if (field.key === 'description') {
        return field.value.trim().length > 0;
      }
      return field.value.trim().length > 0 || !field.optional;
    })
    .map((field) => ({
      label: field.label,
      value: field.value,
    }));

  const formContent = (
    <EntityForm
      config={config}
      values={fieldValues}
      onChangeField={(key, value) =>
        setFieldValues((prev) => ({ ...prev, [String(key)]: value }))
      }
      contextualLocationLabel={contextualCreateLocationLabel}
      houseSelectionMode={
        config.type === 'room'
          ? 'readonly'
          : config.type === 'container' || config.type === 'box' || config.type === 'item'
          ? 'select'
          : 'none'
      }
      houseOptions={houses.map((house) => ({ id: house.id, name: house.name }))}
      houseId={selectedHouseId}
      houseLabel={houses.find((house) => house.id === selectedHouseId)?.name || ''}
      onHouseChange={(nextHouseId) => {
        setSelectedHouseId(nextHouseId);
        setParentId('');
      }}
      parentTypes={parentTypes}
      parentType={parentType}
      onParentTypeChange={setParentType}
      parentOptions={parentOptions}
      parentId={parentId}
      onParentIdChange={setParentId}
      imagePath={
        config.type === 'item'
          ? isEditMode
            ? selectedItemImage?.imagePath ?? null
            : createItemImagePaths[createItemImageIndex] ?? null
          : imagePath
      }
      onPickImage={
        config.type === 'item' && isEditMode
          ? () => handleItemDetailReplaceImage('gallery')
          : handlePickImage
      }
      onTakePhoto={
        config.type === 'item' && isEditMode
          ? () => handleItemDetailReplaceImage('camera')
          : handleTakePhoto
      }
      onDeleteImage={
        config.type === 'item' && isEditMode ? handleItemDetailDeleteImage : handleDeleteImage
      }
      imagePaths={
        config.type === 'item'
          ? isEditMode
            ? visibleGalleryItemImages.map((image) => image.imagePath as string)
            : createItemImagePaths
          : undefined
      }
      currentImageIndex={
        config.type === 'item'
          ? isEditMode
            ? Math.max(selectedItemImageIndex, 0)
            : Math.max(createItemImageIndex, 0)
          : undefined
      }
      onChangeImageIndex={
        config.type === 'item'
          ? isEditMode
            ? (index) => {
                const nextImage = visibleGalleryItemImages[index];
                setSelectedItemImageId(nextImage?.id ?? null);
              }
            : setCreateItemImageIndex
          : undefined
      }
      onAddImageFromGallery={
        config.type === 'item'
          ? isEditMode
            ? !hasReachedItemPictureLimit
              ? () => handleItemDetailAddImage('gallery')
              : undefined
            : () => handleCreateItemAddImage('gallery')
          : undefined
      }
      onAddImageFromCamera={
        config.type === 'item'
          ? isEditMode
            ? !hasReachedItemPictureLimit
              ? () => handleItemDetailAddImage('camera')
              : undefined
            : () => handleCreateItemAddImage('camera')
          : undefined
      }
      imageLoading={imageLoading}
      bottomInset={0}
    />
  );

  const handleFabToggle = () => {
    if (fabOpen) {
      Animated.timing(fabAnim, { toValue: 0, duration: 200, useNativeDriver: true }).start(() => {
        setFabOpen(false);
      });
    } else {
      setFabOpen(true);
      Animated.timing(fabAnim, { toValue: 1, duration: 200, useNativeDriver: true }).start();
    }
  };

  const handleFabAction = (action: () => void) => {
    Animated.timing(fabAnim, { toValue: 0, duration: 200, useNativeDriver: true }).start(() => {
      setFabOpen(false);
      action();
    });
  };

  const FabLabel = ({
    text,
    onPress,
    animatedStyle,
    accessibilityLabel,
    testID,
  }: {
    text: string;
    onPress: () => void;
    animatedStyle?: any;
    accessibilityLabel?: string;
    testID?: string;
  }) => (
    <Animated.View style={animatedStyle}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? text}
        testID={testID}
        onPress={onPress}
        android_ripple={{ color: `${colors.primary}${opacity.alpha20}`, borderless: false }}
        style={({ pressed }) => ({ opacity: pressed ? 0.92 : 1 })}
      >
        <Surface
          elevation={elevation.level2}
          style={{
            paddingHorizontal: spacing.lg,
            paddingVertical: spacing.sm,
            borderRadius: shapes.cornerFull,
            backgroundColor: surfaces.card,
          }}
        >
          <Text variant="labelLarge" style={{ color: colors.onSurface, fontSize: typography.labelFontSize }}>
            {text}
          </Text>
        </Surface>
      </Pressable>
    </Animated.View>
  );

  const OverlayFab = ({
    icon,
    size,
    style,
    onPress,
    accessibilityLabel,
    testID,
  }: {
    icon: string;
    size: 'small' | 'medium';
    style?: any;
    onPress: () => void;
    accessibilityLabel?: string;
    testID?: string;
  }) => {
    const diameter = size === 'small' ? 40 : 56;
    const iconSize = size === 'small' ? 22 : 24;

    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        testID={testID}
        onPress={onPress}
        style={({ pressed }) => [
          {
            width: diameter,
            height: diameter,
            borderRadius: diameter / 2,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: colors.primary,
            opacity: pressed ? 0.9 : 1,
          },
          style,
        ]}
      >
        <MaterialCommunityIcons name={icon as any} size={iconSize} color={colors.onPrimary} />
      </Pressable>
    );
  };

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: colors.background }}
      edges={['bottom']}
    >
        <Appbar.Header>
        <Appbar.BackAction onPress={handleBack} />
        <Appbar.Content
          style={{ alignItems: 'flex-start' }}
          // Paper's types only allow titleStyle with a string title; the title here can be an element.
          {...({ titleStyle: { textAlign: 'left' } } as object)}
          title={
            isFormMode ? (
              renderTitle()
            ) : (
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Icon source={config.icon} size={24} color={colors.onSurfaceVariant} />
                <Text
                  variant="titleLarge"
                  style={{
                    fontWeight: typography.appBarTitle.fontWeight,
                    letterSpacing: typography.appBarTitle.letterSpacing,
                    marginLeft: spacing.sm,
                  }}
                >
                  {(entity as any)?.name}
                </Text>
              </View>
            )
          }
        />
        {isFormMode ? (
          <Appbar.Action
            icon="check"
            onPress={handleSave}
            disabled={saving}
            accessibilityLabel={`Save ${config.title}`}
            testID={`entity-save-${config.type}-button`}
          />
        ) : (
          <>
            {canModifyCurrentEntity ? (
              <Appbar.Action
                icon="pencil"
                onPress={() => router.push(`/${entityRouteSegment}/${id}?mode=edit` as any)}
                accessibilityLabel={`Edit ${config.title}`}
                testID={`entity-edit-${config.type}-button`}
              />
            ) : null}
            {canDeleteCurrentEntity ? (
              <Appbar.Action
                icon="delete"
                onPress={handleDelete}
                disabled={saving}
                accessibilityLabel={`Delete ${config.title}`}
                testID={`entity-delete-${config.type}-button`}
              />
            ) : null}
          </>
        )}
        </Appbar.Header>

      {isFormMode ? (
        formContent
      ) : (
        <EntityOverview
          config={config}
          entity={entity as LoadedEntity<T>}
          fields={overviewFields}
          tags={rawTags}
          locationPath={locationPath}
          childrenSections={childSections.map((section) => ({
            ...section,
            onAdd: () => {
              if (!canWriteContent) {
                Alert.alert('Not allowed', 'You do not have permission to add records in this house.');
                return;
              }
              openContextualCreateSheet(section.type);
            },
            onPressItem: (childId: string) => router.push(`/${toRouteSegment(section.type)}/${childId}` as any),
            onVoiceAdd:
              canWriteContent &&
              section.type === 'item' &&
              (config.type === 'container' || config.type === 'box' || config.type === 'room')
                ? () =>
                    router.push(
                      `/items/voice-add?parentType=${config.type}&parentId=${id}`
                    )
              : undefined,
          }))}
          onOpenImage={() => {
            if (config.type === 'item' && visibleGalleryItemImages.length === 0) {
              return;
            }
            setFullImageVisible(true);
          }}
          onPickImage={handleViewPickImage}
          onTakePhoto={handleViewTakePhoto}
          onDeleteImage={handleViewDeleteImage}
          onAddImageFromGallery={
            config.type === 'item' && !hasReachedItemPictureLimit
              ? () => void handleItemDetailAddImage('gallery')
              : undefined
          }
          onAddImageFromCamera={
            config.type === 'item' && !hasReachedItemPictureLimit
              ? () => void handleItemDetailAddImage('camera')
              : undefined
          }
          imageLoading={imageLoading}
          canManageImage={!isFormMode && canModifyCurrentEntity}
          imagePaths={config.type === 'item' ? visibleGalleryItemImages.map((image) => image.imagePath as string) : undefined}
          currentImageIndex={config.type === 'item' ? Math.max(selectedItemImageIndex, 0) : undefined}
          onChangeImageIndex={
            config.type === 'item'
              ? (index) => {
                  const nextImage = visibleGalleryItemImages[index];
                  setSelectedItemImageId(nextImage?.id ?? null);
                }
              : undefined
          }
          onLocationPress={
            !isFormMode && entityId && config.type !== 'house'
              ? handleLocationDiagnosticPress
              : undefined
          }
          refreshing={syncRefreshing}
          onRefresh={() => {
            void handlePullToRefresh();
          }}
          extraSection={
            config.type === 'house' && entityId ? (
              <View style={{ gap: spacing.lg }}>
                {editionCapabilities.cloudSync ? (
                  <Surface
                    style={{
                      backgroundColor: surfaces.card,
                      borderRadius: shapes.cornerLarge,
                      padding: spacing.xxl,
                      gap: spacing.md,
                    }}
                    elevation={elevation.level1}
                  >
                    <Text variant="titleMedium" style={{ color: colors.onSurface }}>
                      Cloud sync
                    </Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                      <View style={{ flex: 1, paddingRight: spacing.md }}>
                        <Text variant="bodyMedium" style={{ color: colors.onSurfaceVariant }}>
                          {collaboration?.sync_required
                            ? 'Cloud sync is required while this house has members or active invites'
                            : houseSyncEnabled
                            ? 'Cloud sync is enabled for this house'
                            : 'Cloud sync is off for this house'}
                        </Text>
                      </View>
                      <Switch
                        value={houseSyncEnabled}
                        disabled={houseSyncLoading || Boolean(collaboration?.sync_required)}
                        onValueChange={(nextValue) => {
                          void handleToggleHouseSync(nextValue);
                        }}
                      />
                    </View>
                  </Surface>
                ) : null}

                {editionCapabilities.collaboration ? (
                  <Surface
                    style={{
                      backgroundColor: surfaces.card,
                      borderRadius: shapes.cornerLarge,
                      padding: spacing.xxl,
                      gap: spacing.md,
                    }}
                    elevation={elevation.level1}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                      <Text variant="titleMedium" style={{ color: colors.onSurface }}>
                        Members
                      </Text>
                      {canAdminHouse ? (
                        <Button compact mode="text" onPress={openInviteSheet}>
                          Invite member
                        </Button>
                      ) : null}
                    </View>
                    {collaborationLoading ? (
                      <Text variant="bodyMedium" style={{ color: colors.onSurfaceVariant }}>
                        Loading members...
                      </Text>
                    ) : collaboration ? (
                      <>
                        {canAdminHouse ? (
                          <Text variant="bodySmall" style={{ color: colors.onSurfaceVariant }}>
                            {collaborationLimits.member_count + collaborationLimits.active_invite_count} / {collaborationLimits.member_limit} members
                          </Text>
                        ) : null}

                        <View style={{ gap: spacing.sm }}>
                          {memberRows.length ? (
                            memberRows.map((row) => (
                              <Surface
                                key={row.key}
                                elevation={elevation.level0}
                                style={{
                                  backgroundColor: surfaces.cardLow,
                                  borderRadius: shapes.cornerMedium,
                                  paddingHorizontal: spacing.sm,
                                  paddingVertical: spacing.sm,
                                  gap: spacing.sm,
                                }}
                              >
                                <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                                  <View style={{ flex: 1, paddingRight: spacing.sm, gap: spacing.xs }}>
                                    <Text variant="titleSmall" style={{ color: colors.onSurface }}>
                                      {row.name}
                                    </Text>
                                    <View style={{ flexDirection: 'row', gap: spacing.xs }}>
                                      <Surface
                                        elevation={0}
                                        style={{
                                          backgroundColor: colors.surfaceVariant,
                                          borderRadius: shapes.cornerSmall,
                                          paddingHorizontal: spacing.sm,
                                          paddingVertical: spacing.xs,
                                        }}
                                      >
                                        <Text variant="labelSmall" style={{ color: colors.onSurfaceVariant }}>
                                          {row.role}
                                        </Text>
                                      </Surface>
                                      <Surface
                                        elevation={0}
                                        style={{
                                          backgroundColor:
                                            row.status === 'invited' ? colors.tertiaryContainer : colors.primaryContainer,
                                          borderRadius: shapes.cornerSmall,
                                          paddingHorizontal: spacing.sm,
                                          paddingVertical: spacing.xs,
                                        }}
                                      >
                                        <Text
                                          variant="labelSmall"
                                          style={{
                                            color:
                                              row.status === 'invited'
                                                ? colors.onTertiaryContainer
                                                : colors.onPrimaryContainer,
                                          }}
                                        >
                                          {row.status}
                                        </Text>
                                      </Surface>
                                    </View>
                                  </View>
                                  {row.canManage ? (
                                    <Button compact mode="text" onPress={row.onManage}>
                                      {row.status === 'invited' ? 'Revoke' : 'Manage'}
                                    </Button>
                                  ) : null}
                                </View>
                              </Surface>
                            ))
                          ) : (
                            <Text variant="bodySmall" style={{ color: colors.onSurfaceVariant }}>
                              No members yet.
                            </Text>
                          )}
                        </View>

                        {canLeaveHouse ? (
                          <Button mode="outlined" textColor={colors.error} onPress={() => void handleLeaveHouse()}>
                            Leave house
                          </Button>
                        ) : null}
                      </>
                    ) : (
                      <Text variant="bodyMedium" style={{ color: colors.onSurfaceVariant }}>
                        Members information is unavailable.
                      </Text>
                    )}
                  </Surface>
                ) : null}
              </View>
            ) : null
          }
        />
      )}

      {!isFormMode ? (
        <FullScreenImageViewer
          visible={fullImageVisible}
          imagePath={fullScreenImagePath}
          imagePaths={fullScreenImagePaths}
          initialIndex={config.type === 'item' ? fullScreenInitialImageIndex : 0}
          onIndexChange={
            config.type === 'item'
              ? (index) => {
                  const nextImage = fullScreenImages[index];
                  setSelectedItemImageId(nextImage?.id ?? null);
                }
              : undefined
          }
          onClose={() => setFullImageVisible(false)}
        />
      ) : null}

      <ContextualCreateSheet
        sheetRef={createSheetRef}
        snapPoints={createSheetSnapPoints}
        onChangeIndex={(index) => {
          setCreateSheetIndex(index);
          if (index < 0) {
            setCreateSheetVisible(false);
          }
        }}
        onDismiss={() => {
          setCreateSheetVisible(false);
          setCreateSheetIndex(-1);
          resetContextualCreateState();
        }}
        backdropComponent={renderInviteSheetBackdrop}
        config={contextualCreateConfig}
        values={contextualCreateValues}
        onChangeField={(key, value) => {
          setContextualCreateError(null);
          setContextualCreateValues((prev) => ({ ...prev, [key]: value }));
        }}
        contextualLocationLabel={contextualCreateLocationLabel}
        parentType={contextualCreateParentType}
        onParentTypeChange={(type) => {
          setContextualCreateError(null);
          setContextualCreateParentType(type);
        }}
        parentOptions={parentOptions}
        parentId={contextualCreateParentId}
        onParentIdChange={(id) => {
          setContextualCreateError(null);
          setContextualCreateParentId(id);
        }}
        imagePath={
          contextualCreateType === 'item'
            ? contextualCreateImagePaths[contextualCreateImageIndex] ?? null
            : contextualCreateImagePath
        }
        imagePaths={contextualCreateType === 'item' ? contextualCreateImagePaths : undefined}
        currentImageIndex={contextualCreateType === 'item' ? Math.max(contextualCreateImageIndex, 0) : undefined}
        onChangeImageIndex={contextualCreateType === 'item' ? setContextualCreateImageIndex : undefined}
        onPickImage={handleContextualCreatePickImage}
        onTakePhoto={handleContextualCreateTakePhoto}
        onDeleteImage={handleContextualCreateDeleteImage}
        onAddImageFromGallery={
          contextualCreateType === 'item' ? () => handleContextualCreateAddImage('gallery') : undefined
        }
        onAddImageFromCamera={
          contextualCreateType === 'item' ? () => handleContextualCreateAddImage('camera') : undefined
        }
        imageLoading={contextualCreateImageLoading}
        bottomInset={insets.bottom + spacing.lg}
        saving={saving}
        errorMessage={contextualCreateError}
        onClose={closeContextualCreateSheet}
        onSave={handleContextualCreateSave}
      />

      <BottomSheetModal
        ref={diagnosticsSheetRef}
        onChange={handleDiagnosticsSheetChange}
        snapPoints={['70%']}
        enableDynamicSizing={false}
        enablePanDownToClose
        backdropComponent={renderInviteSheetBackdrop}
        {...sheetChrome.modalProps}
      >
        <SheetTheme theme={theme}>
          <BottomSheetScrollView
            contentContainerStyle={{
              paddingHorizontal: spacing.xxl,
              paddingTop: spacing.xs,
              paddingBottom: spacing.xxl + insets.bottom,
              gap: spacing.xxl,
            }}
          >
            <SheetHeader
              title="Record diagnostics"
              onClose={() => diagnosticsSheetRef.current?.dismiss()}
              closeLabel="Close diagnostics"
            />
            <View style={{ flexDirection: 'row' }}>
              <SheetButton
                variant="secondary"
                icon="refresh"
                label="Refresh diagnostics"
                loading={recordDiagnosticsLoading}
                disabled={recordDiagnosticsLoading}
                onPress={() => void loadRecordDiagnostics()}
              />
            </View>
            <SheetCard>
              <Text
                variant="bodySmall"
                selectable
                style={{
                  color: colors.onSurfaceVariant,
                  fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }),
                }}
              >
                {recordDiagnosticsLoading ? 'Loading...' : recordDiagnostics}
              </Text>
            </SheetCard>
          </BottomSheetScrollView>
        </SheetTheme>
      </BottomSheetModal>

      <BottomSheetModal
        ref={inviteSheetRef}
        snapPoints={inviteSheetSnapPoints}
        enableDynamicSizing={false}
        enablePanDownToClose
        onChange={setInviteSheetIndex}
        backdropComponent={renderInviteSheetBackdrop}
        keyboardBehavior="interactive"
        keyboardBlurBehavior="restore"
        android_keyboardInputMode="adjustResize"
        {...sheetChrome.modalProps}
      >
        <SheetTheme theme={theme}>
          <BottomSheetScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{
              paddingHorizontal: spacing.xxl,
              paddingTop: spacing.xs,
              paddingBottom: spacing.xxl + insets.bottom,
              gap: spacing.xxl,
            }}
          >
            <SheetHeader
              title="Invite member"
              onClose={() => inviteSheetRef.current?.dismiss()}
              closeLabel="Close invite"
            />
            {collaborationLoading || !collaboration ? (
              <SheetCard>
                <Text variant="bodyMedium" style={{ color: colors.onSurfaceVariant }}>
                  Loading plan and sharing access...
                </Text>
              </SheetCard>
            ) : planSupportsSharing === false ? (
              <SheetNotice tone="info">
                Home sharing is not available on your current plan. Upgrade your plan to invite members to this house.
              </SheetNotice>
            ) : latestInviteCode ? (
              <>
                <SheetCard label="Invitation code">
                  <Text
                    variant="headlineSmall"
                    selectable
                    style={{ color: colors.onSurface, fontWeight: '700', letterSpacing: 2, textAlign: 'center' }}
                  >
                    {latestInviteCode}
                  </Text>
                  <Text variant="bodyMedium" style={{ color: colors.onSurfaceVariant, textAlign: 'center' }}>
                    Share this code to invite {latestInviteRole ?? 'member'} to your house.
                  </Text>
                </SheetCard>
                <View style={{ flexDirection: 'row' }}>
                  <SheetButton
                    icon="share-variant"
                    label="Share code"
                    onPress={() => void handleShareLatestInvite()}
                  />
                </View>
              </>
            ) : (
              <>
                <TextInput
                  mode="outlined"
                  label="Member name"
                  value={inviteeName}
                  onChangeText={setInviteeName}
                  autoCapitalize="words"
                  outlineColor={colors.outline}
                  activeOutlineColor={colors.primary}
                  textColor={colors.onSurface}
                  style={{ backgroundColor: sheetChrome.sheetBackground }}
                />
                <View style={{ gap: spacing.sm }}>
                  <Text variant="labelLarge" style={{ color: colors.onSurfaceVariant }}>
                    Role
                  </Text>
                  <View
                    style={{
                      flexDirection: 'row',
                      padding: spacing.xxs,
                      gap: spacing.xxs,
                      borderRadius: shapes.cornerFull,
                      backgroundColor: sheetChrome.cardBackground,
                      borderWidth: 1,
                      borderColor: sheetChrome.hairline,
                    }}
                  >
                    {(['viewer', 'editor', 'admin'] as InviteRole[]).map((role) => {
                      const selected = inviteRole === role;
                      return (
                        <Pressable
                          key={role}
                          onPress={() => setInviteRole(role)}
                          accessibilityRole="button"
                          accessibilityLabel={`Invite as ${role}`}
                          accessibilityState={{ selected }}
                          style={{
                            flex: 1,
                            minHeight: 40,
                            alignItems: 'center',
                            justifyContent: 'center',
                            borderRadius: shapes.cornerFull,
                            backgroundColor: selected ? colors.primaryContainer : 'transparent',
                          }}
                        >
                          <Text
                            variant="labelLarge"
                            style={{
                              color: selected ? colors.onPrimaryContainer : colors.onSurfaceVariant,
                              fontWeight: selected ? '600' : '400',
                              textTransform: 'capitalize',
                            }}
                          >
                            {role}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
                <View style={{ flexDirection: 'row' }}>
                  <SheetButton
                    icon="account-plus-outline"
                    label="Create invitation"
                    loading={inviteCreateLoading}
                    disabled={!inviteeName.trim() || inviteCreateLoading}
                    onPress={() => void handleCreateInvite()}
                  />
                </View>
              </>
            )}
          </BottomSheetScrollView>
        </SheetTheme>
      </BottomSheetModal>

      <BottomSheetModal
        ref={manageMemberSheetRef}
        snapPoints={manageMemberSheetSnapPoints}
        enableDynamicSizing={false}
        enablePanDownToClose
        onChange={setManageMemberSheetIndex}
        onDismiss={() => setManagedMember(null)}
        backdropComponent={renderInviteSheetBackdrop}
        {...sheetChrome.modalProps}
      >
        <SheetTheme theme={theme}>
          <BottomSheetScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{
              paddingHorizontal: spacing.xxl,
              paddingTop: spacing.xs,
              paddingBottom: spacing.xxl + insets.bottom,
              gap: spacing.xxl,
            }}
          >
            <SheetHeader
              title="Manage member"
              subtitle={managedMember?.label ?? 'Member'}
              onClose={() => manageMemberSheetRef.current?.dismiss()}
              closeLabel="Close manage member"
            />
            <SheetCard label="Change role">
              <SheetRow
                icon="shield-account-outline"
                title="Admin"
                accessibilityLabel="Set admin"
                onPress={() => void handleSetManagedMemberRole('admin')}
              />
              <SheetRow
                icon="pencil-outline"
                title="Editor"
                accessibilityLabel="Set editor"
                onPress={() => void handleSetManagedMemberRole('editor')}
              />
              <SheetRow
                icon="eye-outline"
                title="Viewer"
                accessibilityLabel="Set viewer"
                onPress={() => void handleSetManagedMemberRole('viewer')}
              />
            </SheetCard>
            <View style={{ flexDirection: 'row' }}>
              <SheetButton
                variant="danger"
                icon="account-remove-outline"
                label="Remove member"
                onPress={() => void handleRemoveManagedMember()}
              />
            </View>
          </BottomSheetScrollView>
        </SheetTheme>
      </BottomSheetModal>

      {shouldRenderFabOverlay ? renderFabOverlay(
        <>
          {childFabActions.map((action, index) => {
            const offset = fabOffsets[index] ?? spacing.fabStackOffset1 + index * 64;
            return (
              <Animated.View
                key={action.key}
                pointerEvents={fabOpen ? 'auto' : 'none'}
                style={{
                  position: 'absolute',
                  right: spacing.fabBaseOffset,
                  bottom: spacing.fabBaseOffset + offset + insets.bottom,
                  flexDirection: 'row',
                  alignItems: 'center',
                  zIndex: 21 + index * 2,
                  opacity: fabAnim,
                  transform: [
                    {
                      translateY: fabAnim.interpolate({
                        inputRange: [0, 1],
                        outputRange: [8, 0],
                      }),
                    },
                  ],
                }}
              >
                <FabLabel
                  text={action.label}
                  onPress={() => handleFabAction(action.onPress)}
                  accessibilityLabel={action.label}
                  testID={`entity-child-create-${action.key}-label`}
                  animatedStyle={{
                    marginRight: spacing.lg,
                    opacity: fabAnim,
                    transform: [
                      {
                        translateX: fabAnim.interpolate({
                          inputRange: [0, 1],
                          outputRange: [12, 0],
                        }),
                      },
                    ],
                  }}
                />
                <OverlayFab
                  icon={action.icon}
                  size="small"
                  style={{
                    backgroundColor: colors.primary,
                    shadowColor: colors.shadow,
                    elevation: elevation.level3,
                    zIndex: 22 + index * 2,
                    shadowOpacity: 0.24,
                    shadowRadius: 8,
                    shadowOffset: { width: 0, height: 4 },
                  }}
                  onPress={() => handleFabAction(action.onPress)}
                  accessibilityLabel={action.label}
                  testID={`entity-child-create-${action.key}-button`}
                />
              </Animated.View>
            );
          })}

          <OverlayFab
            icon={fabOpen ? 'close' : 'plus'}
            size="medium"
            style={{
              position: 'absolute',
              margin: spacing.xxl,
              right: 0,
              bottom: insets.bottom,
              backgroundColor: colors.primary,
              shadowColor: colors.shadow,
              elevation: elevation.level4,
              zIndex: 30,
              shadowOpacity: 0.28,
              shadowRadius: 10,
              shadowOffset: { width: 0, height: 5 },
            }}
            onPress={handleFabToggle}
            accessibilityLabel={fabOpen ? 'Close child create menu' : 'Open child create menu'}
            testID="entity-child-create-menu-button"
          />
        </>
      ) : null}
      <Snackbar
        visible={syncSnackbarVisible}
        onDismiss={() => setSyncSnackbarVisible(false)}
        duration={2200}
      >
        {syncSnackbarMessage}
      </Snackbar>
      <AppProgressDialog
        visible={syncRefreshing}
        message="Syncing your house data. Please wait."
      />
      <AppConfirmDialog
        visible={deleteDialogVisible}
        testID={`entity-delete-${config.type}-dialog`}
        title={`Delete ${config.title}`}
        message={
          config.type === 'item'
            ? 'Are you sure you want to delete this item? This cannot be undone.'
            : `Are you sure you want to delete this ${config.title.toLowerCase()} and everything in it? This cannot be undone.`
        }
        confirmLabel="Delete"
        destructive
        loading={saving}
        onCancel={() => setDeleteDialogVisible(false)}
        onConfirm={() => void confirmDelete()}
      />
      <AppConfirmDialog
        visible={leaveHouseDialogVisible}
        title="Leave house"
        message="Are you sure you want to leave this house?"
        confirmLabel="Leave"
        destructive
        loading={saving}
        onCancel={() => setLeaveHouseDialogVisible(false)}
        onConfirm={() => void confirmLeaveHouse()}
      />
    </SafeAreaView>
  );
}
