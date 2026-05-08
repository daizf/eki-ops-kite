import { IconCheck, IconServer } from '@tabler/icons-react'
import { useState } from 'react'

import type { Cluster } from '@/types/api'
import { cn } from '@/lib/utils'
import { useCluster } from '@/hooks/use-cluster'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'

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
            Switching cluster...
          </span>
        )}
      </div>
    )
  }

  const currentClusterData = clusters.find((c) => c.clusterId === currentCluster)

  const filteredClusters = clusters.filter((cluster) => {
    if (!searchQuery.trim()) return true
    const query = searchQuery.toLowerCase()
    return (
      cluster.name?.toLowerCase().includes(query) ||
      cluster.clusterId?.toLowerCase().includes(query)
    )
  })

  const defaultClusters = filteredClusters.filter((c) => c.isDefault)
  const regularClusters = filteredClusters.filter((c) => !c.isDefault)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="flex items-center gap-2 h-8 px-3 max-w-full focus-visible:ring-0 focus-visible:border-transparent"
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
      <PopoverContent className="w-80 p-0" align="end">
        <Command>
          <CommandInput
            placeholder="Search cluster by name or ID..."
            value={searchQuery}
            onValueChange={setSearchQuery}
          />
          <CommandList>
            {filteredClusters.length === 0 ? (
              <CommandEmpty>No clusters found</CommandEmpty>
            ) : (
              <>
                {defaultClusters.length > 0 && (
                  <>
                    <CommandGroup
                      heading={
                        searchQuery.trim()
                          ? `Default Clusters (${defaultClusters.length})`
                          : 'Default Clusters'
                      }
                    >
                      {defaultClusters.map((cluster) => (
                        <ClusterMenuItem
                          key={cluster.clusterId}
                          cluster={cluster}
                          currentCluster={currentCluster}
                          onSelect={() => {
                            setCurrentCluster(cluster.clusterId)
                            setOpen(false)
                            setSearchQuery('')
                          }}
                        />
                      ))}
                    </CommandGroup>
                    {regularClusters.length > 0 && <CommandSeparator />}
                  </>
                )}
                {regularClusters.length > 0 && (
                  <CommandGroup
                    heading={
                      searchQuery.trim()
                        ? `Clusters (${regularClusters.length})`
                        : 'Clusters'
                    }
                  >
                    {regularClusters.map((cluster) => (
                      <ClusterMenuItem
                        key={cluster.clusterId}
                        cluster={cluster}
                        currentCluster={currentCluster}
                        onSelect={() => {
                          setCurrentCluster(cluster.clusterId)
                          setOpen(false)
                          setSearchQuery('')
                        }}
                      />
                    ))}
                  </CommandGroup>
                )}
              </>
            )}
          </CommandList>
        </Command>
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
    <CommandItem
      onSelect={onSelect}
      disabled={hasError}
      className="flex items-center justify-between gap-2 cursor-pointer"
    >
      <div className="flex flex-col overflow-hidden flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium truncate">{cluster.name}</span>
          {cluster.isDefault && (
            <Badge variant="secondary" className="text-xs shrink-0">
              Default
            </Badge>
          )}
          {hasError && (
            <Badge variant="destructive" className="text-xs shrink-0">
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
        {cluster.version && !hasError && (
          <span className="text-xs text-muted-foreground">
            {cluster.version}
          </span>
        )}
      </div>
      {isSelected && <IconCheck className="h-4 w-4 shrink-0" />}
    </CommandItem>
  )
}
