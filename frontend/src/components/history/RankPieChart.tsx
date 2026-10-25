// Rank-distribution pie chart. One slice per rank (3 for sanma-only, 4
// otherwise). Uses Tailwind CSS variables for chart colour tokens to
// match the existing theme.

import { useTranslation } from 'react-i18next'
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'

const COLORS = [
  'var(--color-chart-1, #38bdf8)',
  'var(--color-chart-2, #34d399)',
  'var(--color-chart-3, #fbbf24)',
  'var(--color-chart-4, #f87171)',
]

export function RankPieChart({ counts }: { counts: number[] }) {
  const { t } = useTranslation()
  const total = counts.reduce((a, b) => a + b, 0)

  if (total === 0) {
    return (
      <div className="text-sm text-muted-foreground py-12 text-center">
        {t('history.no_data')}
      </div>
    )
  }

  const data = counts.map((value, i) => ({
    name: t(`history.stat.rank${i + 1}`),
    value,
    pct: ((value / total) * 100).toFixed(1),
  }))

  return (
    <div className="h-64 w-full min-w-0 min-h-[256px]">
      <ResponsiveContainer width="100%" height={256} minWidth={0}>
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            cx="50%"
            cy="50%"
            outerRadius={88}
            innerRadius={48}
            paddingAngle={2}
            label={(props) => {
              const p = props as unknown as { name?: string; pct?: string }
              return `${p.name ?? ''} ${p.pct ?? ''}%`
            }}
          >
            {data.map((_, i) => (
              <Cell key={i} fill={COLORS[i % COLORS.length]} />
            ))}
          </Pie>
          <Tooltip
            contentStyle={{
              background: 'var(--color-popover, #18181b)',
              border: '1px solid var(--color-border, #27272a)',
              borderRadius: 8,
              color: 'var(--color-popover-foreground, #f4f4f5)',
            }}
            formatter={(value, name, ctx) => {
              const pct = (ctx as unknown as { payload?: { pct?: string } })
                ?.payload?.pct
              return [`${value} (${pct ?? '?'}%)`, String(name)]
            }}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  )
}
