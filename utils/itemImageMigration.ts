import AsyncStorage from '@react-native-async-storage/async-storage'
import { Platform } from 'react-native'
import { Q } from '@/utils/storage/query'
import { database } from './storage/database'

const MIGRATION_KEY = 'itemImageMigration_v1'

const normalizePosition = (value: number | null | undefined) =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0

export const migrateLegacyItemImages = async () => {
  if (Platform.OS === 'web') return
  const completed = await AsyncStorage.getItem(MIGRATION_KEY)
  if (completed === 'done') return

  await database.write(async () => {
    const items = await database.collections.get<any>('items').query().fetch()
    const itemImagesCollection = database.collections.get<any>('item_images')

    for (const item of items) {
      const legacyPath = (item.imagePath as string | null) ?? null
      if (!legacyPath) continue

      const existing = await itemImagesCollection
        .query(Q.where('item_id', item.id))
        .fetch()

      if (existing.length > 0) {
        const sorted = [...existing].sort(
          (left, right) => normalizePosition(left.position) - normalizePosition(right.position)
        )
        const coverPath = (sorted[0]?.imagePath as string | null) ?? legacyPath
        if (coverPath !== legacyPath) {
          await item.update((record: any) => {
            record.imagePath = coverPath
          })
        }
        continue
      }

      await itemImagesCollection.create((image: any) => {
        image.itemId = item.id
        image.houseId = item.houseId
        image.imagePath = legacyPath
        image.remotePath = null
        image.position = 0
        image.createdBy = item.createdBy ?? null
        image.updatedBy = item.updatedBy ?? null
      })
    }
  })

  await AsyncStorage.setItem(MIGRATION_KEY, 'done')
}
