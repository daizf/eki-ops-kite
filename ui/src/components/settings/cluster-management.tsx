import { useCallback, useMemo, useState } from 'react'
import {
  IconEdit,
  IconPlus,
  IconServer,
  IconTrash,
  IconUpload,
} from '@tabler/icons-react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ColumnDef, PaginationState } from '@tanstack/react-table'
import { Search, XCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Cluster } from '@/types/api'
import {
  ClusterCreateRequest,
  ClusterUpdateRequest,
  createCluster,
  deleteCluster,
  updateCluster,
  useClusterList,
} from '@/lib/api'
import { CATEGORIES } from '@/lib/constants'
import { getTagColor } from '@/lib/tags'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  ClusterStatusDot,
  getClusterStatus,
} from '@/components/cluster-status-dot'
import { DeleteConfirmationDialog } from '@/components/delete-confirmation-dialog'

import { Action, ActionTable } from '../action-table'
import { BatchImportDialog } from './batch-import-dialog'
import { ClusterDialog } from './cluster-dialog'

export function ClusterManagement() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()

  const { data: clusters = [], isLoading, error } = useClusterList()

  const [showClusterDialog, setShowClusterDialog] = useState(false)
  const [editingCluster, setEditingCluster] = useState<Cluster | null>(null)
  const [deletingCluster, setDeletingCluster] = useState<Cluster | null>(null)
  const [showBatchImportDialog, setShowBatchImportDialog] = useState(false)
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedPool, setSelectedPool] = useState<string>('')
  const [selectedCategory, setSelectedCategory] = useState<string>('')
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: 20,
  })

  const getPoolDisplayName = useCallback((cluster: Cluster) => {
    return cluster.pool?.poolName || cluster.poolId || ''
  }, [])

  // Get all available tags for filter
  const availableTags = useMemo(() => {
    const tagSet = new Set<string>()
    clusters.forEach((cluster) => {
      cluster.tags?.forEach((tag) => tagSet.add(tag))
    })
    return Array.from(tagSet).sort()
  }, [clusters])

  // Get all available pools for filter
  const availablePools = useMemo(() => {
    const poolSet = new Set<string>()
    clusters.forEach((cluster) => {
      const poolName = getPoolDisplayName(cluster)
      if (poolName) poolSet.add(poolName)
    })
    return Array.from(poolSet).sort()
  }, [clusters, getPoolDisplayName])

  // Filter clusters by search query, pool, category, and selected tags
  const filteredClusters = useMemo(() => {
    let result = clusters

    // Text search: name, clusterId, tags
    const query = searchQuery.trim().toLowerCase()
    if (query) {
      result = result.filter((cluster) => {
        if (cluster.name.toLowerCase().includes(query)) return true
        if (cluster.clusterId.toLowerCase().includes(query)) return true
        if (cluster.tags?.some((tag) => tag.toLowerCase().includes(query))) {
          return true
        }
        return false
      })
    }

    // Pool dropdown filter (exact match on pool display name)
    if (selectedPool) {
      result = result.filter(
        (cluster) => getPoolDisplayName(cluster) === selectedPool
      )
    }

    // Category dropdown filter (exact match)
    if (selectedCategory) {
      result = result.filter((cluster) => cluster.category === selectedCategory)
    }

    // Tag filter (existing — every selected tag must be present)
    if (selectedTags.length > 0) {
      result = result.filter((cluster) => {
        if (!cluster.tags || cluster.tags.length === 0) return false
        return selectedTags.every((tag) => cluster.tags?.includes(tag))
      })
    }

    return result
  }, [
    clusters,
    searchQuery,
    selectedPool,
    selectedCategory,
    selectedTags,
    getPoolDisplayName,
  ])

  const hasActiveFilters =
    !!searchQuery ||
    !!selectedPool ||
    !!selectedCategory ||
    selectedTags.length > 0

  const clearAllFilters = () => {
    setSearchQuery('')
    setSelectedPool('')
    setSelectedCategory('')
    setSelectedTags([])
    setPagination((prev) => ({ ...prev, pageIndex: 0 }))
  }

  // Toggle tag selection
  const toggleTag = (tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    )
  }

  const getClusterTypeBadge = useCallback(
    (cluster: Cluster) => {
      if (cluster.inCluster) {
        return (
          <Badge
            variant="outline"
            className="bg-blue-50 text-blue-700 border-blue-200"
          >
            {t('clusterManagement.type.inCluster', 'In-Cluster')}
          </Badge>
        )
      }
      return (
        <Badge
          variant="outline"
          className="bg-gray-50 text-gray-700 border-gray-200"
        >
          {t('clusterManagement.type.external', 'External')}
        </Badge>
      )
    },
    [t]
  )

  const getStatusBadge = useCallback(
    (cluster: Cluster) => {
      if (!cluster.enabled) {
        return (
          <Badge variant="secondary">{t('status.disabled', 'Disabled')}</Badge>
        )
      }
      return <Badge variant="default">{t('status.enabled', 'Enabled')}</Badge>
    },
    [t]
  )

  const columns = useMemo<ColumnDef<Cluster>[]>(
    () => [
      {
        id: 'name',
        header: t('common.fields.name', 'Name'),
        cell: ({ row: { original: cluster } }) => (
          <div>
            <div className="flex items-center gap-2">
              <ClusterStatusDot status={getClusterStatus(cluster)} />
              <span className="font-medium">{cluster.name}</span>
              {cluster.isDefault && <Badge variant="secondary">Default</Badge>}
            </div>
            {cluster.description && (
              <div className="text-sm text-muted-foreground">
                {cluster.description}
              </div>
            )}
          </div>
        ),
      },
      {
        id: 'clusterId',
        header: t('common.fields.clusterId', 'Cluster ID'),
        cell: ({ row: { original: cluster } }) => (
          <div className="text-sm font-mono text-muted-foreground">
            {cluster.clusterId}
          </div>
        ),
      },
      {
        id: 'version',
        header: t('common.fields.version', 'Version'),
        cell: ({ row: { original: cluster } }) => {
          if (cluster.error) {
            return (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge variant="destructive">Error</Badge>
                </TooltipTrigger>
                <TooltipContent>
                  <p className="max-w-xs break-all">{cluster.error}</p>
                </TooltipContent>
              </Tooltip>
            )
          }
          return (
            <Badge variant="secondary" className="font-mono">
              {cluster.version || '-'}
            </Badge>
          )
        },
      },
      {
        id: 'type',
        header: t('common.fields.type', 'Type'),
        cell: ({ row: { original: cluster } }) => getClusterTypeBadge(cluster),
      },
      {
        id: 'status',
        header: t('common.fields.status', 'Status'),
        cell: ({ row: { original: cluster } }) => (
          <div className="flex items-center gap-3">
            {getStatusBadge(cluster)}
          </div>
        ),
      },
      {
        id: 'Prometheus',
        header: t('common.fields.prometheus', 'Prometheus'),
        cell: ({ row: { original: cluster } }) => (
          <div className="text-sm text-muted-foreground">
            {cluster.prometheusURL ? 'Yes' : 'No'}
          </div>
        ),
      },
      {
        id: 'poolId',
        header: t('common.fields.pool', 'Resource Pool'),
        cell: ({ row: { original: cluster } }) => (
          <div className="text-sm text-muted-foreground">
            {cluster.pool?.poolName || cluster.poolId || '-'}
          </div>
        ),
      },
      {
        id: 'category',
        header: t('common.fields.category', 'Category'),
        cell: ({ row: { original: cluster } }) => (
          <span className="text-sm">{cluster.category || '-'}</span>
        ),
      },
      {
        id: 'tags',
        header: t('common.fields.tags', 'Tags'),
        cell: ({ row: { original: cluster } }) => {
          if (!cluster.tags || cluster.tags.length === 0) return '-'

          const maxDisplay = 3
          const displayedTags = cluster.tags.slice(0, maxDisplay)
          const remainingCount = cluster.tags.length - maxDisplay

          return (
            <div className="flex items-center gap-1 flex-wrap">
              {displayedTags.map((tag, index) => (
                <Badge
                  key={index}
                  variant="outline"
                  className={getTagColor(tag)}
                >
                  {tag}
                </Badge>
              ))}
              {remainingCount > 0 && (
                <Badge variant="secondary" className="text-xs">
                  +{remainingCount}
                </Badge>
              )}
            </div>
          )
        },
      },
    ],
    [getClusterTypeBadge, getStatusBadge, getTagColor, t]
  )

  const actions = useMemo<Action<Cluster>[]>(
    () => [
      {
        label: (
          <>
            <IconEdit className="h-4 w-4" />
            {t('common.actions.edit', 'Edit')}
          </>
        ),
        onClick: (cluster) => {
          setEditingCluster(cluster)
          setShowClusterDialog(true)
        },
      },
      {
        label: (
          <div className="inline-flex items-center gap-2 text-destructive">
            <IconTrash className="h-4 w-4" />
            {t('common.actions.delete', 'Delete')}
          </div>
        ),
        shouldDisable: (cluster) => cluster.isDefault,
        onClick: (cluster) => {
          setDeletingCluster(cluster)
        },
      },
    ],
    [t]
  )

  const createMutation = useMutation({
    mutationFn: createCluster,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cluster-list'] })
      toast.success(
        t('clusterManagement.messages.created', 'Cluster created successfully')
      )
      setShowClusterDialog(false)
    },
    onError: (error: Error) => {
      toast.error(
        error.message ||
          t(
            'clusterManagement.messages.createError',
            'Failed to create cluster'
          )
      )
    },
  })

  // Update cluster mutation
  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: ClusterUpdateRequest }) =>
      updateCluster(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cluster-list'] })
      toast.success(
        t('clusterManagement.messages.updated', 'Cluster updated successfully')
      )
      setShowClusterDialog(false)
      setEditingCluster(null)
    },
    onError: (error: Error) => {
      toast.error(
        error.message ||
          t(
            'clusterManagement.messages.updateError',
            'Failed to update cluster'
          )
      )
    },
  })

  // Delete cluster mutation
  const deleteMutation = useMutation({
    mutationFn: deleteCluster,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cluster-list'] })
      toast.success(
        t('clusterManagement.messages.deleted', 'Cluster deleted successfully')
      )
      setDeletingCluster(null)
    },
    onError: (error: Error) => {
      toast.error(
        error.message ||
          t(
            'clusterManagement.messages.deleteError',
            'Failed to delete cluster'
          )
      )
    },
  })

  const handleSubmitCluster = (clusterData: ClusterCreateRequest) => {
    if (editingCluster) {
      // Update existing cluster - use the form data directly
      updateMutation.mutate({
        id: editingCluster.id,
        data: clusterData,
      })
    } else {
      // Create new cluster
      createMutation.mutate(clusterData)
    }
  }

  const handleDeleteCluster = () => {
    if (!deletingCluster) return
    deleteMutation.mutate(deletingCluster.id)
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="text-muted-foreground">
          {t('common.messages.loading', 'Loading...')}
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="text-destructive">
          {t('clusterManagement.errors.loadFailed', 'Failed to load clusters')}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <IconServer className="h-5 w-5" />
                {t('clusterManagement.title', 'Cluster Management')}
              </CardTitle>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                onClick={() => setShowBatchImportDialog(true)}
                className="gap-2"
              >
                <IconUpload className="h-4 w-4" />
                {t('clusterManagement.actions.batchImport', 'Batch Import')}
              </Button>
              <Button
                onClick={() => {
                  setEditingCluster(null)
                  setShowClusterDialog(true)
                }}
                className="gap-2"
              >
                <IconPlus className="h-4 w-4" />
                {t('clusterManagement.actions.add', 'Add Cluster')}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {/* Search + dropdown filters (one row) + active filter count */}
          <div className="flex items-center gap-2 mb-4 flex-wrap">
            {/* Search input */}
            <div className="relative w-full sm:w-[280px] shrink-0">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder={t(
                  'clusterManagement.filter.searchPlaceholder',
                  'Search by name, cluster ID or tag...'
                )}
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value)
                  setPagination((prev) => ({ ...prev, pageIndex: 0 }))
                }}
                className="w-full pl-9 pr-9"
              />
              {searchQuery && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7"
                  aria-label={t('common.actions.clear', 'Clear')}
                >
                  <XCircle className="h-4 w-4" />
                </Button>
              )}
            </div>

            {/* Pool dropdown */}
            {availablePools.length > 0 && (
              <Select
                value={selectedPool || '__all__'}
                onValueChange={(value) => {
                  setSelectedPool(value === '__all__' ? '' : value)
                  setPagination((prev) => ({ ...prev, pageIndex: 0 }))
                }}
              >
                <SelectTrigger size="sm" className="w-[180px]">
                  <SelectValue
                    placeholder={t(
                      'clusterManagement.filter.allPools',
                      'All Pools'
                    )}
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">
                    {t('clusterManagement.filter.allPools', 'All Pools')}
                  </SelectItem>
                  {availablePools.map((pool) => (
                    <SelectItem key={pool} value={pool}>
                      {pool}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            {/* Category dropdown */}
            <Select
              value={selectedCategory || '__all__'}
              onValueChange={(value) => {
                setSelectedCategory(value === '__all__' ? '' : value)
                setPagination((prev) => ({ ...prev, pageIndex: 0 }))
              }}
            >
              <SelectTrigger size="sm" className="w-[180px]">
                <SelectValue
                  placeholder={t(
                    'clusterManagement.filter.allCategories',
                    'All Categories'
                  )}
                />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">
                  {t(
                    'clusterManagement.filter.allCategories',
                    'All Categories'
                  )}
                </SelectItem>
                {CATEGORIES.map((category) => (
                  <SelectItem key={category} value={category}>
                    {category}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {hasActiveFilters && (
              <Button
                variant="ghost"
                size="sm"
                onClick={clearAllFilters}
                className="h-8 text-xs"
              >
                {t('common.actions.clear', 'Clear')}
              </Button>
            )}

            <div className="ml-auto text-xs text-muted-foreground">
              {t('clusterManagement.filter.summary', {
                shown: filteredClusters.length,
                total: clusters.length,
                defaultValue: 'Showing {{shown}} of {{total}} clusters',
              })}
            </div>
          </div>

          {/* Tag filters (existing) */}
          {availableTags.length > 0 && (
            <div className="flex items-center gap-2 mb-4 flex-wrap">
              <span className="text-sm text-muted-foreground">
                {t('clusterManagement.filter.label', 'Filter by tags')}:
              </span>
              {availableTags.slice(0, 8).map((tag) => (
                <Badge
                  key={tag}
                  variant={selectedTags.includes(tag) ? 'default' : 'outline'}
                  className={`cursor-pointer ${!selectedTags.includes(tag) ? getTagColor(tag) : ''}`}
                  onClick={() => {
                    toggleTag(tag)
                    setPagination((prev) => ({ ...prev, pageIndex: 0 }))
                  }}
                >
                  {tag}
                </Badge>
              ))}
              {availableTags.length > 8 && (
                <span className="text-xs text-muted-foreground">
                  +{availableTags.length - 8} more
                </span>
              )}
            </div>
          )}

          {clusters.length > 0 ? (
            <>
              <ActionTable
                data={filteredClusters}
                columns={columns}
                actions={actions}
                pagination={pagination}
                onPaginationChange={setPagination}
              />
              {filteredClusters.length === 0 && (
                <div className="text-center py-8 text-muted-foreground">
                  <IconServer className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>
                    {t(
                      'clusterManagement.empty.noMatch',
                      'No clusters match the current filters'
                    )}
                  </p>
                  <p className="text-sm mt-1">
                    {t(
                      'clusterManagement.empty.adjustFilters',
                      'Try adjusting your search or filters.'
                    )}
                  </p>
                </div>
              )}
            </>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <IconServer className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>
                {t('clusterManagement.empty.title', 'No clusters configured')}
              </p>
              <p className="text-sm mt-1">
                {t(
                  'clusterManagement.empty.description',
                  'Add your first cluster to get started'
                )}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Cluster Dialog (Add/Edit) */}
      <ClusterDialog
        open={showClusterDialog}
        onOpenChange={(open) => {
          setShowClusterDialog(open)
          if (!open) {
            setEditingCluster(null)
          }
        }}
        cluster={editingCluster}
        onSubmit={handleSubmitCluster}
      />

      {/* Delete Confirmation Dialog */}
      <DeleteConfirmationDialog
        open={!!deletingCluster}
        onOpenChange={() => setDeletingCluster(null)}
        onConfirm={handleDeleteCluster}
        resourceName={deletingCluster?.name || ''}
        resourceType="cluster"
        additionalNote={t(
          'clusterManagement.deleteConfirmation',
          "This action will only remove the current cluster's configuration in kite and will not delete any cluster resources."
        )}
      />

      {/* Batch Import Dialog */}
      <BatchImportDialog
        open={showBatchImportDialog}
        onOpenChange={setShowBatchImportDialog}
      />
    </div>
  )
}
