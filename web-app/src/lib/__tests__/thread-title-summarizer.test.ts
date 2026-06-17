import { describe, it, expect } from 'vitest'
import { cleanTitle, generateThreadTitle } from '../thread-title-summarizer'

describe('cleanTitle', () => {
  it('returns a clean title from normal text', () => {
    expect(cleanTitle('Hello World')).toBe('Hello World')
  })

  it('strips reasoning tags', () => {
    expect(
      cleanTitle('<think>let me think about this...</think>JavaScript Basics')
    ).toBe('JavaScript Basics')
  })

  it('handles multiline reasoning blocks', () => {
    const input = '<think>\nstep 1\nstep 2\n</think> Final Answer'
    expect(cleanTitle(input)).toBe('Final Answer')
  })

  it('removes surrounding quotes', () => {
    expect(cleanTitle('"My Great Title"')).toBe('My Great Title')
    expect(cleanTitle("'Single Quoted'")).toBe('Single Quoted')
  })

  it('collapses whitespace and newlines', () => {
    expect(cleanTitle('Too   many   spaces')).toBe('Too many spaces')
    expect(cleanTitle('Title with\nnewline')).toBe('Title with newline')
    expect(cleanTitle('Tabs\tand\tnewlines\n')).toBe('Tabs and newlines')
  })

  it('enforces word limit of 10', () => {
    const longTitle =
      'One Two Three Four Five Six Seven Eight Nine Ten Eleven Twelve'
    expect(cleanTitle(longTitle)).toBe(
      'One Two Three Four Five Six Seven Eight Nine Ten'
    )
  })

  it('keeps unicode characters', () => {
    expect(cleanTitle('日本語のタイトル')).toBe('日本語のタイトル')
    expect(cleanTitle('Título en español')).toBe('Título en español')
    expect(cleanTitle('Résumé du projet')).toBe('Résumé du projet')
  })

  it('removes special characters but keeps letters and numbers', () => {
    expect(cleanTitle('Title! With@ Special# Chars$')).toBe(
      'Title With Special Chars'
    )
    expect(cleanTitle('Version 2.0 Release')).toBe('Version 20 Release')
  })

  it('returns null for empty or very short text', () => {
    expect(cleanTitle('')).toBeNull()
    expect(cleanTitle('   ')).toBeNull()
    expect(cleanTitle('a')).toBeNull()
  })

  it('returns null when only special characters remain', () => {
    expect(cleanTitle('!@#$%^&*()')).toBeNull()
  })

  it('removes leftover XML tags', () => {
    expect(cleanTitle('<b>Bold Title</b>')).toBe('Bold Title')
    expect(cleanTitle('Before <em>and</em> after')).toBe('Before and after')
  })

  it('handles text that is only a reasoning block', () => {
    expect(cleanTitle('<think>only reasoning</think>')).toBeNull()
  })

  it('handles nested or malformed tags gracefully', () => {
    expect(cleanTitle('Title <br/> with breaks')).toBe('Title with breaks')
  })
})

describe('generateThreadTitle', () => {
  it('derives a deterministic title from the first transcript line', async () => {
    const controller = new AbortController()
    const result = await generateThreadTitle(
      'user: Can you help me write a function to sort a list in Python?\nassistant: Sure.',
      controller.signal
    )

    expect(result).toBe('Can you help me write a function to sort a')
  })

  it('returns null when aborted', async () => {
    const controller = new AbortController()
    controller.abort()

    await expect(generateThreadTitle('test message', controller.signal)).resolves.toBeNull()
  })

  it('returns null when the deterministic title cleans to nothing', async () => {
    const controller = new AbortController()
    await expect(generateThreadTitle('!!!', controller.signal)).resolves.toBeNull()
  })

  it('truncates long transcripts before cleaning', async () => {
    const controller = new AbortController()
    const result = await generateThreadTitle('x'.repeat(2000), controller.signal)

    expect(result).toBe('x'.repeat(1500))
  })
})
