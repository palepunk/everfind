import React, { useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';
import type { AlertButton, AlertOptions } from 'react-native';
import { Button, Dialog, Portal, Text, useTheme } from 'react-native-paper';

import type { AppTheme } from '@/utils/theme/theme';

type AlertRequest = {
  title: string;
  message?: string;
  buttons?: AlertButton[];
  options?: AlertOptions;
};

const normalizeButtons = (buttons?: AlertButton[]) => {
  if (buttons && buttons.length > 0) {
    return buttons;
  }
  return [{ text: 'OK' }] satisfies AlertButton[];
};

const hasDestructiveButton = (buttons?: AlertButton[]) =>
  Boolean(buttons?.some((button) => button.style === 'destructive'));

export function AppAlertHost() {
  const theme = useTheme<AppTheme>();
  const { colors, custom } = theme;
  const { shapes } = custom;
  const queueRef = useRef<AlertRequest[]>([]);
  const originalAlertRef = useRef(Alert.alert);
  const [currentAlert, setCurrentAlert] = useState<AlertRequest | null>(null);

  useEffect(() => {
    const originalAlert = originalAlertRef.current;

    const showNextAlert = () => {
      setCurrentAlert((existing) => {
        if (existing) return existing;
        const next = queueRef.current.shift() ?? null;
        return next;
      });
    };

    Alert.alert = (title, message, buttons, options) => {
      if (hasDestructiveButton(buttons)) {
        originalAlert(title, message, buttons, options);
        return;
      }

      queueRef.current.push({ title, message, buttons, options });
      showNextAlert();
    };

    return () => {
      Alert.alert = originalAlert;
    };
  }, []);

  const closeCurrentAlert = () => {
    setCurrentAlert(queueRef.current.shift() ?? null);
  };

  const handleDismiss = () => {
    if (!currentAlert) return;
    if (currentAlert.options?.cancelable === false) return;
    currentAlert.options?.onDismiss?.();
    closeCurrentAlert();
  };

  const handlePressButton = (button?: AlertButton) => {
    closeCurrentAlert();
    button?.onPress?.();
  };

  const buttons = normalizeButtons(currentAlert?.buttons);

  return (
    <Portal>
      <Dialog
        visible={Boolean(currentAlert)}
        onDismiss={handleDismiss}
        dismissable={currentAlert?.options?.cancelable !== false}
        style={{ borderRadius: shapes.cornerLarge }}
      >
        <Dialog.Title>{currentAlert?.title ?? ''}</Dialog.Title>
        {currentAlert?.message ? (
          <Dialog.Content>
            <Text>{currentAlert.message}</Text>
          </Dialog.Content>
        ) : null}
        <Dialog.Actions>
          {buttons.map((button, index) => (
            <Button
              key={`${button.text ?? 'button'}-${index}`}
              onPress={() => handlePressButton(button)}
              textColor={button.style === 'cancel' ? colors.onSurfaceVariant : undefined}
            >
              {button.text ?? 'OK'}
            </Button>
          ))}
        </Dialog.Actions>
      </Dialog>
    </Portal>
  );
}
