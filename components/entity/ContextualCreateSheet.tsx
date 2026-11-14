import React from 'react';
import { View } from 'react-native';
import { BottomSheetModal } from '@gorhom/bottom-sheet';
import { IconButton, PaperProvider, Surface, Text, useTheme } from 'react-native-paper';

import { useSheetChrome } from '@/components/sheets/SheetKit';
import type { AppTheme } from '@/utils/theme/theme';
import { EntityForm } from './EntityForm';
import type { EntityConfig, EntityType } from './entity.types';

type ParentOptions = Partial<Record<EntityType, { id: string; name: string; location?: string }[]>>;

type ContextualCreateSheetProps = {
  sheetRef: React.RefObject<BottomSheetModal | null>;
  snapPoints: string[];
  onChangeIndex: (index: number) => void;
  onDismiss: () => void;
  backdropComponent: (props: any) => React.ReactElement;
  config: EntityConfig<any> | null;
  values: Record<string, string>;
  onChangeField: (key: string, value: string) => void;
  contextualLocationLabel?: string;
  parentType: EntityType | '';
  onParentTypeChange: (type: EntityType | '') => void;
  parentOptions: ParentOptions;
  parentId: string;
  onParentIdChange: (id: string) => void;
  imagePath: string | null;
  imagePaths?: string[];
  currentImageIndex?: number;
  onChangeImageIndex?: (index: number) => void;
  onPickImage: () => Promise<void> | void;
  onTakePhoto: () => Promise<void> | void;
  onDeleteImage: () => Promise<void> | void;
  onAddImageFromGallery?: () => Promise<void> | void;
  onAddImageFromCamera?: () => Promise<void> | void;
  imageLoading: boolean;
  bottomInset: number;
  saving: boolean;
  errorMessage?: string | null;
  onClose: () => void;
  onSave: () => void;
};

export const ContextualCreateSheet = React.memo(function ContextualCreateSheet(
  props: ContextualCreateSheetProps
) {
  const {
    sheetRef,
    snapPoints,
    onChangeIndex,
    onDismiss,
    backdropComponent,
    config,
    values,
    onChangeField,
    contextualLocationLabel,
    parentType,
    onParentTypeChange,
    parentOptions,
    parentId,
    onParentIdChange,
    imagePath,
    imagePaths,
    currentImageIndex,
    onChangeImageIndex,
    onPickImage,
    onTakePhoto,
    onDeleteImage,
    onAddImageFromGallery,
    onAddImageFromCamera,
    imageLoading,
    bottomInset,
    saving,
    errorMessage,
    onClose,
    onSave,
  } = props;

  const theme = useTheme<AppTheme>();
  const { colors, custom } = theme;
  const { spacing } = custom;
  const sheetChrome = useSheetChrome();

  return (
    <BottomSheetModal
      ref={sheetRef}
      snapPoints={snapPoints}
      animateOnMount
      enableDynamicSizing={false}
      enablePanDownToClose
      enableContentPanningGesture={false}
      onChange={onChangeIndex}
      onDismiss={onDismiss}
      backdropComponent={backdropComponent}
      keyboardBehavior="interactive"
      keyboardBlurBehavior="restore"
      android_keyboardInputMode="adjustResize"
      {...sheetChrome.modalProps}
    >
      <PaperProvider theme={theme}>
        <View style={{ flex: 1, backgroundColor: colors.surface }}>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingHorizontal: spacing.md,
              paddingBottom: spacing.sm,
            }}
          >
            <IconButton
              icon="close"
              onPress={onClose}
              disabled={saving}
              accessibilityLabel="Close create sheet"
              testID={config ? `contextual-create-close-${config.type}-button` : 'contextual-create-close-button'}
            />
            <Text variant="titleMedium" style={{ color: colors.onSurface, fontWeight: '600' }}>
              {config ? `New ${config.title}` : 'New record'}
            </Text>
            <IconButton
              icon="check"
              onPress={onSave}
              disabled={saving || !config}
              accessibilityLabel={config ? `Save ${config.title}` : 'Save record'}
              testID={config ? `contextual-create-save-${config.type}-button` : 'contextual-create-save-button'}
            />
          </View>
          {errorMessage ? (
            <Surface
              testID="contextual-create-error"
              accessibilityRole="alert"
              elevation={0}
              style={{
                marginHorizontal: spacing.xxl,
                marginBottom: spacing.sm,
                padding: spacing.md,
                borderRadius: 12,
                backgroundColor: colors.errorContainer,
              }}
            >
              <Text style={{ color: colors.onErrorContainer }}>{errorMessage}</Text>
            </Surface>
          ) : null}
          <View style={{ flex: 1 }}>
            {config ? (
              <EntityForm
                config={config}
                values={values}
                onChangeField={(key, value) => onChangeField(String(key), value)}
                contextualLocationLabel={contextualLocationLabel}
                houseSelectionMode="none"
                parentTypes={[]}
                parentType={parentType}
                onParentTypeChange={onParentTypeChange}
                parentOptions={parentOptions}
                parentId={parentId}
                onParentIdChange={onParentIdChange}
                imagePath={imagePath}
                imagePaths={imagePaths}
                currentImageIndex={currentImageIndex}
                onChangeImageIndex={onChangeImageIndex}
                onPickImage={onPickImage}
                onTakePhoto={onTakePhoto}
                onDeleteImage={onDeleteImage}
                onAddImageFromGallery={onAddImageFromGallery}
                onAddImageFromCamera={onAddImageFromCamera}
                imageLoading={imageLoading}
                bottomInset={bottomInset}
              />
            ) : null}
          </View>
        </View>
      </PaperProvider>
    </BottomSheetModal>
  );
});
