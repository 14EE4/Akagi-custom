import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { platformInfo } from '@/lib/platforms'
import type { PlatformKind } from '@/types'

export function StartUrlField({
  kind,
  value,
  onChange,
  disabled = false,
}: {
  kind: PlatformKind
  value: string
  onChange: (val: string) => void
  disabled?: boolean
}) {
  const { t } = useTranslation()
  const info = platformInfo(kind)
  const presets = info?.presets ?? []

  return (
    <div className="grid gap-2">
      {presets.length > 0 && (
        <div className="grid gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">
            {t('platform.server_region')}
          </span>
          <div className="flex flex-wrap gap-1.5">
            {presets.map((preset) => {
              const active = value.trim() === preset.url.trim()
              return (
                <Button
                  key={preset.id}
                  type="button"
                  size="xs"
                  variant={active ? 'default' : 'outline'}
                  disabled={disabled}
                  onClick={() => onChange(preset.url)}
                  className="text-xs"
                >
                  {t(preset.labelKey)}
                </Button>
              )
            })}
          </div>
        </div>
      )}
      <div className="grid gap-1.5">
        <Label>{t('settings.start_url')}</Label>
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={info?.defaultStartUrl}
          disabled={disabled}
        />
        <span className="text-xs text-muted-foreground">
          {t('settings.start_url_hint', {
            platform: t(info?.labelKey ?? ''),
            url: info?.defaultStartUrl ?? '',
          })}
        </span>
      </div>
    </div>
  )
}
