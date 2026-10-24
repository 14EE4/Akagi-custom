import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeftRight,
  Bot,
  Crosshair,
  ExternalLink,
  Gamepad2,
  Globe,
  Minimize2,
  Maximize2,
  PanelTopClose,
  PanelRightClose,
  PanelRightOpen,
  Play,
  Square,
  RefreshCw,
  RotateCcw,
  Settings2,
  X,
} from 'lucide-react'
import { ServerSelector } from '@/components/ServerSelector'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useAutoQueueStore } from '@/stores/autoQueueStore'
import { toast } from 'sonner'
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
  const autoQueueStatus = useAutoQueueStore((s) => s.status)
  const [autoQueueDialogOpen, setAutoQueueDialogOpen] = useState(false)
  const [autoQueueDebugOpen, setAutoQueueDebugOpen] = useState(false)
  const [hudMinimized, setHudMinimized] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [hudSide, setHudSide] = useState<'left' | 'right'>('right')
  const [isSimulating, setIsSimulating] = useState(false)
  const [debugLogs, setDebugLogs] = useState<string[]>([])
  const [aqDraft, setAqDraft] = useState({
    max_matches: 0,
    min_delay_sec: 8,
    max_delay_sec: 15,
    initial_delay_ms: 30000,
    confirm_clicks: 3,
    confirm_delay_ms: 5000,
    confirm_x: 13.9,
    confirm_y: 8.2,
    rematch_delay_ms: 2500,
    rematch_x: 12.0,
    rematch_y: 8.2,
    modal_delay_ms: 2200,
    modal_yes_x: 6.9,
    modal_yes_y: 6.5,
    show_click_indicator: true,
    strategy: 'lobby' as 'lobby' | 'rematch',
    lobby_confirm_max: 8,
    lobby_confirm_delay_ms: 3500,
    rank_match_x: 11.5,
    rank_match_y: 2.8,
    four_player_x: 4.5,
    four_player_y: 1.4,
    room_card_x: 11.5,
    room_card_y: 4.6,
    round_type_x: 11.5,
    round_type_y: 4.6,
    lobby_step_delay_ms: 1500,
  })

  const appendDebugLog = (msg: string) => {
    const time = new Date().toLocaleTimeString()
    setDebugLogs((prev) => [`[${time}] ${msg}`, ...prev.slice(0, 19)])
  }

  const openAutoQueueDialog = () => {
    const currentAq = config?.autoplay?.auto_queue
    setAqDraft({
      max_matches: currentAq?.max_matches ?? 0,
      min_delay_sec: currentAq?.min_delay_sec ?? 8,
      max_delay_sec: currentAq?.max_delay_sec ?? 15,
      initial_delay_ms: currentAq?.initial_delay_ms ?? 30000,
      confirm_clicks: currentAq?.confirm_clicks ?? 3,
      confirm_delay_ms: currentAq?.confirm_delay_ms ?? 5000,
      confirm_x: currentAq?.confirm_x ?? 13.9,
      confirm_y: currentAq?.confirm_y ?? 8.2,
      rematch_delay_ms: currentAq?.rematch_delay_ms ?? 2500,
      rematch_x: currentAq?.rematch_x ?? 12.0,
      rematch_y: currentAq?.rematch_y ?? 8.2,
      modal_delay_ms: currentAq?.modal_delay_ms ?? 2200,
      modal_yes_x: currentAq?.modal_yes_x ?? 6.9,
      modal_yes_y: currentAq?.modal_yes_y ?? 6.5,
      show_click_indicator: currentAq?.show_click_indicator ?? true,
      strategy: (currentAq?.strategy ?? 'lobby') as 'lobby' | 'rematch',
      lobby_confirm_max: currentAq?.lobby_confirm_max ?? 8,
      lobby_confirm_delay_ms: currentAq?.lobby_confirm_delay_ms ?? 3500,
      rank_match_x: currentAq?.rank_match_x ?? 11.5,
      rank_match_y: currentAq?.rank_match_y ?? 2.8,
      four_player_x: currentAq?.four_player_x ?? 4.5,
      four_player_y: currentAq?.four_player_y ?? 1.4,
      room_card_x: currentAq?.room_card_x ?? 11.5,
      room_card_y: currentAq?.room_card_y ?? 4.6,
      round_type_x: currentAq?.round_type_x ?? 11.5,
      round_type_y: currentAq?.round_type_y ?? 4.6,
      lobby_step_delay_ms: currentAq?.lobby_step_delay_ms ?? 1500,
    })
    setAutoQueueDialogOpen(true)
  }

  const openAutoQueueDebugModal = () => {
    const currentAq = config?.autoplay?.auto_queue
    setAqDraft({
      max_matches: currentAq?.max_matches ?? 0,
      min_delay_sec: currentAq?.min_delay_sec ?? 8,
      max_delay_sec: currentAq?.max_delay_sec ?? 15,
      initial_delay_ms: currentAq?.initial_delay_ms ?? 30000,
      confirm_clicks: currentAq?.confirm_clicks ?? 3,
      confirm_delay_ms: currentAq?.confirm_delay_ms ?? 5000,
      confirm_x: currentAq?.confirm_x ?? 13.9,
      confirm_y: currentAq?.confirm_y ?? 8.2,
      rematch_delay_ms: currentAq?.rematch_delay_ms ?? 2500,
      rematch_x: currentAq?.rematch_x ?? 12.0,
      rematch_y: currentAq?.rematch_y ?? 8.2,
      modal_delay_ms: currentAq?.modal_delay_ms ?? 2200,
      modal_yes_x: currentAq?.modal_yes_x ?? 6.9,
      modal_yes_y: currentAq?.modal_yes_y ?? 6.5,
      show_click_indicator: currentAq?.show_click_indicator ?? true,
      strategy: (currentAq?.strategy ?? 'lobby') as 'lobby' | 'rematch',
      lobby_confirm_max: currentAq?.lobby_confirm_max ?? 8,
      lobby_confirm_delay_ms: currentAq?.lobby_confirm_delay_ms ?? 3500,
      rank_match_x: currentAq?.rank_match_x ?? 11.5,
      rank_match_y: currentAq?.rank_match_y ?? 2.8,
      four_player_x: currentAq?.four_player_x ?? 4.5,
      four_player_y: currentAq?.four_player_y ?? 1.4,
      room_card_x: currentAq?.room_card_x ?? 11.5,
      room_card_y: currentAq?.room_card_y ?? 4.6,
      round_type_x: currentAq?.round_type_x ?? 11.5,
      round_type_y: currentAq?.round_type_y ?? 4.6,
      lobby_step_delay_ms: currentAq?.lobby_step_delay_ms ?? 1500,
    })
    setAutoQueueDebugOpen(true)
  }

  const testSingleClick = async (xNorm: number, yNorm: number, label: string) => {
    if (!HAS_TAURI) return
    try {
      const res = await invoke<{
        success: boolean
        px: number
        py: number
        canvas_width: number
        canvas_height: number
        message: string
      }>('test_click_canvas', { xNorm, yNorm, label })
      appendDebugLog(res.message)
      if (res.success) {
        toast.success(`[${label}] 클릭 성공: ${res.px.toFixed(0)}px, ${res.py.toFixed(0)}px`)
      } else {
        toast.error(`[${label}] 클릭 실패: ${res.message}`)
      }
    } catch (e: any) {
      const msg = e?.message || String(e)
      appendDebugLog(`오류: ${msg}`)
      toast.error(`클릭 실패: ${msg}`)
    }
  }

  const testStep = async (step: string) => {
    if (!HAS_TAURI) return
    try {
      if (step === 'full_sequence') {
        setIsSimulating(true)
      } else if (step === 'stop') {
        setIsSimulating(false)
      }
      const res = await invoke<string>('test_auto_queue_step', { step })
      appendDebugLog(`[${step}] ${res}`)
      toast.success(res)
    } catch (e: any) {
      setIsSimulating(false)
      const msg = e?.message || String(e)
      appendDebugLog(`[${step}] 오류: ${msg}`)
      toast.error(`실패: ${msg}`)
    }
  }

  const stopSimulation = async () => {
    if (!HAS_TAURI) return
    try {
      const res = await invoke<string>('stop_auto_queue_simulation')
      appendDebugLog(`[중지] ${res}`)
      setIsSimulating(false)
      toast.info(res)
    } catch (e: any) {
      setIsSimulating(false)
      toast.error(`중지 실패: ${e?.message || e}`)
    }
  }


  const saveAutoQueueSettings = async () => {
    if (!HAS_TAURI || !config) return
    const nextConfig = {
      ...config,
      autoplay: {
        ...config.autoplay,
        auto_queue: {
          ...(config.autoplay?.auto_queue ?? {
            enabled: false,
            max_matches: 0,
            min_delay_sec: 8,
            max_delay_sec: 15,
          }),
          ...aqDraft,
        },
      },
    }
    setConfig(nextConfig)
    setAutoQueueDialogOpen(false)
    try {
      await invoke('update_config', { newConfig: nextConfig })
      toast.success('자동 연속 대국 설정이 저장되었습니다.')
    } catch {
      toast.error('설정 저장에 실패했습니다.')
    }
  }

  const toggleAutoQueue = async (enabled: boolean) => {
    if (!HAS_TAURI) return
    try {
      await invoke('set_auto_queue_enabled', { enabled })
      if (config) {
        setConfig({
          ...config,
          autoplay: {
            ...config.autoplay,
            auto_queue: {
              ...(config.autoplay?.auto_queue ?? {
                enabled: false,
                max_matches: 0,
                min_delay_sec: 8,
                max_delay_sec: 15,
              }),
              enabled,
            },
          },
        })
      }
    } catch {
      /* ignore */
    }
  }

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

  const resyncBot = async () => {
    if (!HAS_TAURI) return
    setBusy(true)
    try {
      await invoke('resync_bot')
      toast.success('봇 프로세스를 재시작하고 상태를 재동기화했습니다')
    } catch (e) {
      toast.error(`봇 재동기화 실패: ${String(e)}`)
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

  const toggleAutoLaunch = async (auto_launch: boolean) => {
    if (!HAS_TAURI || !config) return
    const nextConfig = {
      ...config,
      capture: {
        ...config.capture,
        chromium: {
          ...config.capture.chromium,
          auto_launch,
        },
      },
    }
    setConfig(nextConfig)
    try {
      await invoke('update_config', { newConfig: nextConfig })
      toast.success(
        auto_launch
          ? '아카기 시작 시 브라우저가 자동 실행됩니다.'
          : '아카기 시작 시 브라우저 자동 실행이 꺼졌습니다. (다른 기기 중복 로그인 방지)'
      )
    } catch {
      toast.error('설정 저장 실패')
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
                      ? 'inline-flex items-center gap-1.5 rounded px-2 py-0.5 font-semibold bg-primary/15 text-primary border border-primary/30 whitespace-nowrap shadow-xs'
                      : 'inline-flex items-center gap-1 rounded px-1.5 py-0.5 bg-muted text-muted-foreground border border-border/40 whitespace-nowrap'
                  }
                >
                  <span className={idx === 0 ? 'text-primary font-bold' : ''}>
                    {item.pais?.join(' ') || item.tiles || '—'}
                  </span>
                  {item.label && <span className="opacity-75 text-[10px]">({item.label})</span>}
                  {item.value && (
                    <span
                      className={
                        idx === 0
                          ? 'font-mono text-[11px] font-bold px-1 rounded bg-primary/20 text-primary'
                          : 'font-mono text-[10px] font-medium text-foreground/80'
                      }
                    >
                      {item.value}
                    </span>
                  )}
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

          <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-muted/50 border border-border/60">
            <Label htmlFor="play-autoqueue-toggle" className="text-xs cursor-pointer whitespace-nowrap flex items-center gap-1">
              <span>자동 다음 대국</span>
              {autoQueueStatus.enabled && (
                <span
                  className={`text-[10px] font-semibold px-1 py-0.5 rounded cursor-pointer transition-colors ${
                    autoQueueStatus.state === 'waiting'
                      ? 'bg-amber-500/20 text-amber-500 border border-amber-500/40 animate-pulse'
                      : autoQueueStatus.state === 'queuing'
                      ? 'bg-emerald-500/20 text-emerald-500 border border-emerald-500/40'
                      : 'bg-primary/20 text-primary border border-primary/30'
                  }`}
                  onClick={(e) => {
                    e.preventDefault()
                    openAutoQueueDialog()
                  }}
                  title="클릭하여 연속 대국 설정 변경"
                >
                  {autoQueueStatus.state === 'waiting'
                    ? `대기 중 (${autoQueueStatus.wait_seconds_left ?? 0}s)`
                    : autoQueueStatus.state === 'queuing'
                    ? '매칭 중...'
                    : autoQueueStatus.max_matches > 0
                    ? `${autoQueueStatus.current_matches}/${autoQueueStatus.max_matches}판`
                    : autoQueueStatus.current_matches > 0
                    ? `${autoQueueStatus.current_matches}판 완료`
                    : 'ON'}
                </span>
              )}
            </Label>
            <Switch
              id="play-autoqueue-toggle"
              checked={autoQueueStatus.enabled}
              onCheckedChange={(v) => void toggleAutoQueue(v)}
            />
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground transition-colors p-0.5 rounded"
              onClick={openAutoQueueDialog}
              title="자동 연속 대국 설정 (최대 대국 수, 대기 시간)"
            >
              <Settings2 className="h-3 w-3" />
            </button>
            <button
              type="button"
              className="text-muted-foreground hover:text-primary transition-colors p-0.5 rounded"
              onClick={openAutoQueueDebugModal}
              title="클릭 위치/시간 실시간 디버그 & 테스트"
            >
              <Crosshair className="h-3.5 w-3.5" />
            </button>
          </div>

          <ServerSelector variant="header" disabled={busy} />

          {captureStatus.state !== 'running' && (
            <Button
              size="sm"
              className="h-7 text-xs px-2.5 gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white shadow-xs font-semibold"
              onClick={() => void restartCapture()}
              disabled={busy}
              title="작혼 브라우저 실행"
            >
              <Play className="h-3.5 w-3.5 fill-current" />
              작혼 실행
            </Button>
          )}

          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs px-2.5 gap-1 border-primary/40 text-primary hover:bg-primary/10"
            onClick={() => void resyncBot()}
            disabled={busy}
            title="게임 중 멈춘 봇 프로세스를 재시작하고 대국 상태로 재동기화"
          >
            <Bot className="h-3.5 w-3.5" />
            봇 다시 깨우기
          </Button>

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

          <Button
            variant={sidebarOpen ? "secondary" : "outline"}
            size="sm"
            className="h-7 text-xs px-2 gap-1 font-medium ml-1"
            onClick={() => setSidebarOpen(!sidebarOpen)}
            title={sidebarOpen ? "우측 사이드바 닫기" : "우측 사이드바 열기 (자동 큐 / 실시간 로그)"}
          >
            {sidebarOpen ? (
              <>
                <PanelRightClose className="h-3.5 w-3.5 text-primary" />
                <span className="hidden sm:inline">사이드바</span>
              </>
            ) : (
              <>
                <PanelRightOpen className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="hidden sm:inline">사이드바</span>
              </>
            )}
          </Button>
        </div>
      </header>

      {/* Main Content Area: Embedded Chromium + Right Sidebar */}
      <div className="flex-1 w-full min-h-0 flex overflow-hidden relative">
        {/* Embedded native Chromium container */}
        <div
          ref={containerRef}
          className="flex-1 h-full min-w-0 relative bg-zinc-950/90 flex items-center justify-center select-none"
        >
        {!status.embedded && (
          <div className="max-w-lg rounded-xl border border-border bg-card p-6 text-center shadow-2xl grid gap-5 select-none">
            {captureStatus.state !== 'running' ? (
              <>
                <div className="grid gap-1.5">
                  <h3 className="text-lg font-bold text-foreground flex items-center justify-center gap-2">
                    <Gamepad2 className="h-5 w-5 text-primary" />
                    작혼 실행 전 서버 선택
                  </h3>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    접속할 서버(지역)를 선택하세요.
                    <br />
                    원치 않는 서버로 자동 접속되어 <span className="font-semibold text-foreground/90">다른 기기(스마트폰 등)에서 강제 로그아웃(중복 로그인)</span>되는 것을 방지합니다.
                  </p>
                </div>

                <div className="bg-muted/30 border border-border/60 rounded-lg p-3.5 grid gap-2.5 text-left">
                  <span className="text-xs font-semibold text-foreground/80 flex items-center gap-1.5">
                    <Globe className="h-3.5 w-3.5 text-primary" />
                    접속 서버 (지역)
                  </span>
                  <ServerSelector variant="button-group" disabled={busy} />
                </div>

                <div className="flex flex-col gap-3 pt-1">
                  <Button
                    size="default"
                    className="w-full gap-2 text-sm font-semibold bg-emerald-600 hover:bg-emerald-500 text-white shadow-md py-5"
                    onClick={() => void restartCapture()}
                    disabled={busy}
                  >
                    <Play className="h-4 w-4 fill-current" />
                    선택한 서버로 작혼 브라우저 실행
                  </Button>

                  <div className="flex items-center justify-between border-t border-border/40 pt-3 text-xs text-muted-foreground">
                    <div className="flex flex-col text-left">
                      <span className="font-medium text-foreground/90">아카기 시작 시 브라우저 자동 실행</span>
                      <span className="text-[11px] text-muted-foreground">끄면 아카기 시작 시 다른 기기 중복 로그인이 방지됩니다.</span>
                    </div>
                    <Switch
                      checked={config?.capture?.chromium?.auto_launch ?? true}
                      onCheckedChange={(v) => void toggleAutoLaunch(v)}
                    />
                  </div>
                </div>
              </>
            ) : (
              <>
                <h3 className="text-base font-semibold">
                  {!status.enabled
                    ? '작혼 창이 외부 독립 창으로 분리되어 있습니다'
                    : '작혼 브라우저 창을 연결하는 중입니다…'}
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
              </>
            )}
          </div>
        )}

        {/* Floating Non-Blocking Auto Queue Debugger HUD */}
        {autoQueueDebugOpen && (
          <div
            className={`absolute top-3 ${
              hudSide === 'right' ? 'right-3' : 'left-3'
            } z-40 transition-all duration-200 select-none ${
              hudMinimized ? 'w-auto' : 'w-84 max-w-[calc(100vw-2rem)]'
            }`}
          >
            {hudMinimized ? (
              /* Minimized Compact Bar */
              <div className="flex items-center gap-1.5 p-1.5 rounded-lg bg-background/95 backdrop-blur-md border border-border shadow-2xl text-xs">
                <div className="flex items-center gap-1 px-1.5 font-bold text-primary text-[11px]">
                  <Crosshair className="h-3.5 w-3.5" />
                  <span>디버그</span>
                </div>
                {aqDraft.strategy === 'lobby' ? (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 text-[10px] px-1.5 py-0 border-primary/40 bg-card hover:bg-primary/10"
                      onClick={() => void testSingleClick(aqDraft.confirm_x, aqDraft.confirm_y, '확인')}
                      title="우하단 확인(로비탈출) 클릭"
                    >
                      확인
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 text-[10px] px-1.5 py-0 border-primary/40 bg-card hover:bg-primary/10"
                      onClick={() => void testSingleClick(aqDraft.rank_match_x, aqDraft.rank_match_y, '단위전')}
                      title="1. 단위전 클릭"
                    >
                      1.단위전
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 text-[10px] px-1.5 py-0 border-primary/40 bg-card hover:bg-primary/10"
                      onClick={() => void testSingleClick(aqDraft.room_card_x, aqDraft.room_card_y, '은탁')}
                      title="2. 은탁 카드 클릭 (11.5, 4.6)"
                    >
                      2.은탁
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 text-[10px] px-1.5 py-0 border-primary/40 bg-card hover:bg-primary/10"
                      onClick={() => void testSingleClick(aqDraft.round_type_x, aqDraft.round_type_y, '4인반장')}
                      title="3. 4인 반장전 클릭 (11.5, 4.6)"
                    >
                      3.반장
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 text-[10px] px-1.5 py-0 text-muted-foreground hover:text-foreground"
                      onClick={() => void testStep('check_screen')}
                      title="현재 화면 상태 감지 (Lobby/GameEnd)"
                    >
                      상태
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 text-[10px] px-2 py-0 border-primary/40 bg-card hover:bg-primary/10"
                      onClick={() => void testSingleClick(aqDraft.confirm_x, aqDraft.confirm_y, '확인')}
                      title="확인 버튼 클릭 테스트"
                    >
                      1.확인
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 text-[10px] px-2 py-0 border-primary/40 bg-card hover:bg-primary/10"
                      onClick={() => void testSingleClick(aqDraft.rematch_x, aqDraft.rematch_y, '한번더')}
                      title="한번더 버튼 클릭 테스트"
                    >
                      2.한번더
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 text-[10px] px-2 py-0 border-primary/40 bg-card hover:bg-primary/10"
                      onClick={() => void testSingleClick(aqDraft.modal_yes_x, aqDraft.modal_yes_y, '네')}
                      title="팝업 '네' 버튼 클릭 테스트"
                    >
                      3.네
                    </Button>
                  </>
                )}
                <div className="h-3 w-px bg-border/60 mx-0.5" />
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-6 w-6 text-muted-foreground hover:text-foreground"
                  onClick={() => setHudSide(hudSide === 'right' ? 'left' : 'right')}
                  title={hudSide === 'right' ? '좌측으로 이동' : '우측으로 이동'}
                >
                  <ArrowLeftRight className="h-3 w-3" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-6 w-6 text-muted-foreground hover:text-foreground"
                  onClick={() => setHudMinimized(false)}
                  title="패널 펼치기"
                >
                  <Maximize2 className="h-3 w-3" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-6 w-6 text-muted-foreground hover:text-destructive"
                  onClick={() => setAutoQueueDebugOpen(false)}
                  title="디버거 닫기"
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            ) : (
              /* Expanded HUD Panel */
              <div className="rounded-xl bg-background/95 backdrop-blur-md border border-border shadow-2xl p-3 text-xs flex flex-col gap-2.5 max-h-[85vh] overflow-y-auto">
                {/* Header */}
                <div className="flex items-center justify-between pb-1.5 border-b border-border/50">
                  <div className="flex items-center gap-1.5 font-bold text-foreground">
                    <Crosshair className="h-4 w-4 text-primary" />
                    <span>자동 대국 디버그 & 위치</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6 text-muted-foreground hover:text-foreground"
                      onClick={() => setHudSide(hudSide === 'right' ? 'left' : 'right')}
                      title={hudSide === 'right' ? '좌측으로 패널 이동' : '우측으로 패널 이동'}
                    >
                      <ArrowLeftRight className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6 text-muted-foreground hover:text-foreground"
                      onClick={() => setHudMinimized(true)}
                      title="최소화 (1줄 툴바로 축소)"
                    >
                      <Minimize2 className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6 text-muted-foreground hover:text-destructive"
                      onClick={() => setAutoQueueDebugOpen(false)}
                      title="닫기"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                {/* Strategy Selection Toggle */}
                <div className="grid grid-cols-2 gap-1 p-0.5 rounded-lg bg-muted/60 border border-border/40 text-[11px]">
                  <Button
                    size="sm"
                    variant={aqDraft.strategy === 'lobby' ? 'default' : 'ghost'}
                    className="h-6 text-[10px] font-semibold"
                    onClick={() => setAqDraft({ ...aqDraft, strategy: 'lobby' })}
                  >
                    로비 탈출 후 재진입 (권장)
                  </Button>
                  <Button
                    size="sm"
                    variant={aqDraft.strategy === 'rematch' ? 'default' : 'ghost'}
                    className="h-6 text-[10px] font-semibold"
                    onClick={() => setAqDraft({ ...aqDraft, strategy: 'rematch' })}
                  >
                    결과창 '한번더' 버튼
                  </Button>
                </div>

                {aqDraft.strategy === 'lobby' ? (
                  /* Lobby Strategy View */
                  <div className="space-y-2.5">
                    {/* Quick 1-Click Action Buttons for Lobby */}
                    <div className="grid grid-cols-4 gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 text-[10px] px-1 flex items-center justify-center border-primary/40 bg-primary/5 hover:bg-primary/20"
                        onClick={() => void testSingleClick(aqDraft.rank_match_x, aqDraft.rank_match_y, '1.단위전')}
                        title="단위전 (11.5, 2.8)"
                      >
                        1.단위전
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 text-[10px] px-1 flex items-center justify-center border-primary/40 bg-primary/5 hover:bg-primary/20"
                        onClick={() => void testSingleClick(aqDraft.room_card_x, aqDraft.room_card_y, '2.은탁')}
                        title="은탁 (11.5, 4.6)"
                      >
                        2.은탁
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 text-[10px] px-1 flex items-center justify-center border-primary/40 bg-primary/5 hover:bg-primary/20"
                        onClick={() => void testSingleClick(aqDraft.round_type_x, aqDraft.round_type_y, '3.4인반장')}
                        title="4인 반장전 (은탁과 위치 동일: 11.5, 4.6)"
                      >
                        3.4인반장
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 text-[10px] px-1 flex items-center justify-center border-emerald-500/40 bg-emerald-500/5 hover:bg-emerald-500/20 text-emerald-400 font-bold"
                        onClick={() => void testStep('check_screen')}
                        title="작혼 화면 상태(로비/정산/인게임) 실시간 감지"
                      >
                        화면상태
                      </Button>
                    </div>

                    <div className="space-y-2 p-2 rounded-lg bg-muted/40 border border-border/50 text-[11px]">
                      {/* Step 1: Lobby Exit Loop */}
                      <div className="space-y-1">
                        <div className="flex items-center justify-between font-semibold text-foreground">
                          <span>1단계 [로비 탈출] (우하단 확인 감지 루프)</span>
                        </div>
                        <div className="grid grid-cols-2 gap-1.5 pt-0.5 text-[10px]">
                          <div>
                            <span className="text-muted-foreground">대국 종료 후 첫 대기:</span>
                            <div className="flex items-center gap-1 mt-0.5">
                              <Input
                                type="number"
                                step={100}
                                className="h-5 text-[10px] px-1 text-center"
                                value={aqDraft.initial_delay_ms}
                                onChange={(e) => setAqDraft({ ...aqDraft, initial_delay_ms: Math.max(500, parseInt(e.target.value || '1000', 10)) })}
                              />
                              <span className="text-muted-foreground">ms</span>
                            </div>
                          </div>
                          <div>
                            <span className="text-muted-foreground">탈출 확인 간격:</span>
                            <div className="flex items-center gap-1 mt-0.5">
                              <Input
                                type="number"
                                step={100}
                                className="h-5 text-[10px] px-1 text-center"
                                value={aqDraft.lobby_confirm_delay_ms}
                                onChange={(e) => setAqDraft({ ...aqDraft, lobby_confirm_delay_ms: Math.max(500, parseInt(e.target.value || '1000', 10)) })}
                              />
                              <span className="text-muted-foreground">ms</span>
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 pt-0.5">
                          <span className="text-muted-foreground">확인 좌표 X:</span>
                          <Input
                            type="number"
                            step={0.1}
                            className="h-5 text-[10px] w-12 px-1 text-center"
                            value={aqDraft.confirm_x}
                            onChange={(e) => setAqDraft({ ...aqDraft, confirm_x: parseFloat(e.target.value || '0') })}
                          />
                          <span className="text-muted-foreground">Y:</span>
                          <Input
                            type="number"
                            step={0.1}
                            className="h-5 text-[10px] w-12 px-1 text-center"
                            value={aqDraft.confirm_y}
                            onChange={(e) => setAqDraft({ ...aqDraft, confirm_y: parseFloat(e.target.value || '0') })}
                          />
                          <Button
                            size="sm"
                            variant="secondary"
                            className="h-5 text-[10px] px-2 ml-auto"
                            onClick={() => void testSingleClick(aqDraft.confirm_x, aqDraft.confirm_y, '확인(로비탈출)')}
                          >
                            클릭
                          </Button>
                        </div>
                      </div>

                      {/* Step 2: Lobby Rank Match Navigation */}
                      <div className="space-y-1.5 pt-1.5 border-t border-border/30">
                        <div className="flex items-center justify-between font-semibold text-foreground">
                          <span>2단계 [로비 단위전 진입 탐색]</span>
                          <span className="text-[10px] text-muted-foreground">단계별 딜레이: {aqDraft.lobby_step_delay_ms}ms</span>
                        </div>

                        {/* 1. 단위전 */}
                        <div className="flex items-center gap-1.5 text-[10px]">
                          <span className="w-20 shrink-0 font-medium text-foreground">1. 단위전:</span>
                          <span className="text-muted-foreground">X</span>
                          <Input
                            type="number"
                            step={0.1}
                            className="h-5 text-[10px] w-12 px-1 text-center"
                            value={aqDraft.rank_match_x}
                            onChange={(e) => setAqDraft({ ...aqDraft, rank_match_x: parseFloat(e.target.value || '0') })}
                          />
                          <span className="text-muted-foreground">Y</span>
                          <Input
                            type="number"
                            step={0.1}
                            className="h-5 text-[10px] w-12 px-1 text-center"
                            value={aqDraft.rank_match_y}
                            onChange={(e) => setAqDraft({ ...aqDraft, rank_match_y: parseFloat(e.target.value || '0') })}
                          />
                          <Button
                            size="sm"
                            variant="secondary"
                            className="h-5 text-[10px] px-1.5 ml-auto"
                            onClick={() => void testSingleClick(aqDraft.rank_match_x, aqDraft.rank_match_y, '1. 단위전')}
                          >
                            클릭
                          </Button>
                        </div>

                        {/* 2. 은탁 */}
                        <div className="flex items-center gap-1.5 text-[10px]">
                          <span className="w-20 shrink-0 font-medium text-foreground">2. 은탁:</span>
                          <span className="text-muted-foreground">X</span>
                          <Input
                            type="number"
                            step={0.1}
                            className="h-5 text-[10px] w-12 px-1 text-center"
                            value={aqDraft.room_card_x}
                            onChange={(e) => setAqDraft({ ...aqDraft, room_card_x: parseFloat(e.target.value || '0') })}
                          />
                          <span className="text-muted-foreground">Y</span>
                          <Input
                            type="number"
                            step={0.1}
                            className="h-5 text-[10px] w-12 px-1 text-center"
                            value={aqDraft.room_card_y}
                            onChange={(e) => setAqDraft({ ...aqDraft, room_card_y: parseFloat(e.target.value || '0') })}
                          />
                          <Button
                            size="sm"
                            variant="secondary"
                            className="h-5 text-[10px] px-1.5 ml-auto"
                            onClick={() => void testSingleClick(aqDraft.room_card_x, aqDraft.room_card_y, '2. 은탁')}
                          >
                            클릭
                          </Button>
                        </div>

                        {/* 3. 4인 반장전 (은탁 버튼과 위치 동일) */}
                        <div className="flex items-center gap-1.5 text-[10px]">
                          <span className="w-20 shrink-0 font-medium text-foreground">3. 4인반장:</span>
                          <span className="text-muted-foreground">X</span>
                          <Input
                            type="number"
                            step={0.1}
                            className="h-5 text-[10px] w-12 px-1 text-center"
                            value={aqDraft.round_type_x}
                            onChange={(e) => setAqDraft({ ...aqDraft, round_type_x: parseFloat(e.target.value || '0') })}
                          />
                          <span className="text-muted-foreground">Y</span>
                          <Input
                            type="number"
                            step={0.1}
                            className="h-5 text-[10px] w-12 px-1 text-center"
                            value={aqDraft.round_type_y}
                            onChange={(e) => setAqDraft({ ...aqDraft, round_type_y: parseFloat(e.target.value || '0') })}
                          />
                          <Button
                            size="sm"
                            variant="secondary"
                            className="h-5 text-[10px] px-1.5 ml-auto"
                            onClick={() => void testSingleClick(aqDraft.round_type_x, aqDraft.round_type_y, '3. 4인 반장전')}
                          >
                            클릭
                          </Button>
                        </div>
                      </div>
                    </div>

                    {/* Simulation Button for Lobby */}
                    {isSimulating ? (
                      <Button
                        variant="destructive"
                        size="sm"
                        className="w-full h-7 text-xs font-semibold gap-1.5 animate-pulse bg-destructive hover:bg-destructive/90 text-destructive-foreground shadow"
                        onClick={() => void stopSimulation()}
                      >
                        <Square className="h-3 w-3 fill-current" />
                        시뮬레이션 중지 (클릭 시 즉각 중단)
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full h-7 text-xs font-semibold gap-1.5 border-primary/40 bg-primary/5 hover:bg-primary/20"
                        onClick={() => void testStep('full_sequence')}
                      >
                        <Play className="h-3 w-3 text-primary" />
                        전체 로비 시뮬레이션 (단위전 → 은탁 → 4인 반장전)
                      </Button>
                    )}
                  </div>
                ) : (
                  /* Legacy Rematch View */
                  <div className="space-y-2.5">
                    {/* Quick 1-Click Action Buttons */}
                    <div className="grid grid-cols-3 gap-1.5">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-[11px] px-1.5 flex items-center justify-center gap-1 border-primary/40 bg-primary/5 hover:bg-primary/20"
                        onClick={() => void testSingleClick(aqDraft.confirm_x, aqDraft.confirm_y, '확인')}
                      >
                        <Crosshair className="h-3 w-3 text-primary shrink-0" />
                        1. 확인
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-[11px] px-1.5 flex items-center justify-center gap-1 border-primary/40 bg-primary/5 hover:bg-primary/20"
                        onClick={() => void testSingleClick(aqDraft.rematch_x, aqDraft.rematch_y, '한번더')}
                      >
                        <Crosshair className="h-3 w-3 text-primary shrink-0" />
                        2. 한번더
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-[11px] px-1.5 flex items-center justify-center gap-1 border-primary/40 bg-primary/5 hover:bg-primary/20"
                        onClick={() => void testSingleClick(aqDraft.modal_yes_x, aqDraft.modal_yes_y, '네')}
                      >
                        <Crosshair className="h-3 w-3 text-primary shrink-0" />
                        3. 팝업'네'
                      </Button>
                    </div>

                    {/* Coordinates & Timings Fine-Tuning */}
                    <div className="space-y-2.5 p-2 rounded-lg bg-muted/40 border border-border/50 text-[11px]">
                      {/* Step 1: Confirm */}
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between font-semibold text-foreground">
                          <span>1단계 [확인] (우하단 연출 스킵)</span>
                          <span className="text-[10px] text-primary font-bold">{aqDraft.confirm_clicks}회 클릭</span>
                        </div>

                        {/* Character Preset Quick Toggle */}
                        <div className="flex items-center gap-1.5">
                          <Button
                            size="sm"
                            variant={aqDraft.confirm_clicks === 2 ? 'default' : 'outline'}
                            className="h-5 text-[10px] px-2 py-0 flex-1 font-semibold"
                            onClick={() => setAqDraft({ ...aqDraft, confirm_clicks: 2 })}
                          >
                            빠른 스킵 (2회)
                          </Button>
                          <Button
                            size="sm"
                            variant={aqDraft.confirm_clicks === 3 ? 'default' : 'outline'}
                            className="h-5 text-[10px] px-2 py-0 flex-1 font-semibold"
                            onClick={() => setAqDraft({ ...aqDraft, confirm_clicks: 3 })}
                          >
                            기본 권장 (3회)
                          </Button>
                          <Input
                            type="number"
                            min={1}
                            max={10}
                            className="h-5 text-[10px] w-12 px-1 text-center"
                            value={aqDraft.confirm_clicks}
                            onChange={(e) => setAqDraft({ ...aqDraft, confirm_clicks: Math.max(1, parseInt(e.target.value || '1', 10)) })}
                            title="직접 확인 클릭 횟수 지정"
                          />
                        </div>

                        {/* Delays for Step 1 */}
                        <div className="grid grid-cols-2 gap-1.5 pt-0.5 text-[10px]">
                          <div>
                            <span className="text-muted-foreground">대국 종료 후 첫 대기:</span>
                            <div className="flex items-center gap-1 mt-0.5">
                              <Input
                                type="number"
                                step={100}
                                className="h-5 text-[10px] px-1 text-center"
                                value={aqDraft.initial_delay_ms}
                                onChange={(e) => setAqDraft({ ...aqDraft, initial_delay_ms: Math.max(500, parseInt(e.target.value || '1000', 10)) })}
                              />
                              <span className="text-muted-foreground">ms</span>
                            </div>
                          </div>
                          <div>
                            <span className="text-muted-foreground">확인 클릭 간 딜레이:</span>
                            <div className="flex items-center gap-1 mt-0.5">
                              <Input
                                type="number"
                                step={100}
                                className="h-5 text-[10px] px-1 text-center"
                                value={aqDraft.confirm_delay_ms}
                                onChange={(e) => setAqDraft({ ...aqDraft, confirm_delay_ms: Math.max(500, parseInt(e.target.value || '1000', 10)) })}
                              />
                              <span className="text-muted-foreground">ms</span>
                            </div>
                          </div>
                        </div>

                        {/* Coordinates for Step 1 */}
                        <div className="flex items-center gap-1.5 pt-0.5">
                          <span className="text-muted-foreground">X:</span>
                          <Input
                            type="number"
                            step={0.1}
                            className="h-5 text-[10px] w-14 px-1 text-center"
                            value={aqDraft.confirm_x}
                            onChange={(e) => setAqDraft({ ...aqDraft, confirm_x: parseFloat(e.target.value || '0') })}
                          />
                          <span className="text-muted-foreground">Y:</span>
                          <Input
                            type="number"
                            step={0.1}
                            className="h-5 text-[10px] w-14 px-1 text-center"
                            value={aqDraft.confirm_y}
                            onChange={(e) => setAqDraft({ ...aqDraft, confirm_y: parseFloat(e.target.value || '0') })}
                          />
                          <Button
                            size="sm"
                            variant="secondary"
                            className="h-5 text-[10px] px-2 ml-auto"
                            onClick={() => void testSingleClick(aqDraft.confirm_x, aqDraft.confirm_y, '확인')}
                          >
                            클릭
                          </Button>
                        </div>
                      </div>

                      {/* Step 2: Rematch */}
                      <div className="space-y-1.5 pt-2 border-t border-border/30">
                        <div className="flex items-center justify-between font-semibold text-foreground">
                          <span>2단계 [한번더] (우하단 재전)</span>
                        </div>

                        <div className="flex items-center gap-2 text-[10px]">
                          <span className="text-muted-foreground shrink-0">결과 화면 대기 딜레이:</span>
                          <Input
                            type="number"
                            step={100}
                            className="h-5 text-[10px] w-18 px-1 text-center"
                            value={aqDraft.rematch_delay_ms}
                            onChange={(e) => setAqDraft({ ...aqDraft, rematch_delay_ms: Math.max(500, parseInt(e.target.value || '1000', 10)) })}
                          />
                          <span className="text-muted-foreground shrink-0">ms</span>
                        </div>

                        <div className="flex items-center gap-1.5">
                          <span className="text-muted-foreground">X:</span>
                          <Input
                            type="number"
                            step={0.1}
                            className="h-5 text-[10px] w-14 px-1 text-center"
                            value={aqDraft.rematch_x}
                            onChange={(e) => setAqDraft({ ...aqDraft, rematch_x: parseFloat(e.target.value || '0') })}
                          />
                          <span className="text-muted-foreground">Y:</span>
                          <Input
                            type="number"
                            step={0.1}
                            className="h-5 text-[10px] w-14 px-1 text-center"
                            value={aqDraft.rematch_y}
                            onChange={(e) => setAqDraft({ ...aqDraft, rematch_y: parseFloat(e.target.value || '0') })}
                          />
                          <Button
                            size="sm"
                            variant="secondary"
                            className="h-5 text-[10px] px-2 ml-auto"
                            onClick={() => void testSingleClick(aqDraft.rematch_x, aqDraft.rematch_y, '한번더')}
                          >
                            클릭
                          </Button>
                        </div>
                      </div>

                      {/* Step 3: Modal Yes */}
                      <div className="space-y-1.5 pt-2 border-t border-border/30">
                        <div className="flex items-center justify-between font-semibold text-foreground">
                          <span>3단계 [팝업 '네'] (화면 중앙 좌측 확인)</span>
                        </div>

                        <div className="flex items-center gap-2 text-[10px]">
                          <span className="text-muted-foreground shrink-0">팝업창 대기 딜레이:</span>
                          <Input
                            type="number"
                            step={100}
                            className="h-5 text-[10px] w-18 px-1 text-center"
                            value={aqDraft.modal_delay_ms}
                            onChange={(e) => setAqDraft({ ...aqDraft, modal_delay_ms: Math.max(500, parseInt(e.target.value || '1000', 10)) })}
                          />
                          <span className="text-muted-foreground shrink-0">ms</span>
                        </div>

                        <div className="flex items-center gap-1.5">
                          <span className="text-muted-foreground">X:</span>
                          <Input
                            type="number"
                            step={0.1}
                            className="h-5 text-[10px] w-14 px-1 text-center"
                            value={aqDraft.modal_yes_x}
                            onChange={(e) => setAqDraft({ ...aqDraft, modal_yes_x: parseFloat(e.target.value || '0') })}
                          />
                          <span className="text-muted-foreground">Y:</span>
                          <Input
                            type="number"
                            step={0.1}
                            className="h-5 text-[10px] w-14 px-1 text-center"
                            value={aqDraft.modal_yes_y}
                            onChange={(e) => setAqDraft({ ...aqDraft, modal_yes_y: parseFloat(e.target.value || '0') })}
                          />
                          <Button
                            size="sm"
                            variant="secondary"
                            className="h-5 text-[10px] px-2 ml-auto"
                            onClick={() => void testSingleClick(aqDraft.modal_yes_x, aqDraft.modal_yes_y, '네')}
                          >
                            클릭
                          </Button>
                        </div>
                      </div>
                    </div>

                    {/* Simulation Button */}
                    {isSimulating ? (
                      <Button
                        variant="destructive"
                        size="sm"
                        className="w-full h-7 text-xs font-semibold gap-1.5 animate-pulse bg-destructive hover:bg-destructive/90 text-destructive-foreground shadow"
                        onClick={() => void stopSimulation()}
                      >
                        <Square className="h-3 w-3 fill-current" />
                        시뮬레이션 중지 (클릭 시 즉각 중단)
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full h-7 text-xs font-semibold gap-1.5 border-primary/40 bg-primary/5 hover:bg-primary/20"
                        onClick={() => void testStep('full_sequence')}
                      >
                        <Play className="h-3 w-3 text-primary" />
                        전체 시퀀스 시뮬레이션 ({aqDraft.confirm_clicks}회 → 한번더 → 네)
                      </Button>
                    )}
                  </div>
                )}

                {/* Live Compact Log */}
                <div className="rounded bg-black/85 text-emerald-400 p-1.5 font-mono text-[10px] h-16 overflow-y-auto space-y-0.5 border border-border/40">
                  {debugLogs.length === 0 ? (
                    <span className="text-muted-foreground/60">버튼을 클릭하면 좌표 로그가 출력됩니다.</span>
                  ) : (
                    debugLogs.map((log, idx) => <div key={idx}>{log}</div>)
                  )}
                </div>

                {/* Save and Controls */}
                <div className="flex items-center justify-between pt-1">
                  <div className="flex items-center gap-1.5">
                    <Switch
                      id="hud-marker-switch"
                      checked={aqDraft.show_click_indicator}
                      onCheckedChange={(v) => setAqDraft({ ...aqDraft, show_click_indicator: v })}
                      className="scale-75"
                    />
                    <Label htmlFor="hud-marker-switch" className="text-[11px] cursor-pointer">
                      붉은 마커 표시
                    </Label>
                  </div>
                  <Button size="sm" className="h-7 text-xs px-3 font-semibold" onClick={() => void saveAutoQueueSettings()}>
                    설정 저장
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
        </div>

        {/* Right Sidebar for Auto Queue & Logs */}
        {sidebarOpen && (
          <aside className="w-72 flex-shrink-0 border-l border-border bg-card/95 backdrop-blur-md flex flex-col h-full overflow-hidden z-20 select-none shadow-2xl">
            {/* Sidebar Header */}
            <div className="h-10 border-b border-border/60 px-3 flex items-center justify-between bg-muted/20 shrink-0">
              <div className="flex items-center gap-2">
                <Bot className="h-4 w-4 text-primary" />
                <span className="font-bold text-xs text-foreground">자동 대국 & 로그</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-semibold ${
                  autoQueueStatus.enabled ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30' : 'bg-muted text-muted-foreground'
                }`}>
                  {autoQueueStatus.enabled ? '자동 매칭 ON' : 'OFF'}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-muted-foreground hover:text-foreground"
                  onClick={() => setSidebarOpen(false)}
                  title="사이드바 닫기"
                >
                  <PanelRightClose className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-3 text-xs">
              {/* 1. Auto Queue Status Card */}
              <div className="p-3 rounded-lg border border-border/70 bg-background/50 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex flex-col">
                    <span className="font-semibold text-xs text-foreground">자동 매칭 (Auto Queue)</span>
                    <span className="text-[10px] text-muted-foreground">
                      {autoQueueStatus.max_matches > 0
                        ? `진행: ${autoQueueStatus.current_matches} / ${autoQueueStatus.max_matches} 판`
                        : `진행: ${autoQueueStatus.current_matches} 판 완료`}
                    </span>
                  </div>
                  <Switch
                    checked={autoQueueStatus.enabled}
                    onCheckedChange={(checked) => void toggleAutoQueue(checked)}
                  />
                </div>

                {autoQueueStatus.enabled && (
                  <div className="pt-1.5 border-t border-border/40 space-y-1">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-muted-foreground">현재 상태:</span>
                      <span className="font-semibold text-primary">
                        {autoQueueStatus.state === 'idle' && '대기 중 (게임 대기)'}
                        {autoQueueStatus.state === 'in_game' && (
                          <span className="text-emerald-400 font-bold flex items-center gap-1.5">
                            <span className="relative flex h-2 w-2">
                              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                            </span>
                            대국 진행 중
                          </span>
                        )}
                        {autoQueueStatus.state === 'queuing' && (
                          <span className="text-sky-400 font-bold">
                            정산/매칭 처리 중
                          </span>
                        )}
                        {autoQueueStatus.state === 'waiting' && (
                          <span className="text-amber-400 font-bold">
                            휴식 대기 ({autoQueueStatus.wait_seconds_left ?? 0}s)
                          </span>
                        )}
                      </span>
                    </div>
                  </div>
                )}
              </div>

              {/* 2. Quick Action Buttons */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-[11px] font-semibold text-muted-foreground px-0.5">
                  <span>빠른 조작</span>
                  <button
                    onClick={() => openAutoQueueDialog()}
                    className="text-[10px] text-primary hover:underline flex items-center gap-0.5"
                  >
                    <Settings2 className="h-3 w-3" />
                    설정
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-[11px] px-2 font-medium bg-card hover:bg-primary/10 border-border"
                    onClick={() => void testSingleClick(aqDraft.confirm_x, aqDraft.confirm_y, '확인')}
                    title="우하단 확인/정산 탈출 클릭"
                  >
                    확인 1회 클릭
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-[11px] px-2 font-medium text-emerald-400 hover:text-emerald-300 border-emerald-500/30 bg-emerald-500/5 hover:bg-emerald-500/10"
                    onClick={() => void testStep('check_screen')}
                    title="현재 화면 상태 감지"
                  >
                    화면상태 검사
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-[11px] px-2 font-medium bg-card hover:bg-primary/10 border-border"
                    onClick={() => void testSingleClick(aqDraft.rank_match_x, aqDraft.rank_match_y, '단위전')}
                    title="단위전 클릭"
                  >
                    1.단위전
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-[11px] px-2 font-medium bg-card hover:bg-primary/10 border-border"
                    onClick={() => void testSingleClick(aqDraft.round_type_x, aqDraft.round_type_y, '3.4인반장')}
                    title="은탁 4인 반장전 클릭"
                  >
                    2.은탁 4인반장
                  </Button>
                </div>
              </div>

              {/* 3. Realtime Logs & Notifications Feed */}
              <div className="space-y-1.5 pt-1 flex flex-col flex-1 min-h-[200px]">
                <div className="flex items-center justify-between text-[11px] font-semibold text-muted-foreground px-0.5">
                  <span>실시간 알림 & 로그</span>
                  {debugLogs.length > 0 && (
                    <button
                      onClick={() => setDebugLogs([])}
                      className="text-[10px] text-muted-foreground hover:text-foreground"
                    >
                      비우기
                    </button>
                  )}
                </div>

                <div className="flex-1 bg-zinc-950/80 rounded-lg border border-border/50 p-2 overflow-y-auto space-y-1 font-mono text-[10px] max-h-72 select-text cursor-text">
                  {debugLogs.length === 0 ? (
                    <div className="text-zinc-500 text-center py-6 select-none">
                      로그가 여기에 실시간으로 표시됩니다
                    </div>
                  ) : (
                    debugLogs.map((log, i) => (
                      <div
                        key={i}
                        className={`leading-relaxed break-all ${
                          log.includes('확인 완료') || log.includes('성공')
                            ? 'text-emerald-400'
                            : log.includes('실패') || log.includes('오류')
                            ? 'text-red-400'
                            : log.includes('클릭')
                            ? 'text-amber-300'
                            : 'text-zinc-300'
                        }`}
                      >
                        {log}
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </aside>
        )}
      </div>

      {/* Auto Queue Quick Settings Dialog */}
      <Dialog open={autoQueueDialogOpen} onOpenChange={setAutoQueueDialogOpen}>
        <DialogContent className="sm:max-w-[380px]">
          <DialogHeader>
            <DialogTitle>자동 연속 대국 설정 (Auto Queue)</DialogTitle>
            <DialogDescription>
              대국 종료 후 인간적인 무작위 텀을 두고 자동으로 재전(동일 룰 대국)을 진행합니다.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2 text-xs">
            <div className="grid gap-1.5">
              <Label htmlFor="aq-max-matches">최대 대국 수 (0 = 무제한)</Label>
              <Input
                id="aq-max-matches"
                type="number"
                min={0}
                value={aqDraft.max_matches}
                onChange={(e) =>
                  setAqDraft({
                    ...aqDraft,
                    max_matches: Math.max(0, parseInt(e.target.value || '0', 10)),
                  })
                }
              />
              <p className="text-[11px] text-muted-foreground">
                설정한 판수를 마치면 자동으로 연속 대국이 종료됩니다.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="aq-min-delay">최소 대기 시간 (초)</Label>
                <Input
                  id="aq-min-delay"
                  type="number"
                  min={3}
                  value={aqDraft.min_delay_sec}
                  onChange={(e) =>
                    setAqDraft({
                      ...aqDraft,
                      min_delay_sec: Math.max(3, parseInt(e.target.value || '3', 10)),
                    })
                  }
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="aq-max-delay">최대 대기 시간 (초)</Label>
                <Input
                  id="aq-max-delay"
                  type="number"
                  min={3}
                  value={aqDraft.max_delay_sec}
                  onChange={(e) =>
                    setAqDraft({
                      ...aqDraft,
                      max_delay_sec: Math.max(3, parseInt(e.target.value || '3', 10)),
                    })
                  }
                />
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground">
              대국 종료 후 위 설정된 범위 내 무작위 초만큼 대기한 뒤 다음 게임을 찾습니다.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setAutoQueueDialogOpen(false)}>
              취소
            </Button>
            <Button size="sm" onClick={() => void saveAutoQueueSettings()}>
              저장
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
