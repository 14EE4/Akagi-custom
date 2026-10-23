import { describe, expect, it } from 'vitest'
import { isKnownDefaultStartUrl, platformInfo } from './platforms'

describe('platforms metadata', () => {
  it('defines Majsoul with JP default and regional presets', () => {
    const majsoul = platformInfo('Majsoul')
    expect(majsoul).toBeDefined()
    expect(majsoul.defaultStartUrl).toBe('https://game.mahjongsoul.com/index.html')
    expect(majsoul.supportsChromium).toBe(true)

    const presets = majsoul.presets ?? []
    expect(presets.length).toBeGreaterThanOrEqual(2)

    const jp = presets.find((p) => p.id === 'jp')
    expect(jp?.url).toBe('https://game.mahjongsoul.com/index.html')

    const kr = presets.find((p) => p.id === 'kr')
    expect(kr?.url).toBe('https://mahjongsoul.game.yo-star.com/kr/index.html')

    const en = presets.find((p) => p.id === 'en')
    expect(en?.url).toBe('https://mahjongsoul.game.yo-star.com/en/index.html')

    const cn = presets.find((p) => p.id === 'cn')
    expect(cn?.url).toBe('https://game.maj-soul.com/1/')
  })

  it('recognizes known default and preset start URLs', () => {
    expect(isKnownDefaultStartUrl('https://game.mahjongsoul.com/index.html')).toBe(true)
    expect(isKnownDefaultStartUrl('https://mahjongsoul.game.yo-star.com/kr/index.html')).toBe(true)
    expect(isKnownDefaultStartUrl('https://mahjongsoul.game.yo-star.com/en/index.html')).toBe(true)
    expect(isKnownDefaultStartUrl('https://game.maj-soul.com/1/')).toBe(true)
    expect(isKnownDefaultStartUrl('https://tenhou.net/4/')).toBe(true)
    expect(isKnownDefaultStartUrl('https://tenhou.net/3/')).toBe(true)

    expect(isKnownDefaultStartUrl('https://custom-proxy.example.com/')).toBe(false)
  })
})
