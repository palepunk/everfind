import AsyncStorage from '@react-native-async-storage/async-storage'
import { useCallback, useEffect, useState } from 'react'
import { emitSettingsUpdate, subscribeToSettingsUpdates } from './sync/settingsSyncEvents'
import { touchSettingsUpdatedAt } from './sync/settingsMetadata'

export type CurrencyCode = string

const STORAGE_KEY = 'currencyPreference'
const DEFAULT_CURRENCY: CurrencyCode = 'EUR'

const getDeviceCurrency = () => {
  try {
    const options = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'EUR' }).resolvedOptions()
    return options.currency || DEFAULT_CURRENCY
  } catch {
    return DEFAULT_CURRENCY
  }
}

const normalizeCurrencyCode = (value: string) => value.trim().toUpperCase()

export const loadCurrencyPreference = async (): Promise<CurrencyCode> => {
  const stored = await AsyncStorage.getItem(STORAGE_KEY)
  if (stored) {
    return normalizeCurrencyCode(stored)
  }
  return getDeviceCurrency()
}

export const saveCurrencyPreference = async (
  currency: CurrencyCode,
  options?: { touchUpdatedAt?: boolean }
) => {
  await AsyncStorage.setItem(STORAGE_KEY, normalizeCurrencyCode(currency))
  if (options?.touchUpdatedAt ?? true) {
    const updatedAt = await touchSettingsUpdatedAt()
    emitSettingsUpdate({
      currency: normalizeCurrencyCode(currency),
      updatedAt,
      source: 'local',
    })
  }
}

export const useCurrencyPreference = () => {
  const [currency, setCurrency] = useState<CurrencyCode>(DEFAULT_CURRENCY)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let isActive = true
    loadCurrencyPreference()
      .then((value) => {
        if (isActive) {
          setCurrency(value)
          setReady(true)
        }
      })
      .catch(() => {
        if (isActive) {
          setCurrency(DEFAULT_CURRENCY)
          setReady(true)
        }
      })
    return () => {
      isActive = false
    }
  }, [])

  useEffect(() => {
    return subscribeToSettingsUpdates((update) => {
      if (!update.currency) return
      setCurrency(normalizeCurrencyCode(update.currency))
    })
  }, [])

  const updateCurrency = useCallback(async (next: CurrencyCode) => {
    const normalized = normalizeCurrencyCode(next)
    setCurrency(normalized)
    await saveCurrencyPreference(normalized)
  }, [])

  return { currency, setCurrency: updateCurrency, ready }
}

export const formatCurrencyFromCents = (cents: number | null | undefined, currency: CurrencyCode) => {
  if (cents === null || cents === undefined) return ''
  const amount = cents / 100
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amount)
  } catch {
    return `${currency} ${amount.toFixed(2)}`
  }
}

export const formatCentsForInput = (cents: number | null | undefined) => {
  if (cents === null || cents === undefined) return ''
  return (cents / 100).toFixed(2)
}

export const parseCurrencyToCents = (input: string) => {
  const trimmed = input.trim()
  if (!trimmed) return null
  const normalized = trimmed.replace(/[^0-9.,-]/g, '')
  if (!normalized) return null
  const lastDot = normalized.lastIndexOf('.')
  const lastComma = normalized.lastIndexOf(',')
  const decimalIndex = Math.max(lastDot, lastComma)
  let integerPart = normalized
  let fractionPart = ''
  if (decimalIndex >= 0) {
    integerPart = normalized.slice(0, decimalIndex)
    fractionPart = normalized.slice(decimalIndex + 1)
  }
  integerPart = integerPart.replace(/[.,]/g, '')
  const normalizedNumber = fractionPart ? `${integerPart}.${fractionPart}` : integerPart
  const amount = Number(normalizedNumber)
  if (Number.isNaN(amount)) return null
  return Math.round(amount * 100)
}
