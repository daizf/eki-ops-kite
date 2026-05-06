import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Pool } from '@/types/api'
import type { PoolCreateRequest } from '@/lib/api/admin'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'

export interface PoolDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  pool?: Pool | null
  onSubmit: (data: PoolCreateRequest) => void
}

export function PoolDialog({ open, onOpenChange, pool, onSubmit }: PoolDialogProps) {
  const { t } = useTranslation()

  // Form state
  const [poolId, setPoolId] = useState(pool?.poolId ?? '')
  const [poolName, setPoolName] = useState(pool?.poolName ?? '')
  const [description, setDescription] = useState(pool?.description ?? '')
  const [proxy, setProxy] = useState(pool?.proxy ?? '')
  const [enable, setEnable] = useState(pool?.enable ?? true)
  const [errors, setErrors] = useState<Record<string, string>>({})

  // Reset form when pool changes or dialog opens
  useEffect(() => {
    if (pool) {
      setPoolId(pool.poolId)
      setPoolName(pool.poolName)
      setDescription(pool.description ?? '')
      setProxy(pool.proxy ?? '')
      setEnable(pool.enable)
    } else {
      setPoolId('')
      setPoolName('')
      setDescription('')
      setProxy('')
      setEnable(true)
    }
    setErrors({})
  }, [pool, open])

  const validateForm = useCallback(() => {
    const newErrors: Record<string, string> = {}

    if (!poolId.trim()) {
      newErrors.poolId = t(
        'poolManagement.validation.poolIdRequired',
        'Pool ID is required'
      )
    }

    if (!poolName.trim()) {
      newErrors.poolName = t(
        'poolManagement.validation.poolNameRequired',
        'Pool name is required'
      )
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }, [poolId, poolName, t])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    if (!validateForm()) {
      return
    }

    onSubmit({
      poolId: poolId.trim(),
      poolName: poolName.trim(),
      description: description.trim(),
      proxy: proxy.trim(),
      enable,
    })

    // Reset form after submission
    if (!pool) {
      setPoolId('')
      setPoolName('')
      setDescription('')
      setProxy('')
      setEnable(true)
    }
    setErrors({})
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>
              {pool
                ? t('poolManagement.dialog.editTitle', 'Edit Pool')
                : t('poolManagement.dialog.createTitle', 'Create Pool')}
            </DialogTitle>
            <DialogDescription>
              {t(
                'poolManagement.dialog.description',
                'Configure pool settings. Required fields are marked with *.'
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="poolId">
                {t('common.fields.poolId', 'Pool ID')} <span className="text-destructive">*</span>
              </Label>
              <Input
                id="poolId"
                value={poolId}
                onChange={(e) => setPoolId(e.target.value)}
                placeholder={t(
                  'poolManagement.fields.poolIdPlaceholder',
                  'Enter pool ID'
                )}
                disabled={!!pool}
                className={errors.poolId ? 'border-destructive' : ''}
              />
              {errors.poolId && (
                <div className="text-sm text-destructive">{errors.poolId}</div>
              )}
            </div>

            <div className="grid gap-2">
              <Label htmlFor="poolName">
                {t('common.fields.poolName', 'Pool Name')} <span className="text-destructive">*</span>
              </Label>
              <Input
                id="poolName"
                value={poolName}
                onChange={(e) => setPoolName(e.target.value)}
                placeholder={t(
                  'poolManagement.fields.namePlaceholder',
                  'Enter pool name'
                )}
                className={errors.poolName ? 'border-destructive' : ''}
              />
              {errors.poolName && (
                <div className="text-sm text-destructive">{errors.poolName}</div>
              )}
            </div>

            <div className="grid gap-2">
              <Label htmlFor="description">
                {t('common.fields.description', 'Description')}
              </Label>
              <Textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t(
                  'poolManagement.fields.descriptionPlaceholder',
                  'Enter pool description'
                )}
                rows={3}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="proxy">{t('common.fields.proxy', 'Proxy')}</Label>
              <Input
                id="proxy"
                value={proxy}
                onChange={(e) => setProxy(e.target.value)}
                placeholder={t(
                  'poolManagement.fields.proxyPlaceholder',
                  'http://proxy.example.com:8080'
                )}
              />
            </div>

            <div className="flex items-center gap-2">
              <Switch
                id="enable"
                checked={enable}
                onCheckedChange={setEnable}
              />
              <Label htmlFor="enable" className="cursor-pointer">
                {t('poolManagement.fields.enabled', 'Enabled')}
              </Label>
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              {t('common.actions.cancel', 'Cancel')}
            </Button>
            <Button type="submit">
              {pool
                ? t('common.actions.save', 'Save')
                : t('common.actions.create', 'Create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
