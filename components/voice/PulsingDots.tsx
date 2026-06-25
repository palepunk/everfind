import { useEffect, useRef } from 'react';
import { Animated, View } from 'react-native';
import { useTheme } from 'react-native-paper';
import type { AppTheme } from '@/utils/theme/theme';

type PulsingDotsProps = {
  size?: number;
  gap?: number;
};

export function PulsingDots({ size = 8, gap = 6 }: PulsingDotsProps) {
  const { colors } = useTheme<AppTheme>();
  const dot1 = useRef(new Animated.Value(0.6)).current;
  const dot2 = useRef(new Animated.Value(0.6)).current;
  const dot3 = useRef(new Animated.Value(0.6)).current;

  useEffect(() => {
    const makePulse = (value: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(value, { toValue: 1, duration: 450, useNativeDriver: true }),
          Animated.timing(value, { toValue: 0.6, duration: 450, useNativeDriver: true }),
        ])
      );

    const animations = [makePulse(dot1, 0), makePulse(dot2, 150), makePulse(dot3, 300)];
    animations.forEach((anim) => anim.start());

    return () => {
      animations.forEach((anim) => anim.stop());
    };
  }, [dot1, dot2, dot3]);

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap }}>
      {[dot1, dot2, dot3].map((dot, index) => (
        <Animated.View
          // eslint-disable-next-line react/no-array-index-key
          key={`dot-${index}`}
          style={{
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: colors.primary,
            opacity: dot,
          }}
        />
      ))}
    </View>
  );
}
