import { useState } from 'react'
import { IconChevronRight, IconServer } from '@tabler/icons-react'

import type { Cluster } from '@/types/api'
import { getAggTagColor, getTagColor } from '@/lib/tags'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import {
  ClusterStatusDot,
  getClusterStatus,
} from '@/components/cluster-status-dot'

type CategoryGroup = {
  category: string
  clusters: Cluster[]
}

type PoolGroup = {
  poolId: string
  poolName: string
  categories: CategoryGroup[]
  totalClusters: number
}

interface ClusterPanelProps {
  clusters: Cluster[]
  onClusterClick: (cluster: Cluster) => void
  currentCluster?: string | null
}

const MAX_CLUSTERS_PER_CATEGORY = 20

function buildPoolTree(clusters: Cluster[]): PoolGroup[] {
  const poolMap = new Map<
    string,
    { poolName: string; categories: Map<string, Cluster[]> }
  >()

  for (const cluster of clusters) {
    const poolKey = cluster.poolId || 'no-pool'
    const poolName = cluster.pool?.poolName || 'No Pool'
    const category = cluster.category || 'Uncategorized'

    if (!poolMap.has(poolKey)) {
      poolMap.set(poolKey, { poolName, categories: new Map() })
    }
    const entry = poolMap.get(poolKey)!
    const categoryMap = entry.categories
    if (!categoryMap.has(category)) {
      categoryMap.set(category, [])
    }
    categoryMap.get(category)!.push(cluster)
  }

  const poolGroups: PoolGroup[] = []

  for (const [poolId, entry] of poolMap) {
    const categories: CategoryGroup[] = []
    for (const [category, categoryClusters] of entry.categories) {
      categories.push({
        category,
        clusters: [...categoryClusters].sort((a, b) =>
          a.name.localeCompare(b.name)
        ),
      })
    }
    categories.sort((a, b) => {
      if (a.category === 'Uncategorized') return 1
      if (b.category === 'Uncategorized') return -1
      return a.category.localeCompare(b.category)
    })

    poolGroups.push({
      poolId,
      poolName: entry.poolName,
      categories,
      totalClusters: categories.reduce((sum, g) => sum + g.clusters.length, 0),
    })
  }

  poolGroups.sort((a, b) => {
    if (a.poolId === 'no-pool') return 1
    if (b.poolId === 'no-pool') return -1
    return b.totalClusters - a.totalClusters
  })

  return poolGroups
}

export function ClusterPanel({
  clusters,
  onClusterClick,
  currentCluster,
}: ClusterPanelProps) {
  const [openKeys, setOpenKeys] = useState<Set<string>>(new Set())
  const [visibleCounts, setVisibleCounts] = useState<Record<string, number>>({})

  const poolGroups = buildPoolTree(clusters)

  const toggleKey = (key: string) => {
    setOpenKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }

  const getVisibleCount = (key: string) =>
    visibleCounts[key] ?? MAX_CLUSTERS_PER_CATEGORY

  const showMore = (key: string) =>
    setVisibleCounts((prev) => ({
      ...prev,
      [key]:
        (prev[key] ?? MAX_CLUSTERS_PER_CATEGORY) + MAX_CLUSTERS_PER_CATEGORY,
    }))

  if (clusters.length === 0) {
    return (
      <div className="text-center text-muted-foreground py-8">
        No clusters available
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {poolGroups.map((pool) => (
        <Collapsible
          key={pool.poolId}
          open={openKeys.has(pool.poolId)}
          onOpenChange={() => toggleKey(pool.poolId)}
          asChild
        >
          <div className="border rounded-lg overflow-hidden">
            <CollapsibleTrigger className="flex items-center justify-between w-full px-4 py-3 bg-muted/30 hover:bg-muted/50 transition-colors cursor-pointer">
              <div className="flex items-center gap-2">
                <IconChevronRight
                  className={cn(
                    'h-4 w-4 transition-transform shrink-0 text-muted-foreground',
                    openKeys.has(pool.poolId) && 'rotate-90'
                  )}
                />
                <span className="font-semibold text-sm">{pool.poolName}</span>
              </div>
              <Badge variant="outline" className="text-xs h-5 px-1.5 shrink-0">
                {pool.totalClusters}
              </Badge>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="ml-4 border-l-2 border-muted-foreground/20">
                {pool.categories.map((categoryGroup) => {
                  const categoryKey = `${pool.poolId}::${categoryGroup.category}`
                  return (
                    <Collapsible
                      key={categoryKey}
                      open={openKeys.has(categoryKey)}
                      onOpenChange={() => toggleKey(categoryKey)}
                      asChild
                    >
                      <div>
                        <CollapsibleTrigger className="flex items-center justify-between w-full pl-8 pr-4 py-2 text-sm hover:bg-accent/50 transition-colors cursor-pointer">
                          <div className="flex items-center gap-2">
                            <IconChevronRight
                              className={cn(
                                'h-3.5 w-3.5 transition-transform shrink-0 text-muted-foreground',
                                openKeys.has(categoryKey) && 'rotate-90'
                              )}
                            />
                            <span className="text-muted-foreground font-medium">
                              {categoryGroup.category}
                            </span>
                          </div>
                          <Badge
                            variant="outline"
                            className="text-xs h-5 px-1.5 shrink-0"
                          >
                            {categoryGroup.clusters.length}
                          </Badge>
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          <div className="ml-4 border-l-2 border-muted-foreground/15">
                            <div className="divide-y">
                              {categoryGroup.clusters
                                .slice(0, getVisibleCount(categoryKey))
                                .map((cluster) => (
                                  <ClusterItem
                                    key={cluster.id}
                                    cluster={cluster}
                                    isActive={
                                      currentCluster === cluster.clusterId
                                    }
                                    onClick={() => onClusterClick(cluster)}
                                  />
                                ))}
                              {categoryGroup.clusters.length >
                                getVisibleCount(categoryKey) && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    showMore(categoryKey)
                                  }}
                                  className="pl-6 pr-4 py-2 text-xs text-primary w-full text-left hover:underline"
                                >
                                  Show more (
                                  {categoryGroup.clusters.length -
                                    getVisibleCount(categoryKey)}{' '}
                                  remaining)
                                </button>
                              )}
                            </div>
                          </div>
                        </CollapsibleContent>
                      </div>
                    </Collapsible>
                  )
                })}
              </div>
            </CollapsibleContent>
          </div>
        </Collapsible>
      ))}
    </div>
  )
}

function ClusterItem({
  cluster,
  isActive,
  onClick,
}: {
  cluster: Cluster
  isActive: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="flex items-center justify-between gap-2 w-full pl-10 pr-4 py-2.5 text-sm hover:bg-accent/50 transition-colors text-left group"
    >
      <div className="flex items-center gap-1.5 flex-1 min-w-0">
        <ClusterStatusDot status={getClusterStatus(cluster)} />
        <IconServer className="h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="flex flex-col min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="font-medium whitespace-nowrap">
              {cluster.name}
            </span>
            <span className="text-xs text-muted-foreground font-mono truncate opacity-0 group-hover:opacity-100 transition-opacity">
              {cluster.clusterId}
            </span>
          </div>
          {((cluster.tags && cluster.tags.length > 0) ||
            (cluster.aggTags && cluster.aggTags.length > 0)) && (
            <div className="flex items-center gap-1 mt-0.5 flex-wrap">
              {cluster.tags?.slice(0, 3).map((tag, i) => (
                <Badge
                  key={`t-${i}`}
                  variant="outline"
                  className={`text-[10px] h-4 px-1 ${getTagColor(tag)}`}
                >
                  {tag}
                </Badge>
              ))}
              {cluster.tags && cluster.tags.length > 3 && (
                <Badge variant="secondary" className="text-[10px] h-4 px-1">
                  +{cluster.tags.length - 3}
                </Badge>
              )}
              {cluster.aggTags?.slice(0, 3).map((tag, i) => (
                <Badge
                  key={`c-${i}`}
                  variant="outline"
                  className={`text-[10px] h-4 px-1 ${getAggTagColor(tag)}`}
                >
                  {tag}
                </Badge>
              ))}
              {cluster.aggTags && cluster.aggTags.length > 3 && (
                <Badge variant="secondary" className="text-[10px] h-4 px-1">
                  +{cluster.aggTags.length - 3}
                </Badge>
              )}
            </div>
          )}
        </div>
      </div>
      {cluster.isDefault && (
        <Badge variant="secondary" className="text-xs h-5 px-1.5 shrink-0">
          Default
        </Badge>
      )}
      {cluster.error && (
        <Badge variant="destructive" className="text-xs h-5 px-1.5 shrink-0">
          Error
        </Badge>
      )}
      {isActive && (
        <Badge
          variant="outline"
          className="text-xs h-5 px-1.5 shrink-0 bg-primary/10 border-primary/30"
        >
          Active
        </Badge>
      )}
    </button>
  )
}
