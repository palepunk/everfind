import { View } from 'react-native';
import { Appbar, Text } from 'react-native-paper';
import { router } from 'expo-router';

export default function HousesScreen() {
  return (
    <View style={{ flex: 1 }}>
      <Appbar.Header>
        <Appbar.BackAction onPress={() => router.back()} />
        <Appbar.Content title="Houses" style={{ alignItems: 'flex-start' }} titleStyle={{ textAlign: 'left' }} />
      </Appbar.Header>

      <View style={{ padding: 16 }}>
        <Text>Houses screen placeholder</Text>
      </View>
    </View>
  );
}
