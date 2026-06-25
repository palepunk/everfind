import { EntityScreen } from '@/components/entity/EntityScreen';
import { ENTITY_CONFIGS } from '@/components/entity/entity.config';
import { useLocalSearchParams } from 'expo-router';

export default function HouseScreen() {
  const { id, entry } = useLocalSearchParams();

  return (
    <EntityScreen
      config={ENTITY_CONFIGS.house}
      id={id as string}
      entry={(entry as 'direct' | 'push') ?? 'push'}
    />
  );
}
