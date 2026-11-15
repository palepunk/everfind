import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Image,
  Platform,
  KeyboardAvoidingView,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  TouchableWithoutFeedback,
} from 'react-native';
import {
  Button,
  Icon,
  Menu,
  RadioButton,
  Surface,
  SegmentedButtons,
  Text,
  TextInput,
  useTheme,
} from 'react-native-paper';
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';

import { getImageSource, isPlatformSupported } from '@/utils/imageUtils';
import type { AppTheme } from '@/utils/theme/theme';
import { useCurrencyPreference } from '@/utils/currency';
import type { EntityConfig, EntityType } from './entity.types';

type EntityFormProps<T> = {
  config: EntityConfig<T>;
  values: Record<string, string>;
  onChangeField: (key: keyof T, value: string) => void;
  contextualLocationLabel?: string;
  houseSelectionMode?: 'none' | 'readonly' | 'select';
  houseOptions?: { id: string; name: string }[];
  houseId?: string;
  houseLabel?: string;
  onHouseChange?: (id: string) => void;
  parentTypes: EntityType[];
  parentType: EntityType | '';
  onParentTypeChange: (type: EntityType | '') => void;
  parentOptions: Partial<Record<EntityType, { id: string; name: string; location?: string }[]>>;
  parentId: string;
  onParentIdChange: (id: string) => void;
  imagePath: string | null;
  onPickImage: () => Promise<void> | void;
  onTakePhoto: () => Promise<void> | void;
  onDeleteImage: () => Promise<void> | void;
  imagePaths?: string[];
  currentImageIndex?: number;
  onChangeImageIndex?: (index: number) => void;
  onAddImageFromGallery?: () => Promise<void> | void;
  onAddImageFromCamera?: () => Promise<void> | void;
  imageLoading: boolean;
  bottomInset?: number;
};

export function EntityForm<T>(props: EntityFormProps<T>) {
  const {
    config,
    values,
    onChangeField,
    contextualLocationLabel,
    houseSelectionMode = 'none',
    houseOptions = [],
    houseId = '',
    houseLabel = '',
    onHouseChange,
    parentTypes,
    parentType,
    onParentTypeChange,
    parentOptions,
    parentId,
    onParentIdChange,
    imagePath,
    onPickImage,
    onTakePhoto,
    onDeleteImage,
    imagePaths,
    currentImageIndex = 0,
    onChangeImageIndex,
    onAddImageFromGallery,
    onAddImageFromCamera,
    imageLoading,
    bottomInset = 0,
  } = props;

  const { colors, custom } = useTheme<AppTheme>();
  const { spacing, shapes, elevation, surfaces } = custom;
  const { currency } = useCurrencyPreference();

  const [replaceMenuVisible, setReplaceMenuVisible] = useState(false);
  const [addMenuVisible, setAddMenuVisible] = useState(false);
  const [galleryWidth, setGalleryWidth] = useState(0);
  const galleryRef = useRef<ScrollView | null>(null);

  const fieldLabel = (label: string, optional?: boolean) =>
    optional ? `${label} (optional)` : label;

  const showHouseField = houseSelectionMode !== 'none';
  const handleHouseChange = onHouseChange ?? (() => {});
  const galleryImages = imagePaths && imagePaths.length > 0 ? imagePaths : imagePath ? [imagePath] : [];
  const visibleImageIndex = Math.min(Math.max(currentImageIndex, 0), Math.max(galleryImages.length - 1, 0));
  const supportsMultipleImages = Boolean(imagePaths);

  const openReplaceMenu = () => {
    setAddMenuVisible(false);
    setReplaceMenuVisible(true);
  };

  const openAddMenu = () => {
    setReplaceMenuVisible(false);
    setAddMenuVisible(true);
  };

  const openEmptyPhotoMenu = () => {
    setReplaceMenuVisible(false);
    setAddMenuVisible(true);
  };

  const closePhotoMenus = () => {
    setReplaceMenuVisible(false);
    setAddMenuVisible(false);
  };

  useEffect(() => {
    if (!galleryImages.length || galleryWidth <= 0) return;
    galleryRef.current?.scrollTo({ x: visibleImageIndex * galleryWidth, animated: false });
  }, [galleryImages.length, galleryWidth, visibleImageIndex]);

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <KeyboardAwareScrollView
        enableOnAndroid
        extraScrollHeight={24}
        keyboardOpeningTime={0}
        contentContainerStyle={{ padding: spacing.xxl, paddingBottom: spacing.xxl + bottomInset }}
      >
        <Surface
          style={{
            backgroundColor: surfaces.card,
            borderRadius: shapes.cornerLarge,
            padding: spacing.xxl,
            gap: spacing.lg,
          }}
          elevation={elevation.level1}
        >
          {/* Image */}
          {galleryImages.length > 0 ? (
            <View style={{ gap: spacing.sm, marginHorizontal: -spacing.xxl, marginTop: -spacing.xxl }}>
              <View
                onLayout={(event) => {
                  const nextWidth = Math.floor(event.nativeEvent.layout.width);
                  if (nextWidth > 0 && nextWidth !== galleryWidth) {
                    setGalleryWidth(nextWidth);
                  }
                }}
              >
                <ScrollView
                  ref={galleryRef}
                  horizontal
                  pagingEnabled
                  nestedScrollEnabled
                  directionalLockEnabled
                  showsHorizontalScrollIndicator={false}
                  scrollEventThrottle={16}
                  onMomentumScrollEnd={(event) => {
                    if (!galleryWidth) return;
                    const nextIndex = Math.round(event.nativeEvent.contentOffset.x / galleryWidth);
                    onChangeImageIndex?.(Math.min(Math.max(nextIndex, 0), galleryImages.length - 1));
                  }}
                  style={{ borderRadius: shapes.cornerLarge }}
                >
                  {galleryImages.map((currentImagePath, index) => (
                    <Image
                      key={`${currentImagePath}-${index}`}
                      testID="entity-form-image"
                      accessibilityLabel={`${config.title} form picture`}
                      source={getImageSource(currentImagePath)}
                      style={{
                        width: galleryWidth || '100%',
                        height: 200,
                        borderRadius: shapes.cornerLarge,
                      }}
                      resizeMode="cover"
                    />
                  ))}
                </ScrollView>
              </View>

              {supportsMultipleImages && galleryImages.length > 1 ? (
                <Text
                  variant="bodySmall"
                  style={{ color: colors.onSurfaceVariant, textAlign: 'center', paddingHorizontal: spacing.xxl }}
                >
                  {`${visibleImageIndex + 1} / ${galleryImages.length}`}
                </Text>
              ) : null}

              <View style={{ flexDirection: 'row', gap: spacing.md, paddingHorizontal: spacing.xxl }}>
                <Button
                  mode="text"
                  onPress={onDeleteImage}
                  disabled={imageLoading}
                  testID="entity-delete-photo-button"
                  style={{ flex: 1 }}
                >
                  Delete
                </Button>

                <Menu
                  visible={replaceMenuVisible}
                  onDismiss={() => setReplaceMenuVisible(false)}
                  anchor={
                    <Button
                      mode="text"
                      onPress={openReplaceMenu}
                      disabled={imageLoading}
                      testID="entity-replace-photo-button"
                      style={{ flex: 1 }}
                    >
                      Replace
                    </Button>
                  }
                >
                  <Menu.Item
                    onPress={async () => {
                      await onPickImage();
                      setReplaceMenuVisible(false);
                    }}
                    title="From Gallery"
                    testID="entity-photo-menu-gallery"
                    leadingIcon="image"
                  />
                  <Menu.Item
                    onPress={async () => {
                      await onTakePhoto();
                      setReplaceMenuVisible(false);
                    }}
                    title="Take Photo"
                    testID="entity-photo-menu-camera"
                    leadingIcon="camera"
                  />
                </Menu>

                {supportsMultipleImages && (onAddImageFromGallery || onAddImageFromCamera) ? (
                  <Menu
                    visible={addMenuVisible}
                    onDismiss={() => setAddMenuVisible(false)}
                    anchor={
                      <Button
                        mode="text"
                        onPress={openAddMenu}
                        disabled={imageLoading}
                        style={{ flex: 1 }}
                      >
                        Add
                      </Button>
                    }
                  >
                    {onAddImageFromGallery ? (
                      <Menu.Item
                        onPress={async () => {
                          await onAddImageFromGallery();
                          setAddMenuVisible(false);
                        }}
                        title="From Gallery"
                        testID="entity-photo-menu-gallery"
                        leadingIcon="image"
                      />
                    ) : null}
                    {onAddImageFromCamera ? (
                      <Menu.Item
                        onPress={async () => {
                          await onAddImageFromCamera();
                          setAddMenuVisible(false);
                        }}
                        title="Take Photo"
                        testID="entity-photo-menu-camera"
                        leadingIcon="camera"
                      />
                    ) : null}
                  </Menu>
                ) : null}
              </View>
            </View>
          ) : (
            <View style={{ gap: spacing.sm, marginHorizontal: -spacing.xxl, marginTop: -spacing.xxl }}>
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
                <Text style={{ color: colors.onSurfaceVariant }}>{`${config.title} picture`}</Text>
              </View>

              {isPlatformSupported() ? (
                <View style={{ marginHorizontal: spacing.xxl }}>
                  <Button
                    mode="text"
                    onPress={openEmptyPhotoMenu}
                    disabled={imageLoading}
                    testID="entity-add-photo-button"
                    accessibilityLabel="Add Photo"
                  >
                    Add Photo
                  </Button>
                  <Modal
                    visible={addMenuVisible}
                    transparent
                    animationType="fade"
                    onRequestClose={() => setAddMenuVisible(false)}
                  >
                    <View style={styles.photoMenuModal}>
                      <Pressable
                        testID="entity-photo-menu-backdrop"
                        accessibilityRole="button"
                        accessibilityLabel="Dismiss photo source menu"
                        onPress={() => setAddMenuVisible(false)}
                        style={StyleSheet.absoluteFill}
                      />
                      <TouchableWithoutFeedback>
                        <Surface
                          testID="entity-photo-source-menu"
                          elevation={elevation.level2}
                          style={{
                            minWidth: 240,
                            borderRadius: shapes.cornerSmall,
                            backgroundColor: surfaces.card,
                            overflow: 'hidden',
                          }}
                        >
                          <Pressable
                            testID="entity-photo-menu-gallery"
                            accessibilityRole="button"
                            accessibilityLabel="From Gallery"
                            onPress={async () => {
                              setAddMenuVisible(false);
                              await onPickImage();
                            }}
                            style={({ pressed }) => ({
                              paddingHorizontal: spacing.lg,
                              paddingVertical: spacing.md,
                              opacity: pressed ? 0.72 : 1,
                            })}
                          >
                            <Text style={{ color: colors.onSurface }}>From Gallery</Text>
                          </Pressable>
                          <Pressable
                            testID="entity-photo-menu-camera"
                            accessibilityRole="button"
                            accessibilityLabel="Take Photo"
                            onPress={async () => {
                              setAddMenuVisible(false);
                              await onTakePhoto();
                            }}
                            style={({ pressed }) => ({
                              paddingHorizontal: spacing.lg,
                              paddingVertical: spacing.md,
                              opacity: pressed ? 0.72 : 1,
                            })}
                          >
                            <Text style={{ color: colors.onSurface }}>Take Photo</Text>
                          </Pressable>
                        </Surface>
                      </TouchableWithoutFeedback>
                    </View>
                  </Modal>
                </View>
              ) : (
                <Text
                  variant="bodySmall"
                  style={{ color: colors.onSurfaceVariant, textAlign: 'center', paddingHorizontal: spacing.xxl }}
                >
                  Image upload not supported on this platform
                </Text>
              )}
            </View>
          )}

          {/* Fields */}
          {config.fields.map((field) => {
            const keyName = String(field.key);
            const isMultiline = keyName.toLowerCase().includes('description') || keyName.toLowerCase().includes('notes');
            const isPriceField = keyName === 'purchasePrice';
            const label = isPriceField ? `${field.label} (${currency})` : fieldLabel(field.label, field.optional);
            return (
              <TextInput
                key={String(field.key)}
                testID={`entity-field-${config.type}-${keyName}`}
                label={label}
                value={values[String(field.key)] ?? ''}
                onChangeText={(text) => onChangeField(field.key, text)}
                mode="outlined"
                multiline={isMultiline}
                numberOfLines={isMultiline ? 3 : 1}
                keyboardType={isPriceField ? 'decimal-pad' : undefined}
                onFocus={closePhotoMenus}
              />
            );
          })}

          {contextualLocationLabel ? (
            <TextInput
              label="Location"
              value={contextualLocationLabel}
              mode="outlined"
              editable={false}
            />
          ) : null}

          {/* House */}
          {showHouseField ? (
            <View style={{ gap: spacing.sm }}>
              <Text variant="titleMedium" style={{ color: colors.onSurface }}>
                {houseSelectionMode === 'select' ? 'House (required)' : 'House'}
              </Text>

              {houseSelectionMode === 'select' ? (
                houseOptions.length > 0 ? (
                  <RadioButton.Group value={houseId} onValueChange={handleHouseChange}>
                    {houseOptions.map((house) => (
                      <RadioButton.Item
                        key={house.id}
                        label={house.name}
                        value={house.id}
                        testID={`entity-house-option-${house.name.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || house.id}`}
                      />
                    ))}
                  </RadioButton.Group>
                ) : (
                  <Text style={{ color: colors.onSurfaceVariant }}>No houses available</Text>
                )
              ) : (
                <TextInput
                  label="House"
                  value={houseLabel}
                  mode="outlined"
                  editable={false}
                />
              )}
            </View>
          ) : null}

          {/* Parent */}
          {parentTypes.length > 0 ? (
            <View style={{ gap: spacing.sm }}>
              <Text variant="titleMedium" style={{ color: colors.onSurface }}>
                {config.parent?.required ? 'Parent' : 'Parent (optional)'}
              </Text>

              <SegmentedButtons
                value={parentType}
                onValueChange={(value) => {
                  onParentTypeChange(value as EntityType);
                  onParentIdChange('');
                }}
                buttons={parentTypes.map((type) => ({
                  value: type,
                  label: type.charAt(0).toUpperCase() + type.slice(1),
                }))}
              />

              {parentType !== '' && parentOptions[parentType] ? (
                <RadioButton.Group value={parentId} onValueChange={onParentIdChange}>
                  {parentOptions[parentType].map((p) => (
                    <Pressable
                      key={p.id}
                      onPress={() => onParentIdChange(p.id)}
                      accessibilityLabel={`Select parent ${p.name}`}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        paddingVertical: spacing.sm,
                      }}
                    >
                      <RadioButton value={p.id} />
                      <View style={{ flex: 1 }}>
                        <Text variant="bodyLarge">{p.name}</Text>
                        {p.location ? (
                          <Text variant="bodySmall" style={{ color: colors.onSurfaceVariant }}>
                            {p.location}
                          </Text>
                        ) : null}
                      </View>
                    </Pressable>
                  ))}
                </RadioButton.Group>
              ) : null}
            </View>
          ) : null}
        </Surface>

        {/* Optional bottom helper spacing */}
        <View style={{ height: spacing.lg + bottomInset }} />
      </KeyboardAwareScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  photoMenuModal: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    backgroundColor: 'transparent',
    justifyContent: 'center',
  },
});
