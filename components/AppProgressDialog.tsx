import React from 'react';
import { View } from 'react-native';
import { ActivityIndicator, Dialog, Portal, Text, useTheme } from 'react-native-paper';

import type { AppTheme } from '@/utils/theme/theme';

type AppProgressDialogProps = {
  visible: boolean;
  title?: string;
  message: string;
};

export function AppProgressDialog({
  visible,
  title = 'Syncing',
  message,
}: AppProgressDialogProps) {
  const theme = useTheme<AppTheme>();
  const { custom } = theme;
  const { shapes, spacing } = custom;

  return (
    <Portal>
      <Dialog dismissable={false} visible={visible} style={{ borderRadius: shapes.cornerLarge }}>
        <Dialog.Title>{title}</Dialog.Title>
        <Dialog.Content
          style={{
            paddingTop: spacing.sm,
            paddingBottom: spacing.md,
          }}
        >
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: spacing.md,
            }}
          >
            <ActivityIndicator size="small" />
            <Text variant="bodyMedium">{message}</Text>
          </View>
        </Dialog.Content>
      </Dialog>
    </Portal>
  );
}
