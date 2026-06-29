import { useState } from 'react'
import { IconCheck, IconSearch, IconServer } from '@tabler/icons-react'

import type { Cluster } from '@/types/api'
import { cn } from '@/lib/utils'
import { useCluster } from '@/hooks/use-cluster'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  ClusterStatusDot,
  getClusterStatus,
} from '@/components/cluster-status-dot'

export function ClusterSelector() {
  const {
    clusters,
    currentCluster,
    setCurrentCluster,
    isSwitching,
    isLoading,
  } = useCluster()
  const [open, setOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')

  if (isLoading || isSwitching) {
    return (
      <div className="flex items-center justify-center">
        <div className="h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-blue-600" />
        {isSwitching && (
          <span className="ml-2 text-sm text-muted-foreground">
            Switching...
          </span>
        )}
      </div>
    )
  }

  const currentClusterData = clusters.find(
    (c) => c.clusterId === currentCluster
  )

  const filteredClusters = clusters.filter((cluster) => {
    if (!searchQuery.trim()) return true
    const query = searchQuery.toLowerCase()
    return (
      cluster.name?.toLowerCase().includes(query) ||
      cluster.clusterId?.toLowerCase().includes(query) ||
      cluster.pool?.poolName?.toLowerCase().includes(query) ||
      cluster.category?.toLowerCase().includes(query)
    )
  })

  const peerClusters = currentClusterData
    ? filteredClusters.filter((c) => {
        const samePool =
          (c.poolId || 'no-pool') === (currentClusterData.poolId || 'no-pool')
        const sameCategory =
          (c.category || 'Uncategorized') ===
          (currentClusterData.category || 'Uncategorized')
        return samePool && sameCategory
      })
    : filteredClusters

  const handleClusterSelect = (clusterId: string) => {
    setCurrentCluster(clusterId)
    setOpen(false)
    setSearchQuery('')
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="flex items-center gap-2 h-9 px-3 max-w-[200px] focus-visible:ring-0 focus-visible:border-transparent"
          disabled={isSwitching}
        >
          <IconServer className="h-4 w-4" />
          <span className="text-sm font-medium truncate">
            {isSwitching
              ? 'Switching...'
              : currentClusterData?.name || 'Select Cluster'}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[360px] p-0" align="end">
        <div className="flex flex-col max-h-[500px]">
          {/* Search input */}
          <div className="border-b px-3 py-2 flex items-center gap-2">
            <IconSearch className="h-4 w-4 text-muted-foreground shrink-0" />
            <input
              type="text"
              placeholder="Search cluster by name or ID..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="flex-1 text-sm outline-none bg-transparent placeholder:text-muted-foreground"
            />
          </div>

          {/* Cluster list */}
          <div className="overflow-auto flex-1">
            {peerClusters.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                No clusters found
              </div>
            ) : (
              <div className="py-1">
                {peerClusters.map((cluster) => (
                  <ClusterMenuItem
                    key={cluster.clusterId}
                    cluster={cluster}
                    currentCluster={currentCluster}
                    onSelect={() => handleClusterSelect(cluster.clusterId)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}

function ClusterMenuItem({
  cluster,
  currentCluster,
  onSelect,
}: {
  cluster: Cluster
  currentCluster: string | null
  onSelect: () => void
}) {
  const isSelected = currentCluster === cluster.clusterId
  const hasError = !!cluster.error

  return (
    <button
      onClick={onSelect}
      disabled={hasError}
      className="flex items-center justify-between gap-2 w-full px-3 py-2 text-sm hover:bg-accent/50 disabled:opacity-50 disabled:hover:bg-transparent cursor-pointer transition-colors"
    >
      <div className="flex flex-col overflow-hidden flex-1 min-w-0 text-left">
        <div className="flex items-center gap-2">
          <ClusterStatusDot status={getClusterStatus(cluster)} />
          <span className="font-medium truncate text-sm">{cluster.name}</span>
          {cluster.pool?.poolName && (
            <Badge variant="outline" className="text-xs h-5 px-1.5 shrink-0">
              {cluster.pool.poolName}
            </Badge>
          )}
          {cluster.category && (
            <Badge
              variant="outline"
              className="text-xs h-5 px-1.5 shrink-0 bg-purple-50 text-purple-700 border-purple-200"
            >
              {cluster.category}
            </Badge>
          )}
          {cluster.isDefault && (
            <Badge variant="secondary" className="text-xs h-5 px-1.5 shrink-0">
              Default
            </Badge>
          )}
          {hasError && (
            <Badge
              variant="destructive"
              className="text-xs h-5 px-1.5 shrink-0"
            >
              Sync Error
            </Badge>
          )}
        </div>
        <span
          className={cn(
            'text-xs truncate font-mono',
            hasError ? 'text-red-500' : 'text-muted-foreground'
          )}
          title={hasError ? cluster.error : cluster.clusterId}
        >
          {hasError ? cluster.error : cluster.clusterId}
        </span>
      </div>
      {isSelected && <IconCheck className="h-4 w-4 shrink-0" />}
    </button>
  )
}
