import { describe, it, expect, beforeEach, vi } from 'vitest'
import { getModelToStart, getLastUsedModel } from '../getModelToStart'
import { localStorageKey } from '@/constants/localStorage'

const LS_KEY = localStorageKey.lastUsedModel

const mkProvider = (name: string, modelIds: string[]): any => ({
  provider: name,
  active: true,
  models: modelIds.map((id) => ({ id })),
})

describe('getLastUsedModel', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('returns null when nothing is stored', () => {
    expect(getLastUsedModel()).toBeNull()
  })

  it('returns parsed value when stored', () => {
    localStorage.setItem(
      LS_KEY,
      JSON.stringify({ provider: 'llamacpp', model: 'qwen' })
    )
    expect(getLastUsedModel()).toEqual({ provider: 'llamacpp', model: 'qwen' })
  })

  it('returns null and swallows parse errors for malformed JSON', () => {
    localStorage.setItem(LS_KEY, '{not json')
    const spy = vi.spyOn(console, 'debug').mockImplementation(() => {})
    expect(getLastUsedModel()).toBeNull()
    spy.mockRestore()
  })
})

describe('getModelToStart', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('returns the last-used model when it resolves under the provider', () => {
    localStorage.setItem(
      LS_KEY,
      JSON.stringify({ provider: 'openai', model: 'gpt-4' })
    )
    const openai = mkProvider('openai', ['gpt-4', 'gpt-3.5'])
    const getProviderByName = vi.fn((name: string) =>
      name === 'openai' ? openai : undefined
    )
    expect(
      getModelToStart({ getProviderByName, selectedModel: null, selectedProvider: null })
    ).toEqual({ model: 'gpt-4', provider: openai })
  })

  it('uses selected model when last-used provider exists but model is missing', () => {
    localStorage.setItem(
      LS_KEY,
      JSON.stringify({ provider: 'openai', model: 'vanished' })
    )
    const openai = mkProvider('openai', ['gpt-4'])
    const getProviderByName = vi.fn((name: string) =>
      name === 'openai' ? openai : undefined
    )
    expect(
      getModelToStart({
        getProviderByName,
        selectedModel: { id: 'gpt-4' } as any,
        selectedProvider: 'openai',
      })
    ).toEqual({ model: 'gpt-4', provider: openai })
  })

  it('returns null when last-used provider is not found and nothing is selected', () => {
    localStorage.setItem(
      LS_KEY,
      JSON.stringify({ provider: 'ghost', model: 'x' })
    )
    const getProviderByName = vi.fn(() => undefined)
    expect(
      getModelToStart({ getProviderByName, selectedModel: null, selectedProvider: null })
    ).toBeNull()
  })

  it('uses selected model + provider when no last-used model stored', () => {
    const openai = mkProvider('openai', ['gpt-4'])
    const getProviderByName = vi.fn((name: string) =>
      name === 'openai' ? openai : undefined
    )
    expect(
      getModelToStart({
        getProviderByName,
        selectedModel: { id: 'gpt-4' } as any,
        selectedProvider: 'openai',
      })
    ).toEqual({ model: 'gpt-4', provider: openai })
  })

  it('returns null when selected provider does not resolve', () => {
    const getProviderByName = vi.fn(() => undefined)
    expect(
      getModelToStart({
        getProviderByName,
        selectedModel: { id: 'x' } as any,
        selectedProvider: 'ghost',
      })
    ).toBeNull()
  })

  it('returns null when no fallbacks resolve', () => {
    const getProviderByName = vi.fn(() => undefined)
    expect(
      getModelToStart({ getProviderByName, selectedModel: null, selectedProvider: null })
    ).toBeNull()
  })

  it('returns null when llamacpp provider exists but has no models', () => {
    const empty = mkProvider('llamacpp', [])
    const getProviderByName = vi.fn((name: string) =>
      name === 'llamacpp' ? empty : undefined
    )
    expect(
      getModelToStart({ getProviderByName, selectedModel: null, selectedProvider: null })
    ).toBeNull()
  })
})
