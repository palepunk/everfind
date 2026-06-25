import { Stack } from 'expo-router';

export default function StackLayout() {
  return (
    <Stack>
      <Stack.Screen name="rooms/[id]" options={{ headerShown: false }} />
      <Stack.Screen name="containers/[id]" options={{ headerShown: false }} />
      <Stack.Screen name="boxes/[id]" options={{ headerShown: false }} />
      <Stack.Screen name="items/[id]" options={{ headerShown: false }} />
      <Stack.Screen name="items/voice-add" options={{ headerShown: false }} />
    </Stack>
  );
}
