import { Q } from '@/utils/storage/query'
import { database } from './storage/database'
import { loadPowerSyncReadModeEnabled } from './powersync/readMode'
import { getPowerSyncRepositoryItemImages } from './powersync/repository'

export type ItemImageRecord = {
  id: string
  itemId: string
  houseId: string
  imagePath: string | null
  remotePath: string | null
  position: number
}

export const getLegacyItemImageId = (itemId: string) => `legacy-${itemId}`

const sortByPosition = <T extends { position: number; id: string }>(records: T[]) =>
  [...records].sort((left, right) => {
    if (left.position !== right.position) {
      return left.position - right.position
    }
    return left.id.localeCompare(right.id)
  })

export const getItemImages = async (itemId: string): Promise<ItemImageRecord[]> => {
  const records = await database.collections
    .get<any>('item_images')
    .query(Q.where('item_id', itemId))
    .fetch()

  return sortByPosition(records).map((record) => ({
    id: record.id,
    itemId: record.itemId,
    houseId: record.houseId,
    imagePath: record.imagePath ?? null,
    remotePath: record.remotePath ?? null,
    position: record.position ?? 0,
  }))
}

export const getItemImageCount = async (itemId: string) => {
  if (await loadPowerSyncReadModeEnabled()) {
    return (await getPowerSyncRepositoryItemImages(undefined, itemId)).length
  }

  const records = await database.collections
    .get<any>('item_images')
    .query(Q.where('item_id', itemId))
    .fetch()
  return records.length
}

export const syncItemCoverImage = async (itemId: string) => {
  const itemImages = await getItemImages(itemId)
  const nextCoverPath = itemImages[0]?.imagePath ?? null
  let item: any
  try {
    item = await database.collections.get<any>('items').find(itemId)
  } catch {
    return null
  }
  if ((item.imagePath ?? null) === nextCoverPath) {
    return item
  }

  await database.write(async () => {
    await item.update((current: any) => {
      current.imagePath = nextCoverPath
    })
  })

  return await database.collections.get<any>('items').find(itemId)
}
