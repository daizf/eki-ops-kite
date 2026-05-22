import { useCallback, useMemo, useState } from 'react'
import { IconEdit, IconPlus, IconServer, IconTrash, IconUpload } from '@tabler/icons-react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ColumnDef } from '@tanstack/react-table'
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
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { DeleteConfirmationDialog } from '@/components/delete-confirmation-dialog'

import { Action, ActionTable } from '../action-table'
import { ClusterDialog } from './cluster-dialog'
import { BatchImportDialog } from './batch-import-dialog'
import { getTagColor } from '@/lib/tags'

export function ClusterManagement() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()

  const { data: clusters = [], isLoading, error } = useClusterList()

  const [showClusterDialog, setShowClusterDialog] = useState(false)
  const [editingCluster, setEditingCluster] = useState<Cluster | null>(null)
  const [deletingCluster, setDeletingCluster] = useState<Cluster | null>(null)
  const [showBatchImportDialog, setShowBatchImportDialog] = useState(false)
  const [selectedTags, setSelectedTags] = useState<string[]>([])

  // Get all available tags for filter
  const availableTags = useMemo(() => {
    const tagSet = new Set<string>()
    clusters.forEach((cluster) => {
      cluster.tags?.forEach((tag) => tagSet.add(tag))
    })
    return Array.from(tagSet).sort()
  }, [clusters])

  // Filter clusters by selected tags
  const filteredClusters = useMemo(() => {
    if (selectedTags.length === 0) return clusters
    return clusters.filter((cluster) => {
      if (!cluster.tags || cluster.tags.length === 0) return false
      return selectedTags.every((tag) => cluster.tags?.includes(tag))
    })
  }, [clusters, selectedTags])

  // Toggle tag selection
  const toggleTag = (tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    )
  }

  // Clear all tag filters
  const clearTagFilters = () => {
    setSelectedTags([])
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
                <Badge key={index} variant="outline" className={getTagColor(tag)}>
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
          {availableTags.length > 0 && (
            <div className="flex items-center gap-4 mb-4 flex-wrap">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm text-muted-foreground">
                  {t('clusterManagement.filter.label', 'Filter by tags')}:
                </span>
                {availableTags.slice(0, 8).map((tag) => (
                  <Badge
                    key={tag}
                    variant={selectedTags.includes(tag) ? 'default' : 'outline'}
                    className={`cursor-pointer ${!selectedTags.includes(tag) ? getTagColor(tag) : ''}`}
                    onClick={() => toggleTag(tag)}
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
              {selectedTags.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={clearTagFilters}
                  className="h-7 text-xs"
                >
                  {t('common.actions.clear', 'Clear')}
                </Button>
              )}
            </div>
          )}

          <ActionTable data={filteredClusters} columns={columns} actions={actions} />
          {filteredClusters.length === 0 && (
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
