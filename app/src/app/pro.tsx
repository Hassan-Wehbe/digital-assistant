// The Pro card on its own (the 🌅 My day tile or the Plan my day chip, without Pro).
import { router } from 'expo-router';
import { ScrollView } from 'react-native';

import { ProCard } from '@/components/ProCard';
import { styles } from '@/components/ui';

export default function Pro() {
  return (
    <ScrollView contentContainerStyle={styles.list}>
      <ProCard onNotNow={() => router.back()} />
    </ScrollView>
  );
}
