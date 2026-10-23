// Platform metadata used by the Setup wizard, Settings page, and any
// UI that needs to show platform-specific defaults / hints.
//
// `kind` mirrors `src/config/platform.rs::Platform` (PascalCase JSON), so
// the values flow into `AppConfig.platform.kind` unchanged.

import type { PlatformKind } from '@/types'

export type StartUrlPreset = {
  id: string
  /** i18n key resolving to the localised preset name (e.g. server region). */
  labelKey: string
  /** Target start URL for this preset. */
  url: string
}

export type PlatformInfo = {
  kind: PlatformKind
  /** i18n key resolving to the localised platform name. */
  labelKey: string
  /** i18n key resolving to the one-line localised summary shown beside the picker. */
  descriptionKey: string
  /**
   * Default URL for the Chromium capture backend's `start_url` when this
   * platform is active. Picked so the launched browser lands directly on
   * the game's lobby/match-find page. Empty for native-only platforms that
   * have no web client (see `supportsChromium`).
   */
  defaultStartUrl: string
  /**
   * Optional server / region URL presets for platforms that provide multiple
   * regional web client portals (e.g. Majsoul JP, KR/Global, EN, CN).
   */
  presets?: StartUrlPreset[]
  /**
   * Whether the Chromium (CDP) capture backend can drive this platform.
   * `false` for native clients with no web build (e.g. Riichi City), which
   * are only reachable through the MITM proxy. The UI hides / disables the
   * Chromium option and forces MITM for these.
   */
  supportsChromium: boolean
}

export const PLATFORMS: PlatformInfo[] = [
  {
    kind: 'Majsoul',
    labelKey: 'platform.majsoul',
    descriptionKey: 'platform.majsoul_desc',
    defaultStartUrl: 'https://game.mahjongsoul.com/index.html',
    presets: [
      {
        id: 'jp',
        labelKey: 'platform.majsoul_preset_jp',
        url: 'https://game.mahjongsoul.com/index.html',
      },
      {
        id: 'kr',
        labelKey: 'platform.majsoul_preset_kr',
        url: 'https://mahjongsoul.game.yo-star.com/kr/index.html',
      },
      {
        id: 'en',
        labelKey: 'platform.majsoul_preset_en',
        url: 'https://mahjongsoul.game.yo-star.com/en/index.html',
      },
      {
        id: 'cn',
        labelKey: 'platform.majsoul_preset_cn',
        url: 'https://game.maj-soul.com/1/',
      },
    ],
    supportsChromium: true,
  },
  {
    kind: 'Tenhou',
    labelKey: 'platform.tenhou',
    descriptionKey: 'platform.tenhou_desc',
    defaultStartUrl: 'https://tenhou.net/4/',
    presets: [
      {
        id: 'web4',
        labelKey: 'platform.tenhou_preset_web4',
        url: 'https://tenhou.net/4/',
      },
      {
        id: 'web3',
        labelKey: 'platform.tenhou_preset_web3',
        url: 'https://tenhou.net/3/',
      },
    ],
    supportsChromium: true,
  },
  {
    kind: 'RiichiCity',
    labelKey: 'platform.riichi_city',
    descriptionKey: 'platform.riichi_city_desc',
    // Native client, no web build → MITM only.
    defaultStartUrl: '',
    supportsChromium: false,
  },
]

const BY_KIND: Record<PlatformKind, PlatformInfo> = Object.fromEntries(
  PLATFORMS.map((p) => [p.kind, p]),
) as Record<PlatformKind, PlatformInfo>

export function platformInfo(kind: PlatformKind): PlatformInfo {
  return BY_KIND[kind]
}

/**
 * Set of every URL we have ever shipped as a "default" or preset for a platform.
 * Used to decide whether `start_url` is still a known default (so it's
 * safe to swap for the new platform's default on a platform change) or
 * whether the user has customised it (in which case we leave it alone).
 */
const KNOWN_DEFAULT_URLS = new Set<string>(
  [
    ...PLATFORMS.map((p) => p.defaultStartUrl),
    ...PLATFORMS.flatMap((p) => (p.presets ?? []).map((pr) => pr.url)),
    'https://game.maj-soul.com/1/',
    'https://game.mahjongsoul.com/index.html',
    'https://mahjongsoul.game.yo-star.com/kr/index.html',
    'https://mahjongsoul.game.yo-star.com/en/index.html',
    'https://tenhou.net/4/',
    'https://tenhou.net/3/',
  ].filter(Boolean),
)

export function isKnownDefaultStartUrl(url: string): boolean {
  return KNOWN_DEFAULT_URLS.has(url.trim())
}
