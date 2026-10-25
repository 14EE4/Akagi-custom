import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Globe, Check, AlertTriangle, RotateCcw, X, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { useConfigStore } from '@/stores/configStore'
import { useCaptureStore } from '@/stores/captureStore'
import { platformInfo } from '@/lib/platforms'
import { HAS_TAURI, invoke } from '@/lib/tauri'

interface ServerSelectorProps {
  variant?: 'header' | 'button-group' | 'compact'
  disabled?: boolean
  className?: string
  isBrowserActive?: boolean
  onBusyChange?: (busy: boolean) => void
}

const PRESET_SHORT_NAMES: Record<string, string> = {
  jp: '일섭 (JP)',
  kr: '한섭 (KR)',
  en: '글섭 (EN)',
  cn: '중섭 (CN)',
}

export function ServerSelector({
  variant = 'header',
  disabled = false,
  className = '',
  isBrowserActive,
  onBusyChange,
}: ServerSelectorProps) {
  const { t } = useTranslation()
  const config = useConfigStore((s) => s.config)
  const setConfig = useConfigStore((s) => s.setConfig)
  const captureStatus = useCaptureStore((s) => s.status)

  // Inline confirmation state for when browser is already running
  // Avoids popup/dialog which gets occluded behind native Win32 Chromium window
  const [pendingPreset, setPendingPreset] = useState<{ url: string; label: string } | null>(null)
  const [isSwitching, setIsSwitching] = useState(false)

  const info = platformInfo('Majsoul')
  const presets = info?.presets ?? []

  const currentUrl = config?.capture?.chromium?.start_url ?? info?.defaultStartUrl ?? ''

  const effectiveRunning =
    isBrowserActive ?? (captureStatus.state === 'running' || captureStatus.state === 'starting')

  const handleSelectServer = async (presetUrl: string, presetLabelKey: string) => {
    if (disabled || isSwitching) return
    if (presetUrl.trim() === currentUrl.trim()) {
      setPendingPreset(null)
      return
    }

    const label = t(presetLabelKey)

    if (effectiveRunning) {
      setPendingPreset({ url: presetUrl, label })
      return
    }

    await applyServerChange(presetUrl, label, false)
  }

  const applyServerChange = async (url: string, label: string, shouldRestart: boolean) => {
    if (!config || isSwitching) return
    setIsSwitching(true)
    onBusyChange?.(true)

    try {
      const nextConfig = {
        ...config,
        capture: {
          ...config.capture,
          chromium: {
            ...config.capture.chromium,
            start_url: url,
          },
        },
      }
      setConfig(nextConfig)

      if (HAS_TAURI) {
        await invoke('update_config', { newConfig: nextConfig })
        if (shouldRestart) {
          await invoke('restart_capture')
          toast.success(`접속 서버를 [${label}]로 변경하고 브라우저를 재시작했습니다.`)
        } else {
          toast.success(`접속 서버가 [${label}]로 설정되었습니다.`)
        }
      }
    } catch (err: any) {
      toast.error(`서버 설정 실패: ${err?.message || err}`)
    } finally {
      setPendingPreset(null)
      // Small cooldown to let backend process spawn and status update arrive
      setTimeout(() => {
        setIsSwitching(false)
        onBusyChange?.(false)
      }, 1500)
    }
  }

  const handleConfirmSwitch = async () => {
    if (pendingPreset && !isSwitching && !disabled) {
      await applyServerChange(pendingPreset.url, pendingPreset.label, true)
    }
  }

  const isControlDisabled = disabled || isSwitching

  // Full-size button group for the pre-launch central card
  if (variant === 'button-group') {
    return (
      <div className={`grid grid-cols-2 sm:grid-cols-4 gap-2 ${className}`}>
        {presets.map((preset) => {
          const active = currentUrl.trim() === preset.url.trim()
          return (
            <Button
              key={preset.id}
              type="button"
              size="default"
              variant={active ? 'default' : 'outline'}
              disabled={isControlDisabled}
              onClick={() => void handleSelectServer(preset.url, preset.labelKey)}
              className={`h-11 px-3 flex flex-col items-center justify-center gap-0.5 transition-all text-xs ${
                active
                  ? 'font-bold bg-primary text-primary-foreground border-primary shadow-sm'
                  : 'text-muted-foreground hover:text-foreground border-border hover:border-border/80'
              }`}
            >
              <div className="flex items-center gap-1.5 font-semibold">
                {active && <Check className="h-3.5 w-3.5" />}
                <span>{PRESET_SHORT_NAMES[preset.id] || preset.id.toUpperCase()}</span>
              </div>
              <span className="text-[10px] opacity-75 font-normal truncate max-w-full">
                {t(preset.labelKey)}
              </span>
            </Button>
          )
        })}
      </div>
    )
  }

  // Header inline segment bar - rendered strictly inside header (h-11)
  // Completely immune to being occluded by Chromium's native window!
  return (
    <div className={`flex items-center gap-1.5 ${className}`}>
      {isSwitching ? (
        <div className="flex items-center gap-1.5 bg-muted/70 border border-border px-2.5 py-1 rounded-md text-xs text-muted-foreground animate-pulse">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
          <span className="font-medium text-[11px]">서버 전환 및 재시작 중…</span>
        </div>
      ) : pendingPreset ? (
        <div className="flex items-center gap-1.5 bg-amber-500/15 border border-amber-500/40 px-2 py-0.5 rounded-md text-xs animate-in fade-in duration-150">
          <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0" />
          <span className="text-amber-500 font-medium">
            [{pendingPreset.label}] 변경?
          </span>
          <Button
            size="sm"
            className="h-6 text-[11px] px-2 bg-amber-500 hover:bg-amber-600 text-black font-semibold gap-1"
            onClick={() => void handleConfirmSwitch()}
            disabled={isControlDisabled}
          >
            <RotateCcw className="h-3 w-3" />
            재시작
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
            onClick={() => setPendingPreset(null)}
            disabled={isControlDisabled}
            title="취소"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-0.5 bg-muted/60 p-0.5 rounded-md border border-border/60">
          <span className="text-[11px] text-muted-foreground px-1.5 font-medium flex items-center gap-1">
            <Globe className="h-3 w-3 text-primary" />
            <span className="hidden sm:inline">서버:</span>
          </span>
          {presets.map((preset) => {
            const active = currentUrl.trim() === preset.url.trim()
            const shortName = PRESET_SHORT_NAMES[preset.id] || preset.id.toUpperCase()
            return (
              <Button
                key={preset.id}
                type="button"
                size="sm"
                variant={active ? 'default' : 'ghost'}
                disabled={isControlDisabled}
                onClick={() => void handleSelectServer(preset.url, preset.labelKey)}
                className={`h-6 text-[11px] px-2 font-medium transition-all ${
                  active
                    ? 'bg-primary text-primary-foreground shadow-xs font-bold'
                    : 'text-muted-foreground hover:text-foreground hover:bg-background/80'
                }`}
                title={t(preset.labelKey)}
              >
                {shortName}
              </Button>
            )
          })}
        </div>
      )}
    </div>
  )
}
