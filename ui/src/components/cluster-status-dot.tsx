import { cn } from '@/lib/utils'

export type ClusterStatus = 'ready' | 'error' | 'unknown'

interface ClusterStatusDotProps {
  status: ClusterStatus
  className?: string
}

export function getClusterStatus(cluster: { version?: string; error?: string }): ClusterStatus {
  if (cluster.error) return 'error'
  if (cluster.version) return 'ready'
  return 'unknown'
}

const statusConfig: Record<ClusterStatus, { color: string; label: string; animate?: boolean }> = {
  ready: { color: 'bg-green-500 dark:bg-green-400', label: 'Ready', animate: true },
  error: { color: 'bg-red-500 dark:bg-red-400', label: 'Error' },
  unknown: { color: 'bg-gray-400 dark:bg-gray-500', label: 'Unknown' },
}

export function ClusterStatusDot({ status, className }: ClusterStatusDotProps) {
  const config = statusConfig[status]
  return (
    <span
      className={cn(
        'inline-block h-2.5 w-2.5 rounded-full shrink-0',
        config.color,
        config.animate && 'breathing-indicator',
        className
      )}
      title={config.label}
      aria-label={config.label}
    />
  )
}