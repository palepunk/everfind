import AsyncStorage from '@react-native-async-storage/async-storage'
import { Platform } from 'react-native'
import { database } from './storage/database'
import { toRelativeImagePath } from './imageUtils'

const MIGRATION_KEY = 'imagePathMigration_v2'

export const migrateStoredImages = async () => {
  if (Platform.OS === 'web') return
  const completed = await AsyncStorage.getItem(MIGRATION_KEY)
  if (completed === 'done') return

  const collections = ['houses', 'rooms', 'containers', 'boxes', 'items'] as const

  await database.write(async () => {
    for (const collection of collections) {
      const records = await database.collections.get<any>(collection).query().fetch()
      for (const record of records) {
        const currentPath = record.imagePath as string | null
        if (!currentPath) continue

        const relativePath = toRelativeImagePath(currentPath)
        if (relativePath !== currentPath) {
          await record.update((rec: any) => {
            rec.imagePath = relativePath
          })
        }
      }
    }
  })

  await AsyncStorage.setItem(MIGRATION_KEY, 'done')
}
