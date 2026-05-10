import { useState, useEffect, useRef } from 'react'
import { IconChevronRight, IconServer } from '@tabler/icons-react'
import type { Cluster } from '@/types/api'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'

type CategoryGroup = {
  category: string
  clusters: Cluster[]
}

interface ClusterPanelProps {
  clusters: Cluster[]
  onClusterClick: (cluster: Cluster) => void
  currentCluster?: string | null
}

const MAX_CLUSTERS_PER_CATEGORY = 20

export function ClusterPanel({ clusters, onClusterClick, currentCluster }: ClusterPanelProps) {
  const [openCategories, setOpenCategories] = useState<Set<string>>(new Set())
  const isInitialMount = useRef(true)

  const categoryGroups = clusters.reduce((acc, cluster) => {
    const category = cluster.category || 'Uncategorized'
    if (!acc[category]) {
      acc[category] = []
    }
    acc[category].push(cluster)
    return acc
  }, {} as Record<string, Cluster[]>)

  const categoryList: CategoryGroup[] = Object.entries(categoryGroups)
    .map(([category, clusters]) => ({ category, clusters }))
    .sort((a, b) => {
      if (a.category === 'Uncategorized') return 1
      if (b.category === 'Uncategorized') return -1
      return a.category.localeCompare(b.category)
    })

  useEffect(() => {
    if (categoryList.length > 0 && isInitialMount.current) {
      const firstCategory = categoryList[0].category
      setOpenCategories(prev => {
        const next = new Set(prev)
        if (!next.has(firstCategory)) {
          next.add(firstCategory)
        }
        return next
      })
      isInitialMount.current = false
    }
  }, [categoryList])

  const toggleCategory = (category: string, isOpen: boolean) => {
    setOpenCategories((prev) => {
      const next = new Set(prev)
      if (isOpen) {
        next.clear()
        next.add(category)
      } else {
        next.delete(category)
      }
      return next
    })
  }

  if (clusters.length === 0) {
    return (
      <div className="text-center text-muted-foreground py-8">
        No clusters available
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {categoryList.map((group) => (
        <Collapsible
          key={group.category}
          open={openCategories.has(group.category)}
          onOpenChange={(isOpen) => toggleCategory(group.category, isOpen)}
          asChild
        >
          <div className="border rounded-lg overflow-hidden">
            <CollapsibleTrigger className="flex items-center justify-between w-full px-4 py-3 bg-muted/30 hover:bg-muted/50 transition-colors cursor-pointer">
              <div className="flex items-center gap-2">
                <IconChevronRight
                  className={cn(
                    'h-4 w-4 transition-transform shrink-0 text-muted-foreground',
                    openCategories.has(group.category) && 'rotate-90'
                  )}
                />
                <span className="font-medium text-sm">{group.category}</span>
              </div>
              <Badge variant="outline" className="text-xs h-5 px-1.5 shrink-0">
                {group.clusters.length}
              </Badge>
            </CollapsibleTrigger>
            <CollapsibleContent className="divide-y">
              {group.clusters.slice(0, MAX_CLUSTERS_PER_CATEGORY).map((cluster) => (
                <ClusterItem
                  key={cluster.id}
                  cluster={cluster}
                  isActive={currentCluster === cluster.clusterId}
                  onClick={() => onClusterClick(cluster)}
                />
              ))}
              {group.clusters.length > MAX_CLUSTERS_PER_CATEGORY && (
                <div className="px-4 py-2 text-xs text-muted-foreground text-center border-t">
                  Showing {MAX_CLUSTERS_PER_CATEGORY} of {group.clusters.length} clusters
                </div>
              )}
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
      className="flex items-center justify-between gap-2 w-full px-4 py-3 text-sm hover:bg-accent/50 transition-colors text-left group"
    >
      <div className="flex flex-col overflow-hidden flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 overflow-hidden">
            <IconServer className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="font-medium truncate">{cluster.name}</span>
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
            <Badge variant="outline" className="text-xs h-5 px-1.5 shrink-0 bg-primary/10 border-primary/30">
              Active
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2 mt-1">
          <span className="text-xs text-muted-foreground font-mono truncate">
            {cluster.clusterId}
          </span>
          {cluster.pool?.poolName && (
            <span className="text-xs text-muted-foreground truncate">
              Pool: {cluster.pool.poolName}
            </span>
          )}
        </div>
      </div>
    </button>
  )
}
