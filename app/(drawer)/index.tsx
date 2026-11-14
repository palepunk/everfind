import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, View, ScrollView, Animated, Pressable, TouchableOpacity, Easing, KeyboardAvoidingView, Platform, Image, RefreshControl } from "react-native";
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import * as NavigationBar from "expo-navigation-bar";
import { Appbar, Text, Surface, List, Searchbar, Icon, Snackbar, useTheme } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { DrawerActions, useIsFocused } from '@react-navigation/native';
import { PanGestureHandler, State } from 'react-native-gesture-handler';
import { FullWindowOverlay } from 'react-native-screens';
import { useActiveHouse, useBoxes, useItems, useRooms, useContainers, useGlobalRefresh, useHouses, triggerGlobalRefresh } from '../../utils/hooks/useDatabase';
import {
  HOUSE_LIMIT,
  ITEM_LIMIT,
  ITEM_PICTURES_PER_ITEM_LIMIT,
  STORAGE_UNIT_LIMIT,
  formatLimitValue,
  getPlanLimitSnapshot,
  isOverAnyLimit,
  type LimitCounts,
  type LimitValues,
} from '../../utils/limits';
import { AppTheme } from '../../utils/theme/theme';
import { useThemePreference } from '../../utils/theme/themePreference';
import { VoiceIntentModal } from '../../components/voice/VoiceIntentModal';
import { AppProgressDialog } from '../../components/AppProgressDialog';
import {
  loadSyncedHouseIds,
  saveLastSyncAt,
} from '../../utils/sync/settingsMetadata';
import { useAuth } from '../../utils/auth/AuthContext';
import { useSignInSheet } from '../../utils/auth/SignInSheetContext';
import { syncPowerSyncConnectionForSession } from '@/utils/powersync/connectionLifecycle';
import { dismissInboxBanner, useInboxPending } from '@/src/inbox';
import { getHouseCollaboration } from '@/utils/collaboration/houseSharing';
import { database } from '@/utils/storage/database';
import { editionCapabilities } from '@/utils/edition/config';

type AppMode = 'full' | 'boxes';
type SearchResultType = 'item' | 'box' | 'container' | 'room';
const EMPTY_STATE_IMAGE = require('../../assets/images/empty_state_image.png');
const INSTALL_DEFAULT_HOUSE_ID_KEY = 'installDefaultHouseId';
type SearchResult = {
  id: string;
  type: SearchResultType;
  title: string;
  description?: string | null;
  context?: string;
};

function FabLabel({
  text,
  onPress,
  animatedStyle,
  disabled,
  accessibilityLabel,
  testID,
}: {
  text: string;
  onPress: () => void;
  animatedStyle?: any;
  disabled?: boolean;
  accessibilityLabel?: string;
  testID?: string;
}) {
  const { colors, custom } = useTheme<AppTheme>();
  const { spacing, shapes, elevation, typography, surfaces, opacity } = custom;

  return (
    <Animated.View style={animatedStyle}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? text}
        testID={testID}
        onPress={onPress}
        disabled={disabled}
        android_ripple={{
          color: `${colors.primary}${opacity.alpha20}`,
          borderless: false,
        }}
        style={({ pressed }) => ({
          opacity: pressed && !disabled ? 0.92 : 1,
        })}
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
          <Text
            variant="labelLarge"
            style={{
              color: disabled
                ? `${colors.onSurface}${opacity.alpha40}`
                : colors.onSurface,
              fontSize: typography.labelFontSize,
            }}
          >
            {text}
          </Text>
        </Surface>
      </Pressable>
    </Animated.View>
  );
}

export default function Index() {
  const isIos = Platform.OS === 'ios';
  const isFocused = useIsFocused();
  const insets = useSafeAreaInsets();
  const { colors, custom } = useTheme<AppTheme>();
  const { spacing, shapes, typography, elevation, opacity, layout, surfaces } = custom;
  const navigation = useNavigation();
  const [mode, setMode] = useState<AppMode>('full');
  const [fabOpen, setFabOpen] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isVoiceModalVisible, setIsVoiceModalVisible] = useState(false);
  const globalRefreshKey = useGlobalRefresh();
  const searchbarRef = useRef<any>(null);
  const { q } = useLocalSearchParams<{ q?: string }>();
  const lastVoiceQueryRef = useRef<string | null>(null);

  // Animation values for FAB menu
  const fabAnim1 = useState(new Animated.Value(0))[0];
  const fabAnim2 = useState(new Animated.Value(0))[0];
  const fabAnim3 = useState(new Animated.Value(0))[0];
  const fabAnim4 = useState(new Animated.Value(0))[0];
  const segmentedAnim = useRef(new Animated.Value(0)).current;
  const [segmentedWidth, setSegmentedWidth] = useState(0);

  // Swipe animation
  const swipeAnim = useState(new Animated.Value(0))[0];

  const { activeHouse, activeHouseId, setActiveHouseById } = useActiveHouse();
  const { resolvedTheme } = useThemePreference();
  const { user } = useAuth();
  const { openSignIn } = useSignInSheet();
  const { pendingCount, newestPendingCreatedAt, lastDismissedAt, setLastDismissedAt } = useInboxPending();
  const statusBarStyle = resolvedTheme === 'dark' ? 'light' : 'dark';
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
  const [syncRefreshing, setSyncRefreshing] = useState(false);
  const [syncSnackbarVisible, setSyncSnackbarVisible] = useState(false);
  const [syncSnackbarMessage, setSyncSnackbarMessage] = useState('');
  const previousActiveHouseIdRef = useRef<string | null>(null);
  const installDefaultHouseIdRef = useRef<string | null>(null);
  const houseSwitchNoticeShownRef = useRef(false);
  const [canWriteActiveHouse, setCanWriteActiveHouse] = useState(true);
  const { rooms } = useRooms(activeHouse?.id, globalRefreshKey);
  const { houses } = useHouses(globalRefreshKey);
  const roomIdsForActiveHouse = useMemo(() => rooms.map((room) => room.id), [rooms]);
  const containerFallbackOptions = useMemo(
    () => ({ fallbackRoomIds: roomIdsForActiveHouse }),
    [roomIdsForActiveHouse]
  );
  const { containers } = useContainers(
    activeHouse?.id,
    undefined,
    globalRefreshKey,
    containerFallbackOptions
  );
  const containerIdsForActiveHouse = useMemo(
    () => containers.map((container) => container.id),
    [containers]
  );
  const boxFallbackOptions = useMemo(
    () => ({
      fallbackRoomIds: roomIdsForActiveHouse,
      fallbackContainerIds: containerIdsForActiveHouse,
    }),
    [roomIdsForActiveHouse, containerIdsForActiveHouse]
  );
  const { boxes } = useBoxes(
    activeHouse?.id,
    undefined,
    undefined,
    globalRefreshKey,
    boxFallbackOptions
  );
  const { rooms: allRooms } = useRooms(undefined, globalRefreshKey);
  const { containers: allContainers } = useContainers(undefined, undefined, globalRefreshKey);
  const { boxes: allBoxes } = useBoxes(undefined, undefined, undefined, globalRefreshKey);
  const { items: allItems } = useItems(undefined, undefined, undefined, globalRefreshKey);
  const [limitCounts, setLimitCounts] = useState<LimitCounts>({ houses: 0, storageUnits: 0, items: 0 });
  const [planLimits, setPlanLimits] = useState<LimitValues>({
    houses: HOUSE_LIMIT,
    storageUnits: STORAGE_UNIT_LIMIT,
    items: ITEM_LIMIT,
    itemPicturesPerItem: ITEM_PICTURES_PER_ITEM_LIMIT,
  });

  useEffect(() => {
    let isActive = true;
    const loadPlanLimits = async () => {
      try {
        const snapshot = await getPlanLimitSnapshot();
        if (!isActive) return;
        setLimitCounts(snapshot.usage);
        setPlanLimits(snapshot.limits);
      } catch (error) {
        console.warn('Failed to load backend plan limits', error);
      }
    };

    void loadPlanLimits();
    return () => {
      isActive = false;
    };
  }, [globalRefreshKey, user?.id]);

  const isOverLimit = useMemo(() => isOverAnyLimit(limitCounts, planLimits), [limitCounts, planLimits]);
  const canShowCreateFab = canWriteActiveHouse;
  const shouldRenderFabOverlay = canShowCreateFab && isFocused;

  useEffect(() => {
    AsyncStorage.getItem(INSTALL_DEFAULT_HOUSE_ID_KEY)
      .then((value) => {
        installDefaultHouseIdRef.current = value || null;
      })
      .catch((error) => {
        console.warn('Failed to load install default house id', error);
      });
  }, []);

  const switchToSyncedHouseIfNeeded = useCallback(
    async (candidateHouseIds: string[]) => {
      const installDefaultHouseId = installDefaultHouseIdRef.current;
      if (activeHouseId && activeHouseId !== installDefaultHouseId) {
        return;
      }

      const candidateSet = new Set(candidateHouseIds.filter((houseId) => houseId !== installDefaultHouseId));
      if (!candidateSet.size) {
        return;
      }

      const localHouses = await database.collections.get<any>('houses').query().fetch();
      const nextHouse = localHouses.find((house: any) => candidateSet.has(String(house.id)));
      if (!nextHouse || nextHouse.id === activeHouseId) {
        return;
      }

      await setActiveHouseById(nextHouse.id);
    },
    [activeHouseId, setActiveHouseById]
  );

  useEffect(() => {
    const previousActiveHouseId = previousActiveHouseIdRef.current;
    previousActiveHouseIdRef.current = activeHouseId ?? null;

    const installDefaultHouseId = installDefaultHouseIdRef.current;
    if (
      !user ||
      !activeHouseId ||
      !activeHouse ||
      !installDefaultHouseId ||
      houseSwitchNoticeShownRef.current ||
      previousActiveHouseId !== installDefaultHouseId ||
      activeHouseId === installDefaultHouseId
    ) {
      return;
    }

    houseSwitchNoticeShownRef.current = true;
    setSyncSnackbarMessage(`Switched to ${activeHouse.name}`);
    setSyncSnackbarVisible(true);
  }, [activeHouse, activeHouseId, isIos, user]);

  useEffect(() => {
    let isActive = true;
    const loadWritePermission = async () => {
      if (!user || !activeHouse?.id) {
        if (isActive) setCanWriteActiveHouse(true);
        return;
      }

      if (!activeHouse.ownerId || activeHouse.ownerId === user.id) {
        if (isActive) setCanWriteActiveHouse(true);
        return;
      }

      try {
        const collaboration = await getHouseCollaboration(activeHouse.id);
        if (!isActive) return;
        if (collaboration?.allowed === false) {
          setCanWriteActiveHouse(false);
          return;
        }
        const canWriteFromRole =
          collaboration?.permissions?.is_owner === true ||
          collaboration?.my_role === 'owner' ||
          collaboration?.my_role === 'admin' ||
          collaboration?.my_role === 'editor';
        setCanWriteActiveHouse(
          canWriteFromRole || (collaboration?.permissions?.can_write_content ?? true)
        );
      } catch (error) {
        console.warn('Failed to load active house permissions', error);
        if (isActive) {
          setCanWriteActiveHouse(true);
        }
      }
    };

    void loadWritePermission();
    return () => {
      isActive = false;
    };
  }, [activeHouse?.id, activeHouse?.ownerId, isIos, user]);

  useEffect(() => {
    if (!canShowCreateFab && fabOpen) {
      setFabOpen(false);
      Animated.parallel([
        Animated.timing(fabAnim1, { toValue: 0, duration: 120, useNativeDriver: true }),
        Animated.timing(fabAnim2, { toValue: 0, duration: 120, useNativeDriver: true }),
        Animated.timing(fabAnim3, { toValue: 0, duration: 120, useNativeDriver: true }),
        Animated.timing(fabAnim4, { toValue: 0, duration: 120, useNativeDriver: true }),
      ]).start();
    }
  }, [canShowCreateFab, fabAnim1, fabAnim2, fabAnim3, fabAnim4, fabOpen]);

  useEffect(() => {
    // Use default system colors
    NavigationBar.setBackgroundColorAsync("transparent");

    // Remove Samsung dim / scrim / gradient
    NavigationBar.setBorderColorAsync("transparent");

    // Required so Android stops blending with system background
    NavigationBar.setVisibilityAsync("visible");

    // Make buttons readable
    NavigationBar.setButtonStyleAsync(resolvedTheme === 'dark' ? "light" : "dark");

    // This removes the default system "contrast enforced" mode
    NavigationBar.setBehaviorAsync("overlay-swipe");
  }, [resolvedTheme]);

  const handleSearchPress = () => {
    setIsSearching(true);
    setTimeout(() => searchbarRef.current?.focus(), 0);
  };

  const handleExitSearch = () => {
    setIsSearching(false);
    setSearchQuery('');
  };

  const handleVoicePress = () => {
    if (!user) {
      Alert.alert(
        'Sign in required',
        'Sign in to use voice actions.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Sign in', onPress: () => openSignIn() },
        ]
      );
      return;
    }
    setIsVoiceModalVisible(true);
  };

  const handleMenuPress = () => {
    navigation.dispatch(DrawerActions.openDrawer());
  };

  const showInboxBanner =
    editionCapabilities.siri &&
    isIos &&
    pendingCount > 0 &&
    (newestPendingCreatedAt ?? 0) > lastDismissedAt;

  useEffect(() => {
    if (typeof q !== 'string') return;
    const trimmed = q.trim();
    if (!trimmed) return;
    if (lastVoiceQueryRef.current === trimmed) return;
    lastVoiceQueryRef.current = trimmed;
    setIsSearching(true);
    setSearchQuery(trimmed);
    setTimeout(() => searchbarRef.current?.focus(), 0);
  }, [q]);

  const handleFabPress = () => {
    if (mode === 'boxes') {
      router.replace('/boxes/add?entry=direct');
    } else {
      // Toggle FAB menu for full mode
      if (fabOpen) {
        // Close menu
        Animated.parallel([
          Animated.timing(fabAnim1, { toValue: 0, duration: 200, useNativeDriver: true }),
          Animated.timing(fabAnim2, { toValue: 0, duration: 200, useNativeDriver: true }),
          Animated.timing(fabAnim3, { toValue: 0, duration: 200, useNativeDriver: true }),
          Animated.timing(fabAnim4, { toValue: 0, duration: 200, useNativeDriver: true }),
        ]).start(() => setFabOpen(false));
      } else {
        // Open menu
        setFabOpen(true);
        Animated.parallel([
          Animated.timing(fabAnim1, { toValue: 1, duration: 200, useNativeDriver: true }),
          Animated.timing(fabAnim2, { toValue: 1, duration: 200, useNativeDriver: true }),
          Animated.timing(fabAnim3, { toValue: 1, duration: 200, useNativeDriver: true }),
          Animated.timing(fabAnim4, { toValue: 1, duration: 200, useNativeDriver: true }),
        ]).start();
      }
    }
  };

  const handleFabAction = (action: () => void) => {
    // Close menu first
    Animated.parallel([
      Animated.timing(fabAnim1, { toValue: 0, duration: 200, useNativeDriver: true }),
      Animated.timing(fabAnim2, { toValue: 0, duration: 200, useNativeDriver: true }),
      Animated.timing(fabAnim3, { toValue: 0, duration: 200, useNativeDriver: true }),
      Animated.timing(fabAnim4, { toValue: 0, duration: 200, useNativeDriver: true }),
    ]).start(() => {
      setFabOpen(false);
      action();
    });
  };

  const onSwipeGestureEvent = Animated.event(
    [{ nativeEvent: { translationX: swipeAnim } }],
    { useNativeDriver: false }
  );

  useEffect(() => {
    Animated.timing(segmentedAnim, {
      toValue: mode === 'full' ? 0 : 1,
      duration: 220,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  }, [mode, segmentedAnim]);

  const onSwipeHandlerStateChange = (event: any) => {
    if (event.nativeEvent.state === State.END) {
      const { translationX, velocityX } = event.nativeEvent;

      // Determine swipe direction and velocity
      const swipeThreshold = 50;
      const velocityThreshold = 500;

      if (Math.abs(translationX) > swipeThreshold || Math.abs(velocityX) > velocityThreshold) {
        if (translationX > 0) {
          // Swipe right - switch to Full House mode
          if (mode !== 'full') {
            setMode('full');
          }
        } else {
          // Swipe left - switch to Boxes Only mode
          if (mode !== 'boxes') {
            setMode('boxes');
          }
        }
      }

      // Reset animation
      Animated.spring(swipeAnim, {
        toValue: 0,
        useNativeDriver: false,
      }).start();
    }
  };

  const normalizedQuery = searchQuery.trim().toLowerCase();
  const hasQuery = normalizedQuery.length > 0;

  const houseMap = useMemo(() => new Map(houses.map((house) => [house.id, house])), [houses]);
  const roomMap = useMemo(() => new Map(allRooms.map((room) => [room.id, room])), [allRooms]);
  const containerMap = useMemo(
    () => new Map(allContainers.map((container) => [container.id, container])),
    [allContainers]
  );
  const boxMap = useMemo(() => new Map(allBoxes.map((box) => [box.id, box])), [allBoxes]);

  const matchesQuery = useCallback(
    (
      name?: string | null,
      description?: string | null,
      tags?: string | null,
      notes?: string | null
    ) => {
      if (!hasQuery) {
        return false;
      }

      const nameMatch = name?.toLowerCase().includes(normalizedQuery);
      const descriptionMatch = description?.toLowerCase().includes(normalizedQuery);
      const tagsMatch = tags?.toLowerCase().includes(normalizedQuery);
      const notesMatch = notes?.toLowerCase().includes(normalizedQuery);
      return Boolean(nameMatch || descriptionMatch || tagsMatch || notesMatch);
    },
    [hasQuery, normalizedQuery]
  );

  const joinLocation = useCallback(
    (parts: (string | undefined | null)[]) => parts.filter(Boolean).join(' > '),
    []
  );

  const getRoomLocation = useCallback(
    (roomId?: string | null) => {
      if (!roomId) return undefined;
      const room = roomMap.get(roomId);
      if (!room) return undefined;
      const houseName = room.houseId ? houseMap.get(room.houseId)?.name : undefined;
      return joinLocation([houseName, room.name]);
    },
    [houseMap, joinLocation, roomMap]
  );

  const getContainerLocation = useCallback(
    (containerId?: string | null) => {
      if (!containerId) return undefined;
      const container = containerMap.get(containerId);
      if (!container) return undefined;
      const room = container.roomId ? roomMap.get(container.roomId) : undefined;
      const houseName = room?.houseId ? houseMap.get(room.houseId)?.name : undefined;
      return joinLocation([houseName, room?.name, container.name]);
    },
    [containerMap, houseMap, joinLocation, roomMap]
  );

  const getBoxLocation = useCallback(
    (boxId?: string | null) => {
      if (!boxId) return undefined;
      const box = boxMap.get(boxId);
      if (!box) return undefined;
      if (box.parentType === 'room') {
        const room = box.parentId ? roomMap.get(box.parentId) : undefined;
        const houseName = room?.houseId ? houseMap.get(room.houseId)?.name : undefined;
        return joinLocation([houseName, room?.name, box.name]);
      }
      if (box.parentType === 'container') {
        const container = box.parentId ? containerMap.get(box.parentId) : undefined;
        const room = container?.roomId ? roomMap.get(container.roomId) : undefined;
        const houseName = room?.houseId ? houseMap.get(room.houseId)?.name : undefined;
        return joinLocation([houseName, room?.name, container?.name, box.name]);
      }
      const houseName = box.houseId ? houseMap.get(box.houseId)?.name : undefined;
      return joinLocation([houseName, box.name]);
    },
    [boxMap, containerMap, houseMap, joinLocation, roomMap]
  );

  const getItemLocation = useCallback(
    (parentType?: string | null, parentId?: string | null, houseId?: string | null) => {
      if (parentType && parentId) {
        if (parentType === 'room') {
          return getRoomLocation(parentId);
        }
        if (parentType === 'container') {
          return getContainerLocation(parentId);
        }
        if (parentType === 'box') {
          return getBoxLocation(parentId);
        }
      }
      const houseName = houseId ? houseMap.get(houseId)?.name : undefined;
      return houseName || undefined;
    },
    [getBoxLocation, getContainerLocation, getRoomLocation, houseMap]
  );

  const itemResults: SearchResult[] = useMemo(() => {
    if (!hasQuery) return [];
    return allItems
      .filter((item) => matchesQuery(item.name, item.description, item.tags, item.notes))
      .map((item) => ({
        id: item.id,
        type: 'item' as const,
        title: item.name,
        description: item.description,
        context: getItemLocation(item.parentType, item.parentId, item.houseId),
      }));
  }, [allItems, getItemLocation, hasQuery, matchesQuery]);

  const boxResults: SearchResult[] = useMemo(() => {
    if (!hasQuery) return [];
    return allBoxes
      .filter((box) => matchesQuery(box.name, box.description))
      .map((box) => ({
        id: box.id,
        type: 'box' as const,
        title: box.name,
        description: box.description,
        context: getBoxLocation(box.id),
      }));
  }, [allBoxes, getBoxLocation, hasQuery, matchesQuery]);

  const containerResults: SearchResult[] = useMemo(() => {
    if (!hasQuery) return [];
    return allContainers
      .filter((container) => matchesQuery(container.name, container.description))
      .map((container) => ({
        id: container.id,
        type: 'container' as const,
        title: container.name,
        description: container.description,
        context: getContainerLocation(container.id),
      }));
  }, [allContainers, getContainerLocation, hasQuery, matchesQuery]);

  const roomResults: SearchResult[] = useMemo(() => {
    if (!hasQuery) return [];
    return allRooms
      .filter((room) => matchesQuery(room.name, room.description))
      .map((room) => ({
        id: room.id,
        type: 'room' as const,
        title: room.name,
        description: room.description,
        context: getRoomLocation(room.id),
      }));
  }, [allRooms, getRoomLocation, hasQuery, matchesQuery]);

  const hasAnyResults = itemResults.length + boxResults.length + containerResults.length + roomResults.length > 0;

  const handleResultPress = (result: SearchResult) => {
    handleExitSearch();
    switch (result.type) {
      case 'item':
        router.replace(`/items/${result.id}?entry=direct`);
        break;
      case 'box':
        router.replace(`/boxes/${result.id}?entry=direct`);
        break;
      case 'container':
        router.replace(`/containers/${result.id}?entry=direct`);
        break;
      case 'room':
        router.replace(`/rooms/${result.id}?entry=direct`);
        break;
      default:
        break;
    }
  };

  const handlePullToRefresh = useCallback(async () => {
    if (syncRefreshing) return;
    if (!user) {
      setSyncSnackbarMessage('Sign in to sync');
      setSyncSnackbarVisible(true);
      return;
    }
    let houseIds = await loadSyncedHouseIds();
    if (!houseIds.length) {
      setSyncSnackbarMessage('Cloud sync is disabled for all houses');
      setSyncSnackbarVisible(true);
      return;
    }
    setSyncRefreshing(true);
    try {
      await syncPowerSyncConnectionForSession(true);
      await saveLastSyncAt(Date.now());
      const syncedAfterRefresh = await loadSyncedHouseIds();
      await switchToSyncedHouseIfNeeded(syncedAfterRefresh);
      triggerGlobalRefresh();
      setSyncSnackbarMessage(syncedAfterRefresh.length ? 'Sync completed' : 'No cloud houses found');
      setSyncSnackbarVisible(true);
    } catch (error) {
      console.warn('Pull-to-refresh sync failed', error);
      setSyncSnackbarMessage('Sync failed');
      setSyncSnackbarVisible(true);
    } finally {
      setSyncRefreshing(false);
    }
  }, [switchToSyncedHouseIfNeeded, syncRefreshing, user]);

  const renderInventoryEmptyState = useCallback(
    (message: string) => (
      <View
        testID="home-inventory-empty-state"
        style={{
          alignItems: 'center',
          marginTop: spacing.xl,
          paddingHorizontal: spacing.lg,
        }}
      >
        <Image
          source={EMPTY_STATE_IMAGE}
          style={{ width: '100%', maxWidth: 320, height: 220 }}
          resizeMode="contain"
        />
        <Text
          variant="bodyMedium"
          style={{ textAlign: 'center', color: colors.onSurfaceVariant, marginTop: spacing.md }}
        >
          {message}
        </Text>
      </View>
    ),
    [colors.onSurfaceVariant, spacing.lg, spacing.md, spacing.xl]
  );



  return (
    <>
      {/* Status bar (Android needs the backgroundColor prop) */}
      <StatusBar
        style={statusBarStyle}
        backgroundColor="transparent"
        translucent={false}
      />

      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['bottom']}>
        {/* App Bar */}
      <Appbar.Header
  style={{
    backgroundColor: colors.surface,
    height: layout.appBarHeight,
    elevation: elevation.level0,
    borderBottomWidth: 0,
    shadowColor: 'transparent',
    shadowOpacity: 0,
    shadowRadius: 0,
    shadowOffset: { width: 0, height: 0 },
  }}
>
  {isSearching ? (
    <Searchbar
      ref={searchbarRef}
      testID="home-search-input"
      placeholder="Search items, boxes, containers, rooms"
      value={searchQuery}
      onChangeText={setSearchQuery}
      icon="arrow-left"
      onIconPress={handleExitSearch}
      clearIcon={searchQuery ? "close" : undefined}
      onClearIconPress={() => setSearchQuery('')}
      autoFocus
      style={{ flex: 1, marginHorizontal: spacing.sm }}
      inputStyle={{ fontSize: typography.bodyFontSize }}
    />
  ) : (
    <>
      <View>
        <Appbar.Action
          icon="menu"
          onPress={handleMenuPress}
          testID="home-drawer-menu-button"
          accessibilityLabel="Open drawer"
          color={`${colors.primary}${opacity.alpha80}`}
        />
        {isIos && pendingCount > 0 ? (
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              right: 10,
              top: 10,
              width: 8,
              height: 8,
              borderRadius: 4,
              backgroundColor: colors.error,
            }}
          />
        ) : null}
      </View>

      <Appbar.Content
        title={
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Text
              variant="titleLarge"
              style={{
                fontWeight: typography.appBarTitle.fontWeight,
                letterSpacing: typography.appBarTitle.letterSpacing,
              }}
            >
              everfind
            </Text>
          </View>
        }
      />

      <Appbar.Action
        icon="magnify"
        onPress={handleSearchPress}
        accessibilityLabel="Search inventory"
        testID="home-search-button"
        color={`${colors.primary}${opacity.alpha80}`}
      />
      {editionCapabilities.naturalLanguageProcessing ? (
        <Appbar.Action
          icon="assistant"
          onPress={handleVoicePress}
          accessibilityLabel="Voice action"
          testID="home-voice-action-button"
          color={`${colors.primary}${opacity.alpha80}`}
        />
      ) : null}
    </>
  )}
</Appbar.Header>

        {showInboxBanner ? (
          <Surface
            elevation={0}
            style={{
              marginHorizontal: spacing.xxl,
              marginTop: spacing.sm,
              borderRadius: shapes.cornerSmall,
              backgroundColor: colors.primaryContainer,
            }}
          >
            <TouchableOpacity
              style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, paddingVertical: spacing.sm }}
              onPress={() => router.push('/inbox')}
            >
              <Icon source="inbox-arrow-down-outline" size={16} color={colors.onPrimaryContainer} />
              <Text style={{ flex: 1, color: colors.onPrimaryContainer, marginLeft: spacing.xs }}>
                {pendingCount} Siri items ready to {user ? 'review' : 'organize'}
              </Text>
              <Pressable
                onPress={async () => {
                  await dismissInboxBanner();
                  setLastDismissedAt(Date.now());
                }}
                hitSlop={8}
                style={{ width: 24, height: 24, alignItems: 'center', justifyContent: 'center' }}
              >
                <Icon source="close" size={16} color={colors.onPrimaryContainer} />
              </Pressable>
            </TouchableOpacity>
          </Surface>
        ) : null}


        {isSearching ? (

        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <KeyboardAwareScrollView
            enableOnAndroid
            keyboardShouldPersistTaps="always"
            contentContainerStyle={{ padding: spacing.xxl, paddingBottom: spacing.xxl }}
          >

          <Surface elevation={elevation.level1} style={{ margin: spacing.xxl, borderRadius: shapes.cornerSmall, overflow: 'hidden', flex: 1, backgroundColor: surfaces.card }}>
            <ScrollView
              style={{ flex: 1, backgroundColor: colors.background }}
              contentContainerStyle={{ paddingVertical: spacing.sm, gap: spacing.sm }}
              keyboardShouldPersistTaps="handled"
            >
              {!hasQuery ? (
                <Text variant="bodyMedium" style={{ textAlign: 'center', color: colors.onSurfaceVariant, padding: spacing.xxxl }}>
                  Start typing to search across all houses
                </Text>
              ) : hasAnyResults ? (
                <>
                  {itemResults.length > 0 && (
                    <List.Section title="Items">
                      {itemResults.map((result) => (
                        <Surface
                          key={`item-${result.id}`}
                          elevation={elevation.level1}
                          style={{
                            marginHorizontal: spacing.sm,
                            marginBottom: spacing.sm,
                            borderRadius: shapes.cornerSmall,
                            backgroundColor: surfaces.cardLow,
                          }}
                        >
                          <Pressable
                            testID={`home-search-result-item-${result.id}`}
                            accessibilityLabel={`Search result ${result.title}`}
                            accessibilityRole="button"
                            onPress={() => handleResultPress(result)}
                          >
                            <List.Item
                              pointerEvents="none"
                              title={result.title}
                              description={result.context || result.description}
                              left={(props) => <List.Icon {...props} icon="shape-outline" />}
                              style={{ backgroundColor: 'transparent' }}
                            />
                          </Pressable>
                        </Surface>
                      ))}
                    </List.Section>
                  )}

                  {boxResults.length > 0 && (
                    <List.Section title="Boxes">
                      {boxResults.map((result) => (
                        <Surface
                          key={`box-${result.id}`}
                          elevation={elevation.level1}
                          style={{
                            marginHorizontal: spacing.sm,
                            marginBottom: spacing.sm,
                            borderRadius: shapes.cornerSmall,
                            backgroundColor: surfaces.cardLow,
                          }}
                        >
                          <List.Item
                            title={result.title}
                            description={result.context || result.description}
                            left={(props) => <List.Icon {...props} icon="archive-outline" />}
                            right={(props) => <List.Icon {...props} icon="chevron-right" />}
                            onPress={() => handleResultPress(result)}
                            style={{ backgroundColor: 'transparent' }}
                          />
                        </Surface>
                      ))}
                    </List.Section>
                  )}

                  {containerResults.length > 0 && (
                    <List.Section title="Containers">
                      {containerResults.map((result) => (
                        <Surface
                          key={`container-${result.id}`}
                          elevation={elevation.level1}
                          style={{
                            marginHorizontal: spacing.sm,
                            marginBottom: spacing.sm,
                            borderRadius: shapes.cornerSmall,
                            backgroundColor: surfaces.cardLow,
                          }}
                        >
                          <List.Item
                            title={result.title}
                            description={result.context || result.description}
                            left={(props) => <List.Icon {...props} icon="cupboard-outline" />}
                            right={(props) => <List.Icon {...props} icon="chevron-right" />}
                            onPress={() => handleResultPress(result)}
                            style={{ backgroundColor: 'transparent' }}
                          />
                        </Surface>
                      ))}
                    </List.Section>
                  )}

                  {roomResults.length > 0 && (
                    <List.Section title="Rooms">
                      {roomResults.map((result) => (
                        <Surface
                          key={`room-${result.id}`}
                          elevation={elevation.level1}
                          style={{
                            marginHorizontal: spacing.sm,
                            marginBottom: spacing.sm,
                            borderRadius: shapes.cornerSmall,
                            backgroundColor: surfaces.cardLow,
                          }}
                        >
                          <List.Item
                            title={result.title}
                            description={result.context || result.description}
                            left={(props) => <List.Icon {...props} icon="door" />}
                            right={(props) => <List.Icon {...props} icon="chevron-right" />}
                            onPress={() => handleResultPress(result)}
                            style={{ backgroundColor: 'transparent' }}
                          />
                        </Surface>
                      ))}
                    </List.Section>
                  )}
                </>
              ) : (
                <Text variant="bodyMedium" style={{ textAlign: 'center', color: colors.onSurfaceVariant, padding: spacing.xxxl }}>
                  No results found across all houses
                </Text>
              )}
            </ScrollView>
          </Surface>
          </KeyboardAwareScrollView>
          </KeyboardAvoidingView>
        ) : (
          <>
            {/* Mode Toggle */}
            <View style={{ paddingHorizontal: spacing.xxl, paddingTop: spacing.lg, paddingBottom: spacing.sm, backgroundColor: colors.surface }}>
              <Animated.View
                style={{
                  transform: [{
                    translateX: swipeAnim.interpolate({
                      inputRange: [-100, 0, 100],
                      outputRange: [-10, 0, 10],
                    })
                  }],
                  opacity: swipeAnim.interpolate({
                    inputRange: [-50, 0, 50],
                    outputRange: [0.7, 1, 0.7],
                  })
                }}
              >
                <View
                  onLayout={(event) => setSegmentedWidth(event.nativeEvent.layout.width)}
                  style={{
                    backgroundColor: surfaces.rail,
                    borderRadius: shapes.cornerFull,
                    padding: spacing.segmentedPadding,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: spacing.segmentedPadding,
                  }}
                >
                  {segmentedWidth > 0 && (
                    <Animated.View
                      pointerEvents="none"
                      style={{
                        position: 'absolute',
                        top: spacing.segmentedPadding,
                        bottom: spacing.segmentedPadding,
                        left: spacing.segmentedPadding,
                        width: (segmentedWidth - spacing.segmentedPadding * 2) / 2,
                        borderRadius: shapes.cornerFull,
                        backgroundColor: colors.primaryContainer,
                        transform: [
                          {
                            translateX: Animated.multiply(
                              segmentedAnim,
                              (segmentedWidth - spacing.segmentedPadding * 2) / 2,
                            ),
                          },
                        ],
                      }}
                    />
                  )}

                  <Pressable
                    style={{ flex: 1, paddingVertical: spacing.segmentedItemPadding, alignItems: 'center', justifyContent: 'center' }}
                    onPress={() => setMode('full')}
                  >
                    <Text
                      variant="labelLarge"
                      style={{
                        color: mode === 'full' ? colors.onPrimaryContainer : `${colors.onSurface}${opacity.alpha80}`,
                        fontWeight: typography.segmentedLabel.fontWeight,
                      }}
                    >
                      Rooms
                    </Text>
                  </Pressable>

                  <Pressable
                    style={{ flex: 1, paddingVertical: spacing.segmentedItemPadding, alignItems: 'center', justifyContent: 'center' }}
                    onPress={() => setMode('boxes')}
                  >
                    <Text
                      variant="labelLarge"
                      style={{
                        color: mode === 'boxes' ? colors.onPrimaryContainer : `${colors.onSurface}${opacity.alpha80}`,
                        fontWeight: typography.segmentedLabel.fontWeight,
                      }}
                    >
                      Boxes
                    </Text>
                  </Pressable>
                </View>
              </Animated.View>
            </View>


            {/* Main Content */}
            <PanGestureHandler
              onGestureEvent={onSwipeGestureEvent}
              onHandlerStateChange={onSwipeHandlerStateChange}
              failOffsetY={[-12, 12]}
              activeOffsetX={30}
            >
              <ScrollView
                style={{ flex: 1, backgroundColor: colors.background }}
                contentContainerStyle={{ padding: spacing.xxl, paddingBottom: spacing.scrollBottomInset, gap: spacing.lg }} // Add padding for FAB
                refreshControl={editionCapabilities.cloudSync ? (
                  <RefreshControl
                    refreshing={syncRefreshing}
                    onRefresh={() => {
                      void handlePullToRefresh();
                    }}
                  />
                ) : undefined}
              >
              {isOverLimit && (
                <Surface style={{ padding: spacing.infoBlockInset, borderRadius: shapes.cornerSmall, backgroundColor: colors.errorContainer }} elevation={elevation.level1}>
                  <Text variant="bodyMedium" style={{ color: colors.onErrorContainer }}>
                    Usage limit reached. Your current plan allows up to {formatLimitValue(planLimits.houses)} houses, {formatLimitValue(planLimits.storageUnits)} storage units, and {formatLimitValue(planLimits.items)} items. {isOverLimit ? 'Please reduce your counts to continue adding data.' : 'You cannot add new records right now.'}
                  </Text>
                </Surface>
              )}
              {!activeHouse ? (
                <Text variant="bodyLarge" style={{ textAlign: 'center', marginTop: spacing.giant }}>
                  No active house selected
                </Text>
              ) : mode === 'full' ? (
                <>
                  {rooms.length === 0 ? (
                    renderInventoryEmptyState(`No rooms in ${activeHouse.name}`)
                  ) : (
                    rooms.map((room) => (
                      <Surface
                        key={room.id}
                        elevation={elevation.level2}
                        style={{
                          borderRadius: shapes.cornerLarge,
                          padding: spacing.xxl,
                          backgroundColor: surfaces.card,
                        }}
                      >
                        <Pressable
                          testID={`home-room-card-${room.id}`}
                          accessibilityLabel={`Room ${room.name}`}
                          onPress={() => router.replace(`/rooms/${room.id}?entry=direct`)}
                          //onPress={() => router.navigate({ pathname: '/rooms/[id]', params: { id: room.id, entry: 'direct' } })}
                          style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.lg }}
                        >
                          <View
                            style={{
                              width: layout.roomIconTile,
                              height: layout.roomIconTile,
                              borderRadius: shapes.cornerSmall,
                              alignItems: 'center',
                              justifyContent: 'center',
                              backgroundColor: `${colors.primaryContainer}${opacity.alpha40}`,
                            }}
                          >
                            <Icon source="door" size={22} color={colors.primary} />
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text variant="titleMedium" style={{ color: colors.onSurface, lineHeight: typography.titleLineHeight }}>
                              {room.name}
                            </Text>
                            {room.description ? (
                              <Text variant="bodySmall" style={{ color: colors.onSurfaceVariant, marginTop: spacing.xs }}>
                                {room.description}
                              </Text>
                            ) : null}
                          </View>
                          <Icon source="chevron-right" size={22} color={`${colors.onSurfaceVariant}${opacity.alpha60}`} />
                        </Pressable>

                        <View style={{ marginTop: spacing.infoBlockInset, gap: spacing.md }}>
                          {containers.filter(c => c.roomId === room.id).length === 0 ? (
                            <View style={{ paddingVertical: spacing.xs, paddingHorizontal: spacing.xxs }}>
                              <Text variant="bodyMedium" style={{ color: `${colors.onSurfaceVariant}${opacity.alpha70}`, lineHeight: typography.bodyLineHeight }}>
                                Nothing here yet
                              </Text>
                              <Text variant="bodyMedium" style={{ color: `${colors.onSurfaceVariant}${opacity.alpha60}`, lineHeight: typography.bodyLineHeight }}>
                                Add a container to get started
                              </Text>
                            </View>
                          ) : (
                            containers.filter(c => c.roomId === room.id).map((container) => (
                              <TouchableOpacity
                                key={container.id}
                                onPress={() => router.replace(`/containers/${container.id}?entry=direct` as any)}
                                style={{
                                  flexDirection: 'row',
                                  alignItems: 'center',
                                  paddingVertical: spacing.sm,
                                  paddingHorizontal: spacing.xs,
                                  borderRadius: shapes.cornerSmall,
                                  backgroundColor: surfaces.cardLow,
                                }}
                              >
                                <View style={{ width: 28, alignItems: 'center' }}>
                                  <Icon source="cupboard-outline" size={18} color={`${colors.primary}${opacity.alpha60}`} />
                                </View>
                                <View style={{ flex: 1 }}>
                                  <Text variant="bodyLarge" style={{ color: colors.onSurface, lineHeight: typography.compactTitleLineHeight }}>
                                    {container.name}
                                  </Text>
                                  {container.description ? (
                                    <Text variant="bodySmall" style={{ color: colors.onSurfaceVariant, marginTop: spacing.xs, lineHeight: typography.bodyLineHeight }}>
                                      {container.description}
                                    </Text>
                                  ) : null}
                                </View>
                                <Icon source="chevron-right" size={18} color={`${colors.onSurfaceVariant}${opacity.alpha53}`} />
                              </TouchableOpacity>
                            ))
                          )}
                        </View>
                      </Surface>
                    ))
                  )}
                </>
              ) : (
                <>
                  {boxes.length === 0 ? (
                    renderInventoryEmptyState(`No boxes in ${activeHouse.name}`)
                  ) : (
                    boxes.map((box) => (
                      <Surface
                        key={box.id}
                        elevation={elevation.level1}
                        style={{
                          borderRadius: shapes.cornerMedium,
                          padding: spacing.infoBlockInset,
                          backgroundColor: surfaces.card,
                        }}
                      >
                        <TouchableOpacity
                          onPress={() => router.replace(`/boxes/${box.id}?entry=direct` as any)}
                          style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.lg }}
                        >
                          <View style={{
                            width: layout.boxIconTile,
                            height: layout.boxIconTile,
                            borderRadius: shapes.cornerSmall,
                            alignItems: 'center',
                            justifyContent: 'center',
                            backgroundColor: `${colors.primaryContainer}${opacity.alpha40}`,
                          }}>
                            <Icon source="archive-outline" size={20} color={colors.primary} />
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text variant="titleMedium" style={{ color: colors.onSurface, lineHeight: typography.titleLineHeight }}>
                              {box.name}
                            </Text>
                            {box.description ? (
                              <Text variant="bodyMedium" style={{ color: colors.onSurfaceVariant, marginTop: spacing.xs }}>
                                {box.description}
                              </Text>
                            ) : null}
                          </View>
                          <Icon source="chevron-right" size={20} color={`${colors.onSurfaceVariant}${opacity.alpha60}`} />
                        </TouchableOpacity>
                      </Surface>
                    ))
                  )}
                </>
              )}
              </ScrollView>
            </PanGestureHandler>
          </>
        )}

      </SafeAreaView>

      {editionCapabilities.naturalLanguageProcessing ? (
        <VoiceIntentModal
          visible={isVoiceModalVisible}
          onDismiss={() => setIsVoiceModalVisible(false)}
        />
      ) : null}

      {/* Custom FAB Menu positioned outside SafeAreaView */}
      {shouldRenderFabOverlay ? renderFabOverlay(mode === 'full' ? (
        <>
          {/* Individual FABs for menu */}
          <Animated.View
            pointerEvents={fabOpen ? 'auto' : 'none'}
            style={{
              position: 'absolute',
              right: spacing.fabBaseOffset,
              bottom: spacing.fabBaseOffset + spacing.fabStackOffset1 + insets.bottom,
              flexDirection: 'row',
              alignItems: 'center',
              zIndex: 21,
              opacity: fabAnim1,
              transform: [
                {
                  translateY: fabAnim1.interpolate({
                    inputRange: [0, 1],
                    outputRange: [8, 0],
                  }),
                },
              ],
            }}
          >
            <FabLabel
              text="Add Item"
              accessibilityLabel="Add Item"
              disabled={isOverLimit}
              onPress={() => handleFabAction(() => router.replace('/items/add?entry=direct'))}
              animatedStyle={{
                marginRight: spacing.lg,
                opacity: fabAnim1,
                transform: [
                  {
                    translateX: fabAnim1.interpolate({
                      inputRange: [0, 1],
                      outputRange: [12, 0],
                    }),
                  },
                ],
              }}
            />

            <OverlayFab
              icon="shape-outline"
              size="small"
              accessibilityLabel="Add Item"
              disabled={isOverLimit}
              style={{
                backgroundColor: colors.primary,
                shadowColor: colors.shadow,
                elevation: elevation.level3,
                zIndex: 22,
                shadowOpacity: 0.24,
                shadowRadius: 8,
                shadowOffset: { width: 0, height: 4 },
              }}
              onPress={() => handleFabAction(() => router.replace('/items/add?entry=direct'))}
            />
          </Animated.View>



          <Animated.View
            pointerEvents={fabOpen ? 'auto' : 'none'}
            style={{
              position: 'absolute',
              right: spacing.fabBaseOffset,
              bottom: spacing.fabBaseOffset + spacing.fabStackOffset2 + insets.bottom,
              flexDirection: 'row',
              alignItems: 'center',
              zIndex: 23,
              opacity: fabAnim1,
              transform: [
                {
                  translateY: fabAnim1.interpolate({
                    inputRange: [0, 1],
                    outputRange: [8, 0],
                  }),
                },
              ],
            }}
          >
            <FabLabel
              text="Add Box"
              accessibilityLabel="Add Box"
              disabled={isOverLimit}
              onPress={() => handleFabAction(() => router.replace('/boxes/add?entry=direct'))}
              animatedStyle={{
                marginRight: spacing.lg,
                opacity: fabAnim1,
                transform: [
                  {
                    translateX: fabAnim1.interpolate({
                      inputRange: [0, 1],
                      outputRange: [12, 0],
                    }),
                  },
                ],
              }}
            />

            <OverlayFab
              icon="archive-outline"
              size="small"
              accessibilityLabel="Add Box"
              disabled={isOverLimit}
              style={{
                backgroundColor: colors.primary,
                shadowColor: colors.shadow,
                elevation: elevation.level3,
                zIndex: 24,
                shadowOpacity: 0.24,
                shadowRadius: 8,
                shadowOffset: { width: 0, height: 4 },
              }}
              onPress={() => handleFabAction(() => router.replace('/boxes/add?entry=direct'))}
            />
          </Animated.View>

          <Animated.View
            pointerEvents={fabOpen ? 'auto' : 'none'}
            style={{
              position: 'absolute',
              right: spacing.fabBaseOffset,
              bottom: spacing.fabBaseOffset + spacing.fabStackOffset3 + insets.bottom,
              flexDirection: 'row',
              alignItems: 'center',
              zIndex: 25,
              opacity: fabAnim1,
              transform: [
                {
                  translateY: fabAnim1.interpolate({
                    inputRange: [0, 1],
                    outputRange: [8, 0],
                  }),
                },
              ],
            }}
          >
            <FabLabel
              text="Add Container"
              accessibilityLabel="Add Container"
              disabled={isOverLimit}
              onPress={() => handleFabAction(() => router.replace('/containers/add?entry=direct'))}
              animatedStyle={{
                marginRight: spacing.lg,
                opacity: fabAnim1,
                transform: [
                  {
                    translateX: fabAnim1.interpolate({
                      inputRange: [0, 1],
                      outputRange: [12, 0],
                    }),
                  },
                ],
              }}
            />

            <OverlayFab
              icon="cupboard-outline"
              size="small"
              accessibilityLabel="Add Container"
              disabled={isOverLimit}
              style={{
                backgroundColor: colors.primary,
                shadowColor: colors.shadow,
                elevation: elevation.level3,
                zIndex: 26,
                shadowOpacity: 0.24,
                shadowRadius: 8,
                shadowOffset: { width: 0, height: 4 },
              }}
              onPress={() => handleFabAction(() => router.replace('/containers/add?entry=direct'))}
            />
          </Animated.View>

          <Animated.View
            pointerEvents={fabOpen ? 'auto' : 'none'}
            style={{
              position: 'absolute',
              right: spacing.fabBaseOffset,
              bottom: spacing.fabBaseOffset + spacing.fabStackOffset4 + insets.bottom,
              flexDirection: 'row',
              alignItems: 'center',
              zIndex: 27,
              opacity: fabAnim1,
              transform: [
                {
                  translateY: fabAnim1.interpolate({
                    inputRange: [0, 1],
                    outputRange: [8, 0],
                  }),
                },
              ],
            }}
          >
            <FabLabel
              text="Add Room"
              accessibilityLabel="Add Room"
              testID="home-create-room-label"
              disabled={isOverLimit}
              onPress={() => handleFabAction(() => router.replace('/rooms/add?entry=direct'))}
              animatedStyle={{
                marginRight: spacing.lg,
                opacity: fabAnim1,
                transform: [
                  {
                    translateX: fabAnim1.interpolate({
                      inputRange: [0, 1],
                      outputRange: [12, 0],
                    }),
                  },
                ],
              }}
            />

            <OverlayFab
              icon="door"
              size="small"
              accessibilityLabel="Add Room"
              testID="home-create-room-button"
              disabled={isOverLimit}
              style={{
                backgroundColor: colors.primary,
                shadowColor: colors.shadow,
                elevation: elevation.level3,
                zIndex: 28,
                shadowOpacity: 0.24,
                shadowRadius: 8,
                shadowOffset: { width: 0, height: 4 },
              }}
              onPress={() => handleFabAction(() => router.replace('/rooms/add?entry=direct'))}
            />
          </Animated.View>

          {/* Main FAB */}
          <OverlayFab
            icon={fabOpen ? 'close' : 'plus'}
            size="medium"
            accessibilityLabel={fabOpen ? 'Close create menu' : 'Open create menu'}
            testID="home-create-menu-button"
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
            onPress={handleFabPress}
          />
        </>
      ) : (
        <OverlayFab
          icon="archive-outline"
          size="medium"
          accessibilityLabel="Add Box"
          disabled={isOverLimit}
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
          onPress={handleFabPress}
        />
      )) : null}
      <Snackbar
        visible={syncSnackbarVisible}
        onDismiss={() => setSyncSnackbarVisible(false)}
        duration={2200}
      >
        {syncSnackbarMessage}
      </Snackbar>
      <AppProgressDialog
        visible={syncRefreshing}
        message="Syncing your houses and inventory. Please wait."
      />
    </>
  );
}

function OverlayFab({
  icon,
  size,
  disabled,
  style,
  onPress,
  accessibilityLabel,
  testID,
}: {
  icon: string;
  size: 'small' | 'medium';
  disabled?: boolean;
  style?: any;
  onPress: () => void;
  accessibilityLabel?: string;
  testID?: string;
}) {
  const { colors } = useTheme<AppTheme>();
  const diameter = size === 'small' ? 40 : 56;
  const iconSize = size === 'small' ? 22 : 24;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      testID={testID}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        {
          width: diameter,
          height: diameter,
          borderRadius: diameter / 2,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: disabled ? colors.surfaceDisabled : colors.primary,
          opacity: pressed && !disabled ? 0.9 : 1,
        },
        style,
      ]}
    >
      <MaterialCommunityIcons
        name={icon as any}
        size={iconSize}
        color={disabled ? colors.onSurfaceDisabled : colors.onPrimary}
      />
    </Pressable>
  );
}
