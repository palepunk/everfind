import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Modal, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import { Appbar, IconButton } from 'react-native-paper';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import * as FileSystem from 'expo-file-system/legacy';
import { getImageSource, isImagePathInPermanentDir, toAbsoluteImagePath } from '../../utils/imageUtils';
import { useAnalytics } from '../../utils/analytics/AnalyticsProvider';

interface FullScreenImageViewerProps {
  visible: boolean;
  imagePath: string | null;
  imagePaths?: string[];
  initialIndex?: number;
  onIndexChange?: (index: number) => void;
  onClose: () => void;
}

interface ZoomableImageProps {
  imagePath: string;
  width: number;
  height: number;
  onClose: () => void;
  isZoomed: boolean;
  onZoomChange: (isZoomed: boolean) => void;
}

function ZoomableImage({ imagePath, width, height, onClose, isZoomed, onZoomChange }: ZoomableImageProps) {
  const imageHeight = Math.max(1, height - 48);
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedTranslateX = useSharedValue(0);
  const savedTranslateY = useSharedValue(0);

  useEffect(() => {
    scale.value = 1;
    savedScale.value = 1;
    translateX.value = 0;
    translateY.value = 0;
    savedTranslateX.value = 0;
    savedTranslateY.value = 0;
    onZoomChange(false);
  }, [imagePath, onZoomChange, savedScale, savedTranslateX, savedTranslateY, scale, translateX, translateY]);

  const clampOffset = (value: number, scaledSize: number, viewportSize: number) => {
    'worklet';
    const maxOffset = Math.max(0, (scaledSize - viewportSize) / 2);
    return Math.min(Math.max(value, -maxOffset), maxOffset);
  };

  const pinch = Gesture.Pinch()
    .onUpdate((event) => {
      const nextScale = Math.min(Math.max(savedScale.value * event.scale, 1), 4);
      scale.value = nextScale;
      translateX.value = clampOffset(savedTranslateX.value, width * nextScale, width);
      translateY.value = clampOffset(savedTranslateY.value, height * nextScale, height);
    })
    .onEnd(() => {
      savedScale.value = scale.value;
      savedTranslateX.value = translateX.value;
      savedTranslateY.value = translateY.value;
      runOnJS(onZoomChange)(scale.value > 1.01);
    });

  const pan = Gesture.Pan()
    .enabled(isZoomed)
    .minDistance(8)
    .onUpdate((event) => {
      if (scale.value <= 1) return;
      translateX.value = clampOffset(savedTranslateX.value + event.translationX, width * scale.value, width);
      translateY.value = clampOffset(savedTranslateY.value + event.translationY, height * scale.value, height);
    })
    .onEnd(() => {
      savedTranslateX.value = translateX.value;
      savedTranslateY.value = translateY.value;
    });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      const nextScale = scale.value > 1 ? 1 : 2;
      scale.value = withTiming(nextScale);
      savedScale.value = nextScale;
      translateX.value = withTiming(0);
      translateY.value = withTiming(0);
      savedTranslateX.value = 0;
      savedTranslateY.value = 0;
      runOnJS(onZoomChange)(nextScale > 1.01);
    });

  const singleTap = Gesture.Tap()
    .numberOfTaps(1)
    .maxDuration(220)
    .onEnd(() => {
      runOnJS(onClose)();
    });

  const gesture = Gesture.Simultaneous(pinch, pan, Gesture.Exclusive(doubleTap, singleTap));
  const animatedImageStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  return (
    <GestureDetector gesture={gesture}>
      <View style={[styles.imagePage, { width, height }]}>
        <Animated.Image
          source={getImageSource(imagePath)}
          style={[styles.image, { width, height: imageHeight }, animatedImageStyle]}
          resizeMode="contain"
          onError={() => console.log('Error loading full image')}
        />
      </View>
    </GestureDetector>
  );
}

export default function FullScreenImageViewer({
  visible,
  imagePath,
  imagePaths,
  initialIndex = 0,
  onIndexChange,
  onClose,
}: FullScreenImageViewerProps) {
  const galleryPaths = useMemo(() => {
    const paths = imagePaths?.filter(Boolean) ?? [];
    if (paths.length > 0) return paths;
    return imagePath ? [imagePath] : [];
  }, [imagePath, imagePaths]);
  const shouldRender = Boolean(galleryPaths.length && visible);
  const clampedInitialIndex = Math.min(Math.max(initialIndex, 0), Math.max(galleryPaths.length - 1, 0));
  const [currentIndex, setCurrentIndex] = useState(clampedInitialIndex);
  const [isZoomed, setIsZoomed] = useState(false);
  const [fileExists, setFileExists] = useState<boolean | null>(null);
  const listRef = useRef<FlatList<string>>(null);
  const { width, height } = useWindowDimensions();
  const { authBetaEnabled } = useAnalytics();
  const currentImagePath = galleryPaths[currentIndex] ?? imagePath;

  useEffect(() => {
    if (!visible) return;
    setCurrentIndex(clampedInitialIndex);
    setIsZoomed(false);
    requestAnimationFrame(() => {
      listRef.current?.scrollToIndex({ index: clampedInitialIndex, animated: false });
    });
  }, [clampedInitialIndex, visible]);

  useEffect(() => {
    if (!shouldRender || !currentImagePath) {
      setFileExists(null);
      return;
    }
    let isActive = true;
    const checkFile = async () => {
      try {
        const info = await FileSystem.getInfoAsync(toAbsoluteImagePath(currentImagePath));
        if (isActive) setFileExists(Boolean(info.exists));
      } catch {
        if (isActive) setFileExists(false);
      }
    };

    checkFile();
    return () => {
      isActive = false;
    };
  }, [currentImagePath, shouldRender]);

  const handleMomentumScrollEnd = (offsetX: number) => {
    const nextIndex = Math.min(Math.max(Math.round(offsetX / width), 0), galleryPaths.length - 1);
    setCurrentIndex(nextIndex);
    onIndexChange?.(nextIndex);
  };

  if (!shouldRender || !currentImagePath) return null;

  return (
    <Modal
      visible={visible}
      transparent={false}
      onRequestClose={onClose}
      animationType="fade"
    >
      <GestureHandlerRootView style={styles.container}>
        <Appbar.Header style={styles.appbar}>
          <Appbar.BackAction onPress={onClose} />
          <Appbar.Content
            title={galleryPaths.length > 1 ? `${currentIndex + 1} of ${galleryPaths.length}` : 'Image Viewer'}
            style={{ alignItems: 'flex-start' }}
            titleStyle={{ textAlign: 'left' }}
          />
        </Appbar.Header>

        <View style={styles.imageContainer}>
          <FlatList
            ref={listRef}
            data={galleryPaths}
            keyExtractor={(path, index) => `${path}-${index}`}
            horizontal
            pagingEnabled
            scrollEnabled={!isZoomed}
            initialScrollIndex={clampedInitialIndex}
            showsHorizontalScrollIndicator={false}
            getItemLayout={(_, index) => ({ length: width, offset: width * index, index })}
            onMomentumScrollEnd={(event) => handleMomentumScrollEnd(event.nativeEvent.contentOffset.x)}
            renderItem={({ item }) => (
              <ZoomableImage
                imagePath={item}
                width={width}
                height={height - 64}
                onClose={onClose}
                isZoomed={isZoomed}
                onZoomChange={setIsZoomed}
              />
            )}
            onScrollToIndexFailed={({ index }) => {
              requestAnimationFrame(() => {
                listRef.current?.scrollToIndex({ index, animated: false });
              });
            }}
          />
          {authBetaEnabled ? (
            <View style={styles.debugPanel}>
              <Text style={styles.debugText}>path: {currentImagePath}</Text>
              <Text style={styles.debugText}>exists: {fileExists === null ? 'checking' : String(fileExists)}</Text>
              <Text style={styles.debugText}>
                inPermanentDir: {String(isImagePathInPermanentDir(currentImagePath))}
              </Text>
            </View>
          ) : null}
          {galleryPaths.length > 1 ? (
            <View style={styles.pageDots} pointerEvents="none">
              {galleryPaths.map((path, index) => (
                <View
                  key={`${path}-dot-${index}`}
                  style={[styles.pageDot, index === currentIndex ? styles.pageDotActive : null]}
                />
              ))}
            </View>
          ) : null}
          <IconButton
            icon="close"
            iconColor="#fff"
            size={24}
            onPress={onClose}
            style={styles.closeButton}
          />
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'black',
  },
  appbar: {
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    elevation: 0,
  },
  imageContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  imagePage: {
    justifyContent: 'center',
    alignItems: 'center',
    paddingBottom: 48,
    overflow: 'hidden',
  },
  image: {
    resizeMode: 'contain',
  },
  debugPanel: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 16,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    padding: 10,
    borderRadius: 6,
  },
  debugText: {
    color: '#fff',
    fontSize: 12,
  },
  pageDots: {
    position: 'absolute',
    bottom: 16,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
  },
  pageDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: 'rgba(255, 255, 255, 0.4)',
  },
  pageDotActive: {
    backgroundColor: '#fff',
  },
  closeButton: {
    position: 'absolute',
    top: 12,
    right: 12,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
});
