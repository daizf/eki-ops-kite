import { useCallback, useMemo, useState } from 'react'
import { IconDatabase, IconEdit, IconPlus, IconTrash } from '@tabler/icons-react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ColumnDef } from '@tanstack/react-table'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Pool } from '@/types/api'
import {
  PoolCreateRequest,
  PoolUpdateRequest,
  createPool,
  deletePool,
  updatePool,
  usePoolList,
} from '@/lib/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { DeleteConfirmationDialog } from '@/components/delete-confirmation-dialog'

import { Action, ActionTable } from '../action-table'
import { PoolDialog } from './pool-dialog'

export function PoolManagement() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()

  const { data: pools = [], isLoading, error } = usePoolList()

  const [showPoolDialog, setShowPoolDialog] = useState(false)
  const [editingPool, setEditingPool] = useState<Pool | null>(null)
  const [deletingPool, setDeletingPool] = useState<Pool | null>(null)

  const getStatusBadge = useCallback(
    (pool: Pool) => {
      if (!pool.enable) {
        return (
          <Badge variant="secondary">{t('status.disabled', 'Disabled')}</Badge>
        )
      }
      return <Badge variant="default">{t('status.enabled', 'Enabled')}</Badge>
    },
    [t]
  )

  const columns = useMemo<ColumnDef<Pool>[]>(
    () => [
      {
        id: 'poolId',
        header: t('common.fields.poolId', 'Pool ID'),
        cell: ({ row: { original: pool } }) => (
          <div className="text-sm font-mono text-muted-foreground">
            {pool.poolId}
          </div>
        ),
      },
      {
        id: 'poolName',
        header: t('common.fields.poolName', 'Pool Name'),
        cell: ({ row: { original: pool } }) => (
          <div>
            <div className="font-medium">{pool.poolName}</div>
            {pool.description && (
              <div className="text-sm text-muted-foreground">
                {pool.description}
              </div>
            )}
          </div>
        ),
      },
      {
        id: 'proxy',
        header: t('common.fields.proxy', 'Proxy'),
        cell: ({ row: { original: pool } }) => (
          <div className="text-sm text-muted-foreground">
            {pool.proxy || '-'}
          </div>
        ),
      },
      {
        id: 'status',
        header: t('common.fields.status', 'Status'),
        cell: ({ row: { original: pool } }) => (
          <div className="flex items-center gap-3">{getStatusBadge(pool)}</div>
        ),
      },
    ],
    [getStatusBadge, t]
  )

  const actions = useMemo<Action<Pool>[]>(() => {
    return [
      {
        label: (
          <>
            <IconEdit className="h-4 w-4" />
            {t('common.actions.edit', 'Edit')}
          </>
        ),
        onClick: (pool) => {
          setEditingPool(pool)
          setShowPoolDialog(true)
        },
      },
      {
        label: (
          <div className="inline-flex items-center gap-2 text-destructive">
            <IconTrash className="h-4 w-4" />
            {t('common.actions.delete', 'Delete')}
          </div>
        ),
        onClick: (pool) => {
          setDeletingPool(pool)
        },
      },
    ]
  }, [t])

  const createMutation = useMutation({
    mutationFn: createPool,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pool-list'] })
      toast.success(
        t('poolManagement.messages.created', 'Pool created successfully')
      )
      setShowPoolDialog(false)
    },
    onError: (error: Error) => {
      toast.error(
        error.message ||
          t('poolManagement.messages.createError', 'Failed to create pool')
      )
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: PoolUpdateRequest }) =>
      updatePool(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pool-list'] })
      toast.success(
        t('poolManagement.messages.updated', 'Pool updated successfully')
      )
      setShowPoolDialog(false)
      setEditingPool(null)
    },
    onError: (error: Error) => {
      toast.error(
        error.message ||
          t('poolManagement.messages.updateError', 'Failed to update pool')
      )
    },
  })

  const deleteMutation = useMutation({
    mutationFn: deletePool,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pool-list'] })
      toast.success(
        t('poolManagement.messages.deleted', 'Pool deleted successfully')
      )
      setDeletingPool(null)
    },
    onError: (error: Error) => {
      toast.error(
        error.message ||
          t('poolManagement.messages.deleteError', 'Failed to delete pool')
      )
    },
  })

  const handleSubmitPool = (poolData: PoolCreateRequest) => {
    if (editingPool) {
      updateMutation.mutate({
        id: editingPool.id,
        data: poolData,
      })
    } else {
      createMutation.mutate(poolData)
    }
  }

  const handleDeletePool = () => {
    if (!deletingPool) return
    deleteMutation.mutate(deletingPool.id)
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
          {t('poolManagement.errors.loadFailed', 'Failed to load pools')}
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
                <IconDatabase className="h-5 w-5" />
                {t('poolManagement.title', 'Pool Management')}
              </CardTitle>
            </div>
            <Button
              onClick={() => {
                setEditingPool(null)
                setShowPoolDialog(true)
              }}
              className="gap-2"
            >
              <IconPlus className="h-4 w-4" />
              {t('poolManagement.actions.add', 'Add Pool')}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <ActionTable data={pools} columns={columns} actions={actions} />
          {pools.length === 0 && (
            <div className="text-center py-8 text-muted-foreground">
              <IconDatabase className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>{t('poolManagement.empty.title', 'No pools configured')}</p>
              <p className="text-sm mt-1">
                {t(
                  'poolManagement.empty.description',
                  'Add your first pool to get started'
                )}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <PoolDialog
        open={showPoolDialog}
        onOpenChange={(open) => {
          setShowPoolDialog(open)
          if (!open) {
            setEditingPool(null)
          }
        }}
        pool={editingPool}
        onSubmit={handleSubmitPool}
      />

      <DeleteConfirmationDialog
        open={!!deletingPool}
        onOpenChange={() => setDeletingPool(null)}
        onConfirm={handleDeletePool}
        resourceName={deletingPool?.poolName || ''}
        resourceType="pool"
        additionalNote={t(
          'poolManagement.deleteConfirmation',
          'This action will delete the pool and cannot be undone.'
        )}
      />
    </div>
  )
}
