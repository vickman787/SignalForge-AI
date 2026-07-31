import { useState, useEffect, useCallback } from 'react'

const STORAGE_KEY = 'signalforge:history:v1'
const MAX_ENTRIES = 50

function newId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function loadEntries() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    // Corrupt or unreadable storage — start clean rather than crash.
    return []
  }
}

function persist(entries) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries))
  } catch (err) {
    // Quota exceeded, or storage blocked (private browsing / disabled cookies).
    // History is a convenience — never break analysis over it.
    console.warn('Could not save research history:', err?.message || err)
  }
}

export function relativeTime(timestamp) {
  const seconds = Math.floor((Date.now() - timestamp) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Date(timestamp).toLocaleDateString()
}

/**
 * Research history persisted in the browser (per-device, no account needed).
 * Newest first, capped at MAX_ENTRIES.
 */
export function useResearchHistory() {
  const [entries, setEntries] = useState([])

  useEffect(() => {
    setEntries(loadEntries())
  }, [])

  const addEntry = useCallback(({ query, mode, result }) => {
    setEntries((prev) => {
      const next = [
        { id: newId(), query, mode, result, timestamp: Date.now() },
        ...prev,
      ].slice(0, MAX_ENTRIES)
      persist(next)
      return next
    })
  }, [])

  const removeEntry = useCallback((id) => {
    setEntries((prev) => {
      const next = prev.filter((entry) => entry.id !== id)
      persist(next)
      return next
    })
  }, [])

  const clearEntries = useCallback(() => {
    setEntries([])
    persist([])
  }, [])

  return { entries, addEntry, removeEntry, clearEntries }
}
