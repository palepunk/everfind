import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Image, Pressable, RefreshControl, ScrollView, View, useWindowDimensions } from 'react-native';
import { Chip, Icon, IconButton, List, Surface, Text, useTheme } from 'react-native-paper';

import { getImageSource } from '@/utils/imageUtils';
import type { AppTheme } from '@/utils/theme/theme';
import type { EntityConfig, EntityType } from './entity.types';

type ChildSection = {
  type: EntityType;
  label: string;
  icon: string;
  items: { id: string; name: string; description?: string | null }[];
  onAdd: () => void;
  onPressItem: (id: string) => void;
  onVoiceAdd?: () => void;
};

type EntityOverviewProps<T> = {
  config: EntityConfig<T>;
  entity: T & { name?: string; description?: string | null; imagePath?: string | null };
  fields: { label: string; value: string }[];
  tags?: string;
  locationPath?: string | null;
  childrenSections: ChildSection[];
  onOpenImage: () => void;
  onPickImage?: () => void;
  onTakePhoto?: () => void;
  onDeleteImage?: () => void;
  onAddImageFromGallery?: () => void;
  onAddImageFromCamera?: () => void;
  onAddImagePress?: () => void;
  imageLoading?: boolean;
  canManageImage?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
  extraSection?: React.ReactNode;
  imagePaths?: string[];
  currentImageIndex?: number;
  onChangeImageIndex?: (index: number) => void;
  onLocationPress?: () => void;
};

export function EntityOverview<T>({
  config,
  entity,
  fields,
  tags,
  locationPath,
  childrenSections,
  onOpenImage,
  onPickImage,
  onTakePhoto,
  onDeleteImage,
  onAddImageFromGallery,
  onAddImageFromCamera,
  onAddImagePress,
  imageLoading = false,
  canManageImage = false,
  refreshing = false,
  onRefresh,
  extraSection,
  imagePaths,
  currentImageIndex = 0,
  onChangeImageIndex,
  onLocationPress,
}: EntityOverviewProps<T>) {
  const { colors, custom } = useTheme<AppTheme>();
  const { spacing, shapes, elevation, surfaces } = custom;
  const { width } = useWindowDimensions();
  const [collapsedSections, setCollapsedSections] = useState<Partial<Record<EntityType, boolean>>>({});
  const [imageMenuVisible, setImageMenuVisible] = useState(false);
  const [addImageMenuVisible, setAddImageMenuVisible] = useState(false);
  const [imageGalleryWidth, setImageGalleryWidth] = useState(0);
  const [flatSummaryCardHeight, setFlatSummaryCardHeight] = useState(208);
  const imageGalleryRef = useRef<ScrollView | null>(null);

  const galleryImages = useMemo(() => {
    if (imagePaths) {
      return imagePaths;
    }
    return entity.imagePath ? [entity.imagePath] : [];
  }, [entity.imagePath, imagePaths]);
  const hasGalleryImages = galleryImages.length > 0;
  const visibleImageIndex = Math.min(Math.max(currentImageIndex, 0), Math.max(galleryImages.length - 1, 0));
  const visibleImagePath = hasGalleryImages ? galleryImages[visibleImageIndex] : null;

  const visibleSections = useMemo(
    () => childrenSections.filter((section) => section.items.length > 0),
    [childrenSections]
  );
  const isFlatOverview = ['room', 'container', 'box', 'item'].includes(config.type);
  const compactTileWidth = useMemo(() => {
    const outerPadding = spacing.xxl * 2;
    const gutter = spacing.md * 2;
    const availableWidth = width - outerPadding;
    if (availableWidth < 300) {
      return '100%';
    }
    return (availableWidth - gutter) / 2;
  }, [spacing.md, spacing.xxl, width]);

  useEffect(() => {
    setCollapsedSections((prev) => {
      const next = { ...prev };
      visibleSections.forEach((section) => {
        if (next[section.type] === undefined) {
          next[section.type] = false;
        }
      });
      return next;
    });
  }, [visibleSections]);

  useEffect(() => {
    if (!hasGalleryImages || imageGalleryWidth <= 0) return;
    imageGalleryRef.current?.scrollTo({
      x: visibleImageIndex * imageGalleryWidth,
      animated: false,
    });
  }, [hasGalleryImages, imageGalleryWidth, visibleImageIndex]);

  useEffect(() => {
    if (visibleImagePath) return;
    setImageMenuVisible(false);
  }, [visibleImagePath]);

  const closeMenus = () => {
    setImageMenuVisible(false);
    setAddImageMenuVisible(false);
  };

  const ActionPanel = ({
    actions,
    align = 'right',
  }: {
    actions: { key: string; label: string; icon: string; onPress?: () => void }[];
    align?: 'left' | 'right';
  }) => (
    <Surface
      elevation={elevation.level2}
      style={{
        position: 'absolute',
        top: spacing.xxl + spacing.sm,
        ...(align === 'right' ? { right: 0 } : { left: 0 }),
        backgroundColor: surfaces.card,
        borderRadius: shapes.cornerMedium,
        paddingVertical: spacing.xs / 2,
        minWidth: 220,
        maxWidth: 260,
      }}
    >
      {actions.map((action) => (
        <Pressable
          key={action.key}
          testID={`entity-overview-image-action-${action.key}`}
          accessibilityLabel={action.label}
          onPress={() => {
            closeMenus();
            action.onPress?.();
          }}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: spacing.xs,
            paddingHorizontal: spacing.sm,
            paddingVertical: spacing.xs,
          }}
        >
          <Icon source={action.icon} size={16} color={colors.onSurfaceVariant} />
          <Text
            variant="bodyMedium"
            numberOfLines={1}
            style={{ color: colors.onSurface, flexShrink: 1 }}
          >
            {action.label}
          </Text>
        </Pressable>
      ))}
    </Surface>
  );

  const FieldRow = ({
    label,
    value,
    onPress,
  }: {
    label: string;
    value: string;
    onPress?: () => void;
  }) => (
    <Pressable disabled={!onPress} onPress={onPress}>
    <Surface
      style={{
        backgroundColor: surfaces.cardLow,
        borderRadius: shapes.cornerSmall,
        padding: spacing.lg,
        gap: spacing.xs,
      }}
    >
      <Text variant="bodySmall" style={{ color: colors.onSurfaceVariant }}>
        {label}
      </Text>
      <Text variant="bodyLarge" style={{ color: colors.onSurface }}>
        {value}
      </Text>
    </Surface>
    </Pressable>
  );

  const SectionHeader = ({
    title,
    count,
    isCollapsed,
    onToggle,
  }: {
    title: string;
    count?: number;
    isCollapsed: boolean;
    onToggle: () => void;
  }) => (
    <Pressable
      onPress={onToggle}
      accessibilityRole="button"
      accessibilityLabel={isCollapsed ? `Expand ${title}` : `Collapse ${title}`}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: spacing.md,
      }}
    >
      <Text variant="titleMedium" style={{ color: colors.onSurface }}>
        {typeof count === 'number' ? `${title} (${count})` : title}
      </Text>
      <Icon source={isCollapsed ? 'chevron-down' : 'chevron-up'} size={18} />
    </Pressable>
  );

  const overviewBody = (
    <>
      <View style={{ position: 'relative' }}>
        {imageMenuVisible || addImageMenuVisible ? (
          <Pressable
            onPress={closeMenus}
            style={{
              position: 'absolute',
              top: 0,
              right: 0,
              bottom: 0,
              left: 0,
              zIndex: 5,
            }}
          />
        ) : null}

        {hasGalleryImages ? (
          <View
            onLayout={(event) => {
              const nextWidth = Math.floor(event.nativeEvent.layout.width);
              if (nextWidth > 0 && nextWidth !== imageGalleryWidth) {
                setImageGalleryWidth(nextWidth);
              }
            }}
          >
            <ScrollView
              ref={imageGalleryRef}
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              scrollEventThrottle={16}
              onMomentumScrollEnd={(event) => {
                if (!imageGalleryWidth) return;
                const nextIndex = Math.round(event.nativeEvent.contentOffset.x / imageGalleryWidth);
                onChangeImageIndex?.(Math.min(Math.max(nextIndex, 0), galleryImages.length - 1));
              }}
              style={{ borderRadius: shapes.cornerLarge }}
            >
              {galleryImages.map((imagePath, index) => (
                <Pressable
                  key={`${imagePath}-${index}`}
                  onPress={onOpenImage}
                  testID="entity-overview-image"
                  accessibilityLabel={`${config.title} picture`}
                >
                  <Image
                    source={getImageSource(imagePath)}
                    style={{
                      width: imageGalleryWidth || '100%',
                      height: 200,
                      borderRadius: shapes.cornerLarge,
                    }}
                  />
                </Pressable>
              ))}
            </ScrollView>
          </View>
        ) : (
          <View
            style={{
              height: 200,
              borderRadius: shapes.cornerLarge,
              backgroundColor: surfaces.cardLow,
              alignItems: 'center',
              justifyContent: 'center',
              gap: spacing.sm,
            }}
          >
            <Icon source={config.icon} size={48} color={colors.onSurfaceVariant} />
            <Text style={{ color: colors.onSurfaceVariant }}>{`No ${config.title.toLowerCase()} picture`}</Text>
          </View>
        )}

        {canManageImage ? (
          <View
            style={{
              position: 'absolute',
              top: spacing.sm,
              right: spacing.sm,
              flexDirection: 'row',
              gap: spacing.xs,
              zIndex: 10,
            }}
          >
            <View
              style={{
                position: 'relative',
                ...(imageMenuVisible ? { width: 260, height: 210, alignItems: 'flex-end' } : null),
              }}
            >
              <IconButton
                icon={visibleImagePath ? 'image-edit-outline' : 'camera-plus-outline'}
                size={18}
                testID="entity-overview-image-menu-button"
                accessibilityLabel={visibleImagePath ? 'Edit picture' : 'Add picture'}
                onPress={() => {
                  setAddImageMenuVisible(false);
                  setImageMenuVisible((current) => !current);
                }}
                disabled={imageLoading}
                style={{ backgroundColor: surfaces.cardLow }}
              />
              {imageMenuVisible ? (
                <ActionPanel
                  actions={
                    visibleImagePath
                      ? [
                          {
                            key: 'replace-gallery',
                            label: 'Replace from Gallery',
                            icon: 'image',
                            onPress: onPickImage,
                          },
                          {
                            key: 'replace-camera',
                            label: 'Replace from Camera',
                            icon: 'camera',
                            onPress: onTakePhoto,
                          },
                          {
                            key: 'delete-image',
                            label: 'Delete Image',
                            icon: 'delete',
                            onPress: onDeleteImage,
                          },
                        ]
                      : [
                          {
                            key: 'add-gallery',
                            label: 'Add from Gallery',
                            icon: 'image',
                            onPress: onPickImage,
                          },
                          {
                            key: 'add-camera',
                            label: 'Add from Camera',
                            icon: 'camera',
                            onPress: onTakePhoto,
                          },
                        ]
                  }
                />
              ) : null}
            </View>

            {visibleImagePath && (onAddImageFromGallery || onAddImageFromCamera) ? (
              <View
                style={{
                  position: 'relative',
                  ...(addImageMenuVisible ? { width: 260, height: 160, alignItems: 'flex-end' } : null),
                }}
              >
                <IconButton
                  icon="camera-plus-outline"
                  size={18}
                  testID="entity-overview-add-image-menu-button"
                  accessibilityLabel="Add another picture"
                  onPress={() => {
                    if (onAddImagePress) {
                      closeMenus();
                      onAddImagePress();
                      return;
                    }
                    setImageMenuVisible(false);
                    setAddImageMenuVisible((current) => !current);
                  }}
                  disabled={imageLoading}
                  style={{ backgroundColor: surfaces.cardLow }}
                />
                {addImageMenuVisible && !onAddImagePress ? (
                  <ActionPanel
                    actions={[
                      {
                        key: 'extra-gallery',
                        label: 'Add from Gallery',
                        icon: 'image',
                        onPress: onAddImageFromGallery,
                      },
                      {
                        key: 'extra-camera',
                        label: 'Add from Camera',
                        icon: 'camera',
                        onPress: onAddImageFromCamera,
                      },
                    ].filter((action) => Boolean(action.onPress))}
                  />
                ) : null}
              </View>
            ) : null}
          </View>
        ) : null}

        {galleryImages.length > 1 ? (
          <View
            style={{
              position: 'absolute',
              bottom: spacing.sm,
              left: 0,
              right: 0,
              alignItems: 'center',
              gap: spacing.xs,
            }}
            pointerEvents="none"
          >
            <Surface
              elevation={0}
              style={{
                backgroundColor: surfaces.cardLow,
                borderRadius: shapes.cornerFull,
                paddingHorizontal: spacing.sm,
                paddingVertical: spacing.xs,
              }}
            >
              <Text variant="labelSmall" style={{ color: colors.onSurface }}>
                {`${visibleImageIndex + 1} / ${galleryImages.length}`}
              </Text>
            </Surface>
            <View style={{ flexDirection: 'row', gap: spacing.xs }}>
              {galleryImages.map((_, index) => (
                <View
                  key={`dot-${index}`}
                  style={{
                    width: index === visibleImageIndex ? 18 : 8,
                    height: 8,
                    borderRadius: shapes.cornerFull,
                    backgroundColor:
                      index === visibleImageIndex ? colors.primary : colors.outlineVariant,
                  }}
                />
              ))}
            </View>
          </View>
        ) : null}
      </View>

      {fields.map((field) => (
        <FieldRow key={field.label} label={field.label} value={field.value} />
      ))}

      {tags ? (
        <Surface
          style={{
            backgroundColor: surfaces.cardLow,
            borderRadius: shapes.cornerSmall,
            padding: spacing.lg,
            gap: spacing.sm,
          }}
        >
          <Text variant="bodySmall" style={{ color: colors.onSurfaceVariant }}>
            Tags
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
            {tags
              .split(',')
              .map((tag) => tag.trim())
              .filter(Boolean)
              .map((tag) => (
                <Chip key={tag} compact>
                  {tag}
                </Chip>
              ))}
          </View>
        </Surface>
      ) : null}

      {locationPath !== undefined ? (
        <FieldRow
          label="Location"
          value={locationPath || 'Unknown location'}
          onPress={onLocationPress}
        />
      ) : null}
    </>
  );

  const fieldValueMap = new Map(fields.map((field) => [field.label, field.value]));
  const descriptionValue = fieldValueMap.get('Description')?.trim() || '-';
  const locationValue = locationPath !== undefined ? locationPath || 'Unknown location' : '';
  const parsedTags = tags
    ? tags
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean)
    : [];
  const flatHeroImageHeight = 260;
  const flatSummaryTop = 220;
  const flatSummaryMarginBottom =
    Math.max(flatSummaryCardHeight - (flatHeroImageHeight - flatSummaryTop), 0) + spacing.lg;

  const roomOverviewBody = (
    <>
      <View style={{ position: 'relative', marginBottom: flatSummaryMarginBottom }}>
        {imageMenuVisible || addImageMenuVisible ? (
          <Pressable
            onPress={closeMenus}
            style={{
              position: 'absolute',
              top: 0,
              right: 0,
              bottom: 0,
              left: 0,
              zIndex: 5,
            }}
          />
        ) : null}

        {hasGalleryImages ? (
          <View
            onLayout={(event) => {
              const nextWidth = Math.floor(event.nativeEvent.layout.width);
              if (nextWidth > 0 && nextWidth !== imageGalleryWidth) {
                setImageGalleryWidth(nextWidth);
              }
            }}
          >
            <ScrollView
              ref={imageGalleryRef}
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              scrollEventThrottle={16}
              onMomentumScrollEnd={(event) => {
                if (!imageGalleryWidth) return;
                const nextIndex = Math.round(event.nativeEvent.contentOffset.x / imageGalleryWidth);
                onChangeImageIndex?.(Math.min(Math.max(nextIndex, 0), galleryImages.length - 1));
              }}
              style={{ borderRadius: shapes.cornerLarge }}
            >
              {galleryImages.map((imagePath, index) => (
                <Pressable
                  key={`${imagePath}-${index}`}
                  onPress={onOpenImage}
                  testID="entity-overview-image"
                  accessibilityLabel={`${config.title} picture`}
                >
                  <Image
                    source={getImageSource(imagePath)}
                    style={{
                      width: imageGalleryWidth || '100%',
                      height: flatHeroImageHeight,
                      borderRadius: shapes.cornerLarge,
                    }}
                    resizeMode="cover"
                  />
                </Pressable>
              ))}
            </ScrollView>
          </View>
        ) : (
          <View
            testID="entity-overview-no-image"
            style={{
              height: flatHeroImageHeight,
              borderRadius: shapes.cornerLarge,
              backgroundColor: surfaces.card,
              alignItems: 'center',
              justifyContent: 'center',
              gap: spacing.sm,
            }}
          >
            <Icon source={config.icon} size={52} color={colors.onSurfaceVariant} />
            <Text style={{ color: colors.onSurfaceVariant }}>{`No ${config.title.toLowerCase()} picture`}</Text>
          </View>
        )}

        {canManageImage ? (
          <View
            style={{
              position: 'absolute',
              top: spacing.sm,
              right: spacing.sm,
              flexDirection: 'row',
              gap: spacing.xs,
              zIndex: 10,
            }}
          >
            <View
              style={{
                position: 'relative',
                ...(imageMenuVisible ? { width: 260, height: 210, alignItems: 'flex-end' } : null),
              }}
            >
              <IconButton
                icon={visibleImagePath ? 'image-edit-outline' : 'camera-plus-outline'}
                size={18}
                testID="entity-overview-image-menu-button"
                accessibilityLabel={visibleImagePath ? 'Edit picture' : 'Add picture'}
                onPress={() => {
                  setAddImageMenuVisible(false);
                  setImageMenuVisible((current) => !current);
                }}
                disabled={imageLoading}
                style={{ backgroundColor: surfaces.cardLow }}
              />
              {imageMenuVisible ? (
                <ActionPanel
                  actions={
                    visibleImagePath
                      ? [
                          {
                            key: 'replace-gallery',
                            label: 'Replace from Gallery',
                            icon: 'image',
                            onPress: onPickImage,
                          },
                          {
                            key: 'replace-camera',
                            label: 'Replace from Camera',
                            icon: 'camera',
                            onPress: onTakePhoto,
                          },
                          {
                            key: 'delete-image',
                            label: 'Delete Image',
                            icon: 'delete',
                            onPress: onDeleteImage,
                          },
                        ]
                      : [
                          {
                            key: 'add-gallery',
                            label: 'Add from Gallery',
                            icon: 'image',
                            onPress: onPickImage,
                          },
                          {
                            key: 'add-camera',
                            label: 'Add from Camera',
                            icon: 'camera',
                            onPress: onTakePhoto,
                          },
                        ]
                  }
                />
              ) : null}
            </View>

            {visibleImagePath && (onAddImageFromGallery || onAddImageFromCamera) ? (
              <View
                style={{
                  position: 'relative',
                  ...(addImageMenuVisible ? { width: 260, height: 160, alignItems: 'flex-end' } : null),
                }}
              >
                <IconButton
                  icon="camera-plus-outline"
                  size={18}
                  testID="entity-overview-add-image-menu-button"
                  accessibilityLabel="Add another picture"
                  onPress={() => {
                    if (onAddImagePress) {
                      closeMenus();
                      onAddImagePress();
                      return;
                    }
                    setImageMenuVisible(false);
                    setAddImageMenuVisible((current) => !current);
                  }}
                  disabled={imageLoading}
                  style={{ backgroundColor: surfaces.cardLow }}
                />
                {addImageMenuVisible && !onAddImagePress ? (
                  <ActionPanel
                    actions={[
                      {
                        key: 'extra-gallery',
                        label: 'Add from Gallery',
                        icon: 'image',
                        onPress: onAddImageFromGallery,
                      },
                      {
                        key: 'extra-camera',
                        label: 'Add from Camera',
                        icon: 'camera',
                        onPress: onAddImageFromCamera,
                      },
                    ].filter((action) => Boolean(action.onPress))}
                  />
                ) : null}
              </View>
            ) : null}
          </View>
        ) : null}

        <Surface
          elevation={elevation.level2}
          onLayout={(event) => {
            const nextHeight = Math.ceil(event.nativeEvent.layout.height);
            if (nextHeight > 0 && nextHeight !== flatSummaryCardHeight) {
              setFlatSummaryCardHeight(nextHeight);
            }
          }}
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: flatSummaryTop,
            backgroundColor: surfaces.cardLow,
            borderRadius: shapes.cornerLarge,
            paddingHorizontal: spacing.xxl,
            paddingVertical: spacing.xxl,
            gap: spacing.lg,
          }}
        >
          <View style={{ gap: spacing.xs, minHeight: 46 }}>
            <Text variant="labelSmall" style={{ color: colors.onSurface }}>
              Description
            </Text>
            <Text variant="bodyMedium" numberOfLines={2} style={{ color: colors.onSurfaceVariant }}>
              {descriptionValue}
            </Text>
          </View>

          <Pressable
            disabled={!onLocationPress}
            onPress={onLocationPress}
            style={{ gap: spacing.xs, minHeight: 46 }}
          >
            <Text variant="labelSmall" style={{ color: colors.onSurface }}>
              Location
            </Text>
            <Text variant="bodyMedium" numberOfLines={2} style={{ color: colors.onSurfaceVariant }}>
              {locationValue || ' '}
            </Text>
          </Pressable>

          {parsedTags.length ? (
            <View style={{ gap: spacing.xs }}>
              <Text variant="labelSmall" style={{ color: colors.onSurface }}>
                Tags
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
                {parsedTags.slice(0, 2).map((tag) => (
                  <Chip key={tag} compact>
                    {tag}
                  </Chip>
                ))}
              </View>
            </View>
          ) : null}
        </Surface>

        {galleryImages.length > 1 ? (
          <View
            style={{
              position: 'absolute',
              bottom: spacing.giant + spacing.xxl,
              left: 0,
              right: 0,
              alignItems: 'center',
              gap: spacing.xs,
            }}
            pointerEvents="none"
          >
            <Surface
              elevation={0}
              style={{
                backgroundColor: surfaces.cardLow,
                borderRadius: shapes.cornerFull,
                paddingHorizontal: spacing.sm,
                paddingVertical: spacing.xs,
              }}
            >
              <Text variant="labelSmall" style={{ color: colors.onSurface }}>
                {`${visibleImageIndex + 1} / ${galleryImages.length}`}
              </Text>
            </Surface>
          </View>
        ) : null}
      </View>

    </>
  );

  return (
    <ScrollView
      contentContainerStyle={{ padding: spacing.xxl, gap: spacing.lg }}
      refreshControl={
        onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} /> : undefined
      }
    >
      {isFlatOverview ? (
        roomOverviewBody
      ) : (
        <Surface
          style={{
            backgroundColor: surfaces.card,
            borderRadius: shapes.cornerLarge,
            padding: spacing.xxl,
            gap: spacing.lg,
          }}
          elevation={elevation.level1}
        >
          {overviewBody}
        </Surface>
      )}

      {extraSection}

      {visibleSections.map((section) => {
        const isCollapsed = Boolean(collapsedSections[section.type]);

        if (isFlatOverview) {
          return (
            <View key={section.type} style={{ gap: spacing.md }}>
              <Text variant="labelMedium" style={{ color: colors.onSurface }}>
                {`${section.label} (${section.items.length})`}
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md }}>
                {section.items.map((child) => (
                  <Pressable
                    key={child.id}
                    onPress={() => section.onPressItem(child.id)}
                    style={{
                      width: compactTileWidth,
                    }}
                  >
                    <Surface
                      elevation={elevation.level2}
                      style={{
                        backgroundColor: surfaces.cardLow,
                        borderRadius: shapes.cornerLarge,
                        paddingHorizontal: spacing.lg,
                        paddingVertical: spacing.lg,
                        minHeight: 88,
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: spacing.md,
                      }}
                    >
                      <View
                        style={{
                          width: 44,
                          height: 44,
                          borderRadius: shapes.cornerFull,
                          backgroundColor: colors.primaryContainer,
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        <Icon source={section.icon} size={20} color={colors.onPrimaryContainer} />
                      </View>
                      <View style={{ flex: 1, gap: spacing.xxs }}>
                        <Text variant="titleSmall" numberOfLines={2} style={{ color: colors.onSurface }}>
                          {child.name}
                        </Text>
                        {child.description ? (
                          <Text variant="bodySmall" numberOfLines={2} style={{ color: colors.onSurfaceVariant }}>
                            {child.description}
                          </Text>
                        ) : null}
                      </View>
                      <Icon source="chevron-right" size={20} color={colors.onSurfaceVariant} />
                    </Surface>
                  </Pressable>
                ))}
              </View>
            </View>
          );
        }

        return (
          <Surface
            key={section.type}
            style={{
              backgroundColor: surfaces.card,
              borderRadius: shapes.cornerLarge,
              padding: spacing.xxl,
              gap: spacing.md,
            }}
            elevation={elevation.level1}
          >
            <SectionHeader
              title={section.label}
              count={section.items.length}
              isCollapsed={isCollapsed}
              onToggle={() =>
                setCollapsedSections((prev) => ({
                  ...prev,
                  [section.type]: !prev[section.type],
                }))
              }
            />

            {!isCollapsed
              ? section.items.map((child) => (
                  <Surface
                    key={child.id}
                    style={{
                      backgroundColor: surfaces.cardLow,
                      borderRadius: shapes.cornerSmall,
                      overflow: 'hidden',
                    }}
                  >
                    <List.Item
                      title={child.name}
                      description={
                        child.description
                          ? () => <Text variant="bodySmall">{child.description}</Text>
                          : undefined
                      }
                      onPress={() => section.onPressItem(child.id)}
                      left={(props) => <List.Icon {...props} icon={section.icon} />}
                      right={
                        section.type === 'item'
                          ? undefined
                          : (props) => <List.Icon {...props} icon="chevron-right" />
                      }
                    />
                  </Surface>
                ))
              : null}
          </Surface>
        );
      })}
    </ScrollView>
  );
}
