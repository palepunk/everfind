import { View } from 'react-native';
import { Appbar, Searchbar, Text } from 'react-native-paper';
import { router } from 'expo-router';

export default function SearchModal() {
  const handleBackPress = () => {
    router.back();
  };

  return (
    <View style={{ flex: 1 }}>
      <Appbar.Header>
        <Appbar.BackAction onPress={handleBackPress} />
        <Appbar.Content title="Search" style={{ alignItems: 'flex-start' }} titleStyle={{ textAlign: 'left' }} />
      </Appbar.Header>

      <View style={{ padding: 16 }}>
        <Searchbar
          placeholder="Search items, boxes, rooms..."
          value=""
          onChangeText={() => {}}
          autoFocus
        />

        <Text variant="bodyLarge" style={{ marginTop: 16 }}>
          Search functionality will be implemented here.
        </Text>
      </View>
    </View>
  );
}
