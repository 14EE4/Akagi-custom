import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Globe, Check, AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useConfigStore } from '@/stores/configStore'
import { useCaptureStore } from '@/stores/captureStore'
import { platformInfo } from '@/lib/platforms'
import { HAS_TAURI, invoke } from '@/lib/tauri'

interface ServerSelectorProps {
  variant?: 'header' | 'button-group' | 'full'
  disabled?: boolean
  className?: string
}

export function ServerSelector({ variant = 'header', disabled = false, className = '' }: ServerSelectorProps) {
  const { t } = useTranslation()
  const config = useConfigStore((s) => s.config)
  const setConfig = useConfigStore((s) => s.setConfig)
  const captureStatus = useCaptureStore((s) => s.status)

  const [confirmOpen, setConfirmOpen] = useState(false)
  const [pendingUrl, setPendingUrl] = useState<string | null>(null)
  const [pendingLabel, setPendingLabel] = useState<string>('')

  const info = platformInfo('Majsoul')
  const presets = info?.presets ?? []

  const currentUrl = config?.capture?.chromium?.start_url ?? info?.defaultStartUrl ?? ''
  const activePreset = presets.find((p) => p.url.trim() === currentUrl.trim())

  const handleSelectServer = async (presetUrl: string, presetLabelKey: string) => {
    if (presetUrl.trim() === currentUrl.trim()) return

    const isRunning = captureStatus.state === 'running'
    const label = t(presetLabelKey)

    if (isRunning) {
      setPendingUrl(presetUrl)
      setPendingLabel(label)
      setConfirmOpen(true)
      return
    }

    await applyServerChange(presetUrl, label, false)
  }

  const applyServerChange = async (url: string, label: string, shouldRestart: boolean) => {
    if (!config) return
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
      try {
        await invoke('update_config', { newConfig: nextConfig })
        if (shouldRestart) {
          await invoke('restart_capture')
          toast.success(`접속 서버를 [${label}]로 변경하고 브라우저를 재시작했습니다.`)
        } else {
          toast.success(`접속 서버가 [${label}]로 설정되었습니다.`)
        }
      } catch (err: any) {
        toast.error(`서버 설정 실패: ${err?.message || err}`)
      }
    }
  }

  const handleConfirmSwitch = async () => {
    if (pendingUrl) {
      await applyServerChange(pendingUrl, pendingLabel, true)
    }
    setConfirmOpen(false)
    setPendingUrl(null)
  }

  if (variant === 'button-group') {
    return (
      <div className={`flex flex-wrap gap-1.5 ${className}`}>
        {presets.map((preset) => {
          const active = currentUrl.trim() === preset.url.trim()
          return (
            <Button
              key={preset.id}
              type="button"
              size="sm"
              variant={active ? 'default' : 'outline'}
              disabled={disabled}
              onClick={() => void handleSelectServer(preset.url, preset.labelKey)}
              className={`text-xs h-7 px-2.5 transition-all ${
                active ? 'font-semibold shadow-xs' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {active && <Check className="h-3.5 w-3.5 mr-1" />}
              {t(preset.labelKey)}
            </Button>
          )
        })}

        <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <div className="flex items-center gap-2 text-amber-500">
                <AlertTriangle className="h-5 w-5" />
                <DialogTitle>{t('platform.server_change_confirm_title')}</DialogTitle>
              </div>
              <DialogDescription className="pt-2">
                접속 서버를 <b className="text-foreground">[{pendingLabel}]</b>(으)로 변경하시겠습니까?
                <br />
                작혼 브라우저가 새 서버로 다시 시작됩니다.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button variant="ghost" onClick={() => setConfirmOpen(false)}>
                취소
              </Button>
              <Button onClick={() => void handleConfirmSwitch()}>
                서버 변경 및 재시작
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    )
  }

  // Header compact dropdown variant
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            disabled={disabled}
            className={`h-7 text-xs px-2.5 gap-1.5 border-border bg-card/60 hover:bg-accent ${className}`}
            title="접속할 작혼 서버(지역) 선택"
          >
            <Globe className="h-3.5 w-3.5 text-primary" />
            <span className="font-medium">
              {activePreset ? t(activePreset.labelKey) : '서버 선택'}
            </span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuLabel className="text-xs text-muted-foreground font-normal">
            {t('platform.server_select')} (작혼)
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {presets.map((preset) => {
            const active = currentUrl.trim() === preset.url.trim()
            return (
              <DropdownMenuItem
                key={preset.id}
                onClick={() => void handleSelectServer(preset.url, preset.labelKey)}
                className="flex items-center justify-between text-xs cursor-pointer py-1.5"
              >
                <div className="flex items-center gap-2">
                  <span className={active ? 'font-semibold text-primary' : ''}>
                    {t(preset.labelKey)}
                  </span>
                </div>
                {active && <Check className="h-3.5 w-3.5 text-primary" />}
              </DropdownMenuItem>
            )
          })}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <div className="flex items-center gap-2 text-amber-500">
              <AlertTriangle className="h-5 w-5" />
              <DialogTitle>{t('platform.server_change_confirm_title')}</DialogTitle>
            </div>
            <DialogDescription className="pt-2">
              접속 서버를 <b className="text-foreground">[{pendingLabel}]</b>(으)로 변경하시겠습니까?
              <br />
              작혼 브라우저가 새 서버로 다시 시작됩니다.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="ghost" onClick={() => setConfirmOpen(false)}>
              취소
            </Button>
            <Button onClick={() => void handleConfirmSwitch()}>
              서버 변경 및 재시작
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
