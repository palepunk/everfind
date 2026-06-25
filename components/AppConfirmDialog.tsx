import React from 'react';
import { Button, Dialog, Portal, Text, useTheme } from 'react-native-paper';

import type { AppTheme } from '@/utils/theme/theme';

type AppConfirmDialogProps = {
  visible: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  loading?: boolean;
  testID?: string;
  onCancel: () => void;
  onConfirm: () => void;
};

export function AppConfirmDialog({
  visible,
  title,
  message,
  confirmLabel = 'OK',
  cancelLabel = 'Cancel',
  destructive = false,
  loading = false,
  testID,
  onCancel,
  onConfirm,
}: AppConfirmDialogProps) {
  const theme = useTheme<AppTheme>();
  const { colors, custom } = theme;
  const { shapes } = custom;

  return (
    <Portal>
      <Dialog
        testID={testID}
        visible={visible}
        onDismiss={loading ? undefined : onCancel}
        style={{ borderRadius: shapes.cornerLarge }}
      >
        <Dialog.Title>{title}</Dialog.Title>
        <Dialog.Content>
          <Text>{message}</Text>
        </Dialog.Content>
        <Dialog.Actions>
          <Button onPress={onCancel} disabled={loading} testID={testID ? `${testID}-cancel-button` : undefined}>
            {cancelLabel}
          </Button>
          <Button
            onPress={onConfirm}
            loading={loading}
            disabled={loading}
            textColor={destructive ? colors.error : undefined}
            testID={testID ? `${testID}-confirm-button` : undefined}
          >
            {confirmLabel}
          </Button>
        </Dialog.Actions>
      </Dialog>
    </Portal>
  );
}
