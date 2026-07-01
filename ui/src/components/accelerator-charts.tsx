import { useTranslation } from 'react-i18next'

import { OverviewData } from '@/types/api'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

export interface AcceleratorChartsProps {
  data?: OverviewData['accelerators']
  isLoading: boolean
}

export default function AcceleratorCharts(props: AcceleratorChartsProps) {
  const { t } = useTranslation()
  const { isLoading } = props
  const data = props.data || []

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 gap-4">
        {Array.from({ length: 1 }).map((_, i) => (
          <Card key={i} className="animate-pulse">
            <CardHeader>
              <div className="h-4 bg-muted rounded w-1/3 mb-2"></div>
              <div className="h-6 bg-muted rounded w-1/2"></div>
            </CardHeader>
            <CardContent>
              <div className="h-32 bg-muted rounded"></div>
            </CardContent>
          </Card>
        ))}
      </div>
    )
  }

  if (!data.length) {
    return null
  }

  return (
    <div className="grid grid-cols-1 gap-4">
      {data.map((acc) => {
        const requestPercentage =
          acc.allocatable > 0 ? (acc.requested / acc.allocatable) * 100 : 0
        const limitPercentage =
          acc.allocatable > 0 ? (acc.limited / acc.allocatable) * 100 : 0
        const requestIsHigh = requestPercentage > 90
        const requestIsMedium = requestPercentage > 60
        const limitIsHigh = limitPercentage > 90
        const limitIsMedium = limitPercentage > 60

        return (
          <Card key={acc.name}>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span>{acc.name}</span>
              </CardTitle>
              <CardDescription className="font-mono">
                Requests: {acc.requested} / Limits: {acc.limited} / Total:{' '}
                {acc.allocatable}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                  <div>
                    <div className="flex justify-between text-xs text-muted-foreground mb-1">
                      <span className="font-medium text-blue-600">
                        {t('overview.requests')}
                      </span>
                      <span className="font-mono">{acc.requested}</span>
                    </div>
                    <div className="w-full bg-muted rounded-full h-2">
                      <div
                        className={`h-2 rounded-full transition-all duration-300 ${
                          requestIsHigh
                            ? 'bg-red-500'
                            : requestIsMedium
                              ? 'bg-yellow-500'
                              : 'bg-blue-500'
                        }`}
                        style={{
                          width: `${Math.min(requestPercentage, 100)}%`,
                        }}
                      />
                    </div>
                    <div className="text-xs text-muted-foreground mt-1 font-mono">
                      {requestPercentage.toFixed(1)}% of capacity
                    </div>
                  </div>

                  <div>
                    <div className="flex justify-between text-xs text-muted-foreground mb-1">
                      <span className="font-medium text-orange-600">
                        {t('overview.limits')}
                      </span>
                      <span className="font-mono">{acc.limited}</span>
                    </div>
                    <div className="w-full bg-muted rounded-full h-2">
                      <div
                        className={`h-2 rounded-full transition-all duration-300 ${
                          limitIsHigh
                            ? 'bg-red-500'
                            : limitIsMedium
                              ? 'bg-yellow-500'
                              : 'bg-orange-500'
                        }`}
                        style={{
                          width: `${Math.min(limitPercentage, 100)}%`,
                        }}
                      />
                    </div>
                    <div className="text-xs text-muted-foreground mt-1 font-mono">
                      {limitPercentage.toFixed(1)}% of capacity
                    </div>
                  </div>
                </div>

                <div className="text-xs text-muted-foreground font-mono">
                  {t('overview.available')}: {Math.max(0, acc.allocatable - acc.requested)}
                </div>
              </div>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
