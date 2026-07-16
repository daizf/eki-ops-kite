import { useMemo } from 'react'
import { IconCalendarPlus, IconChartBar } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts'

import { Cluster } from '@/types/api'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart'

interface ClusterStatsPanelProps {
  clusters: Cluster[]
}

const chartConfig = {
  existing: {
    label: 'Existing',
    theme: {
      light: 'hsl(220, 70%, 50%)',
      dark: 'hsl(210, 80%, 60%)',
    },
  },
  recent: {
    label: 'New (7d)',
    theme: {
      light: 'hsl(142, 70%, 45%)',
      dark: 'hsl(150, 80%, 55%)',
    },
  },
} satisfies ChartConfig

export function ClusterStatsPanel({ clusters }: ClusterStatsPanelProps) {
  const { t } = useTranslation()

  const { categoryData, recentCount, sizeCounts } = useMemo(() => {
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000
    let recent = 0

    const categoryMap = new Map<string, { existing: number; recent: number }>()
    const sizeMap = new Map<string, number>()
    for (const cluster of clusters) {
      const category =
        cluster.category ||
        t('clusterSearch.stats.uncategorized', 'Uncategorized')
      const createdAt = new Date(cluster.createdAt).getTime()
      const isRecent = createdAt > sevenDaysAgo
      if (isRecent) recent++

      const entry = categoryMap.get(category) || { existing: 0, recent: 0 }
      if (isRecent) {
        entry.recent++
      } else {
        entry.existing++
      }
      categoryMap.set(category, entry)

      if (cluster.aggTags) {
        for (const tag of cluster.aggTags) {
          if (['small', 'medium', 'large', 'xlarge'].includes(tag)) {
            sizeMap.set(tag, (sizeMap.get(tag) || 0) + 1)
          }
        }
      }
    }

    const data = Array.from(categoryMap.entries())
      .map(([category, counts]) => ({
        category,
        existing: counts.existing,
        recent: counts.recent,
        total: counts.existing + counts.recent,
      }))
      .sort((a, b) => b.total - a.total)

    return { categoryData: data, recentCount: recent, sizeCounts: sizeMap }
  }, [clusters, t])

  if (clusters.length === 0) return null

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <IconChartBar className="h-4 w-4" />
          {t('clusterSearch.stats.title', 'Cluster Statistics')}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-4 flex-wrap">
          <Badge variant="outline" className="gap-1.5 text-sm">
            <IconCalendarPlus className="h-3.5 w-3.5 text-green-600" />
            {t('clusterSearch.stats.recent7d', 'New (7 days)')}
            <span className="font-bold tabular-nums">{recentCount}</span>
          </Badge>
          <Badge variant="secondary" className="text-sm">
            {t('clusterSearch.availableCount', { count: clusters.length })}
          </Badge>
        </div>

        <ChartContainer config={chartConfig} className="h-[160px] w-full">
          <BarChart
            data={categoryData}
            layout="vertical"
            margin={{ left: 10, right: 10, top: 5, bottom: 5 }}
          >
            <CartesianGrid horizontal={false} />
            <XAxis
              type="number"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
            />
            <YAxis
              type="category"
              dataKey="category"
              tickLine={false}
              axisLine={false}
              width={100}
              tick={{ fontSize: 12 }}
            />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  labelFormatter={(_, payload) => {
                    const item = payload?.[0]?.payload
                    return item ? `${item.category} (${item.total})` : ''
                  }}
                />
              }
            />
            <Bar
              dataKey="existing"
              stackId="clusters"
              fill="var(--color-existing)"
              radius={[0, 0, 4, 4]}
            />
            <Bar
              dataKey="recent"
              stackId="clusters"
              fill="var(--color-recent)"
              radius={[4, 4, 0, 0]}
            />
          </BarChart>
        </ChartContainer>

        {sizeCounts.size > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm text-muted-foreground">
              {t('clusterSearch.stats.bySize', 'By Size')}:
            </span>
            {(['small', 'medium', 'large', 'xlarge'] as const).map((size) => {
              const count = sizeCounts.get(size) || 0
              if (count === 0) return null
              return (
                <Badge key={size} variant="outline" className="text-xs">
                  {t(`clusterSearch.size.${size}`, size)}
                  <span className="font-bold tabular-nums ml-1">{count}</span>
                </Badge>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
