import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ExternalLink, PanelTopClose, Play, RefreshCw, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { HAS_TAURI, invoke } from '@/lib/tauri'
import { pickShow, visibleItems } from '@/lib/botShow'
import { useNotifyStore } from '@/stores/notifyStore'
import { useConfigStore } from '@/stores/configStore'
import { useCaptureStore } from '@/stores/captureStore'
import { useSidebar } from '@/hooks/useSidebar'
import { useIsNarrow } from '@/hooks/useIsNarrow'
import { useUiPrefsStore } from '@/stores/uiPrefsStore'

interface EmbeddedBrowserStatus {
  enabled: boolean
  embedded: boolean
  browser_found: boolean
}

export function PlayClient() {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [status, setStatus] = useState<EmbeddedBrowserStatus>({
    enabled: true,
    embedded: false,
    browser_found: false,
  })
  const [busy, setBusy] = useState(false)

  const config = useConfigStore((s) => s.config)
  const setConfig = useConfigStore((s) => s.setConfig)
  const captureStatus = useCaptureStore((s) => s.status)
  const responses = useNotifyStore((s) => s.responses)

  const isOpen = useSidebar((s) => s.isOpen)
  const isHover = useSidebar((s) => s.isHover)
  const settings = useSidebar((s) => s.settings)
  const isDrawerOpen = useSidebar((s) => s.isDrawerOpen)
  const isNarrow = useIsNarrow()
  const scale = useUiPrefsStore((s) => s.scale)

  const latestShow = useMemo(() => {
    for (let i = responses.length - 1; i >= 0; i--) {
      const s = pickShow(responses[i].meta)
      if (s) return s
    }
    return null
  }, [responses])

  const topSuggestions = useMemo(() => visibleItems(latestShow, 3), [latestShow])

  const syncGeometry = useCallback(async () => {
    if (!HAS_TAURI) return
    const el = containerRef.current
    if (!el) return

    const rect = el.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1

    // If a modal dialog or mobile drawer is open on screen, temporarily park
    // the native child window so the React overlay remains visible on top.
    const hasModal =
      (isNarrow && isDrawerOpen) ||
      document.querySelector('[role="dialog"], [role="alertdialog"]') !== null

    // If the sidebar is collapsed (5.625rem) and currently hover-expanded (18rem),
    // shift the left edge so the hover sidebar is never covered.
    const hoverSidebarExpanded = !isNarrow && !settings.disabled && !isOpen && settings.isHoverOpen && isHover
    const sidebarOverlayPx = hoverSidebarExpanded ? (18 - 5.625) * 16 * scale : 0

    const cssX = Math.max(rect.left, rect.left + sidebarOverlayPx)
    const cssW = Math.max(0, rect.width - sidebarOverlayPx)
    const cssY = rect.top
    const cssH = rect.height

    const x = Math.round(cssX * dpr)
    const y = Math.round(cssY * dpr)
    const width = Math.round(cssW * dpr)
    const height = Math.round(cssH * dpr)
    const active = !hasModal && width >= 320 && height >= 240

    try {
      const res = await invoke<EmbeddedBrowserStatus>('sync_embedded_browser', {
        active,
        x,
        y,
        width,
        height,
      })
      setStatus(res)
    } catch {
      /* ignore transient IPC errors */
    }
  }, [isDrawerOpen, isHover, isNarrow, isOpen, scale, settings.disabled, settings.isHoverOpen])

  useEffect(() => {
    void syncGeometry()
    const el = containerRef.current
    const ro = el ? new ResizeObserver(() => void syncGeometry()) : null
    if (el && ro) ro.observe(el)

    const onResize = () => void syncGeometry()
    window.addEventListener('resize', onResize)

    const timer = window.setInterval(() => {
      void syncGeometry()
    }, 500)

    return () => {
      if (ro) ro.disconnect()
      window.removeEventListener('resize', onResize)
      window.clearInterval(timer)
    }
  }, [syncGeometry])

  const toggleEmbed = async () => {
    if (!HAS_TAURI) return
    setBusy(true)
    try {
      const next = !status.enabled
      const res = await invoke<EmbeddedBrowserStatus>('set_embedded_browser_enabled', {
        enabled: next,
      })
      setStatus(res)
      if (next) {
        await syncGeometry()
      }
    } finally {
      setBusy(false)
    }
  }

  const reloadGame = async () => {
    if (!HAS_TAURI) return
    setBusy(true)
    try {
      await invoke('reload_embedded_browser')
    } catch {
      /* ignore */
    } finally {
      setBusy(false)
    }
  }

  const restartCapture = async () => {
    if (!HAS_TAURI) return
    setBusy(true)
    try {
      await invoke('restart_capture')
    } catch {
      /* ignore */
    } finally {
      setBusy(false)
    }
  }

  const toggleAutoplay = async (enabled: boolean) => {
    if (!HAS_TAURI || !config) return
    const nextConfig = {
      ...config,
      autoplay: {
        ...config.autoplay,
        enabled,
      },
    }
    setConfig(nextConfig)
    try {
      await invoke('update_config', { newConfig: nextConfig })
    } catch {
      /* ignore */
    }
  }

  const autoplayEnabled = config?.autoplay?.enabled ?? false

  return (
    <div className="flex flex-col w-full h-full min-h-0 overflow-hidden bg-background">
      {/* Top compact control & AI recommendation bar */}
      <header className="h-11 shrink-0 px-3 border-b border-border bg-card/80 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0 overflow-hidden">
          <span className="font-semibold text-sm whitespace-nowrap flex items-center gap-1.5">
            <Play className="h-4 w-4 text-primary" />
            작혼 (Mahjong Soul)
          </span>
          <div className="h-4 w-px bg-border shrink-0" />
          <div className="flex items-center gap-2 min-w-0 overflow-x-auto no-scrollbar text-xs">
            <span className="text-muted-foreground whitespace-nowrap">AI 추천:</span>
            {topSuggestions.length === 0 ? (
              <span className="text-muted-foreground/70 whitespace-nowrap">대국 대기 중</span>
            ) : (
              topSuggestions.map((item, idx) => (
                <span
                  key={idx}
                  className={
                    idx === 0
                      ? 'inline-flex items-center gap-1 rounded px-2 py-0.5 font-semibold bg-primary/15 text-primary border border-primary/30 whitespace-nowrap'
                      : 'inline-flex items-center gap-1 rounded px-1.5 py-0.5 bg-muted text-muted-foreground whitespace-nowrap'
                  }
                >
                  <span>{item.pais?.join(' ') || item.tiles || '—'}</span>
                  {item.label && <span className="opacity-85">({item.label})</span>}
                </span>
              ))
            )}
          </div>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-muted/50 border border-border/60">
            <Label htmlFor="play-autoplay-toggle" className="text-xs cursor-pointer whitespace-nowrap">
              오토플레이
            </Label>
            <Switch
              id="play-autoplay-toggle"
              checked={autoplayEnabled}
              onCheckedChange={(v) => void toggleAutoplay(v)}
            />
          </div>

          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs px-2.5 gap-1"
            onClick={() => void reloadGame()}
            disabled={busy || !status.browser_found}
            title="게임 화면 새로고침"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            새로고침
          </Button>

          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs px-2.5 gap-1"
            onClick={() => void toggleEmbed()}
            disabled={busy}
            title={status.enabled ? '외부 독립 창으로 분리' : '아카기 탭 안으로 고정'}
          >
            {status.enabled ? (
              <>
                <ExternalLink className="h-3.5 w-3.5" />
                창 분리
              </>
            ) : (
              <>
                <PanelTopClose className="h-3.5 w-3.5" />
                탭에 넣기
              </>
            )}
          </Button>

          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs px-2 gap-1 text-muted-foreground"
            onClick={() => void restartCapture()}
            disabled={busy}
            title="브라우저 캡처 재시작"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </Button>
        </div>
      </header>

      {/* Embedded native Chromium container */}
      <div
        ref={containerRef}
        className="flex-1 w-full min-h-0 relative bg-zinc-950/90 flex items-center justify-center select-none"
      >
        {!status.embedded && (
          <div className="max-w-md rounded-lg border border-border bg-card p-6 text-center shadow-lg grid gap-3">
            <h3 className="text-base font-semibold">
              {!status.enabled
                ? '작혼 창이 외부 독립 창으로 분리되어 있습니다'
                : captureStatus.state === 'running'
                  ? '작혼 브라우저 창을 연결하는 중입니다…'
                  : '브라우저 캡처가 실행 중이 아닙니다'}
            </h3>
            <p className="text-xs text-muted-foreground leading-relaxed">
              {!status.enabled
                ? '외부 창에서도 백그라운드 오토플레이는 멈추지 않고 계속 작동합니다. 다시 아카기 탭 안으로 넣으려면 아래 버튼을 누르세요.'
                : '다른 탭(대시보드, 설정 등)으로 이동하거나 다른 프로그램을 켜도 백그라운드에서 작혼 렌더링과 오토플레이가 멈추지 않고 계속 작동합니다.'}
            </p>
            <div className="flex items-center justify-center gap-2 pt-1">
              {!status.enabled ? (
                <Button size="sm" onClick={() => void toggleEmbed()} disabled={busy}>
                  아카기 탭 안으로 넣기
                </Button>
              ) : (
                <Button size="sm" variant="outline" onClick={() => void restartCapture()} disabled={busy}>
                  브라우저 다시 열기
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
