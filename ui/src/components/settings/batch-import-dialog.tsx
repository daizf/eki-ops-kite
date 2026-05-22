import { useState, useCallback, useRef } from 'react'
import { IconUpload, IconX, IconCheck, IconDownload } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import * as XLSX from 'xlsx'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  batchImportClusters,
  ClusterBatchImportItem,
  ClusterBatchImportResult,
} from '@/lib/api'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'

interface BatchImportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function BatchImportDialog({ open, onOpenChange }: BatchImportDialogProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [clusters, setClusters] = useState<ClusterBatchImportItem[]>([])
  const [fileName, setFileName] = useState('')

  const mutation = useMutation({
    mutationFn: batchImportClusters,
    onSuccess: (result: ClusterBatchImportResult) => {
      queryClient.invalidateQueries({ queryKey: ['cluster-list'] })

      const importedCount = result.imported.length
      const rejectedCount = result.rejected.length

      if (rejectedCount > 0) {
        toast.warning(
          t('clusterManagement.batchImport.warning.partialSuccess', 'Import completed with warnings'),
          {
            description: t(
              'clusterManagement.batchImport.warning.rejected',
              'Imported {{imported}} clusters, rejected {{rejected}} clusters',
              { imported: importedCount, rejected: rejectedCount }
            ),
            duration: 10000,
          }
        )
      } else {
        toast.success(
          t('clusterManagement.batchImport.success', 'Clusters imported successfully'),
          {
            description: t(
              'clusterManagement.batchImport.successCount',
              '{{count}} clusters imported',
              { count: importedCount }
            ),
          }
        )
      }

      setClusters([])
      setFileName('')
      onOpenChange(false)
    },
    onError: (error: Error) => {
      toast.error(
        t('clusterManagement.batchImport.error', 'Failed to import clusters'),
        {
          description: error.message,
        }
      )
    },
  })

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (!file) return

      setFileName(file.name)

      const reader = new FileReader()
      reader.onload = (event) => {
        try {
          const data = event.target?.result
          const workbook = XLSX.read(data, { type: 'binary' })

          const sheetName = workbook.SheetNames[0]
          const worksheet = workbook.Sheets[sheetName]
          const jsonData = XLSX.utils.sheet_to_json(worksheet, { defval: '' })

          const validItems: ClusterBatchImportItem[] = []
          const invalidCount: string[] = []

          jsonData.forEach((row: any, index: number) => {
            const cluster: ClusterBatchImportItem = {
              name: String(row['name'] || row['Name'] || row['集群名称'] || '').trim(),
              clusterId: String(row['clusterId'] || row['ClusterID'] || row['集群ID'] || '').trim(),
              description: String(row['description'] || row['Description'] || row['描述'] || '').trim(),
              config: String(row['config'] || row['Config'] || row['Kubeconfig'] || '').trim(),
              prometheusURL: String(row['prometheusURL'] || row['PrometheusURL'] || row['Prometheus地址'] || '').trim(),
              category: String(row['category'] || row['Category'] || row['分类'] || '').trim(),
              poolId: String(row['poolId'] || row['PoolID'] || row['资源池'] || '').trim(),
              inCluster: typeof row['inCluster'] === 'boolean' ? row['inCluster']
                : (row['inCluster'] || row['InCluster'] || row['集群类型'] || '').toString().toLowerCase() === 'true',
              isDefault: typeof row['isDefault'] === 'boolean' ? row['isDefault']
                : (row['isDefault'] || row['IsDefault'] || row['是否默认'] || '').toString().toLowerCase() === 'true',
              enabled: typeof row['enabled'] === 'boolean' ? row['enabled']
                : (row['enabled'] || row['Enabled'] || row['是否启用'] || '').toString().toLowerCase() !== 'false',
            }

            if (!cluster.name || !cluster.clusterId) {
              invalidCount.push(`Row ${index + 2}`)
            } else {
              validItems.push(cluster)
            }
          })

          setClusters(validItems)

          if (validItems.length > 0) {
            const message = invalidCount.length > 0
              ? t('clusterManagement.batchImport.parsedWithInvalid', 'Parsed {{count}} clusters from file, {{invalid}} rows invalid', {
                  count: validItems.length,
                  invalid: invalidCount.length
                })
              : t('clusterManagement.batchImport.parsed', 'Parsed {{count}} clusters from file', {
                  count: validItems.length
                })
            toast.success(message)
          } else {
            toast.error(
              t(
                'clusterManagement.batchImport.noValidData',
                'No valid clusters found in file'
              )
            )
          }
        } catch (error) {
          toast.error(
            t('clusterManagement.batchImport.parseError', 'Failed to parse file'),
            {
              description: error instanceof Error ? error.message : 'Invalid file format',
            }
          )
        }
      }
      reader.readAsBinaryString(file)
    },
    [t]
  )

  const handleUploadClick = () => {
    fileInputRef.current?.click()
  }

  const handleDownloadTemplate = () => {
    const templateData: any[] = [
      {
        name: 'my-cluster',
        clusterId: 'cluster-001',
        description: 'My production cluster',
        config: '<kubeconfig content>',
        prometheusURL: 'http://prometheus:9090',
        category: 'ESK',
        poolId: 'CIDC-RP-29',
        inCluster: 'false',
        isDefault: 'false',
        enabled: 'true',
      },
      {
        name: 'staging-cluster',
        clusterId: 'cluster-002',
        description: 'Staging environment',
        config: '<kubeconfig content>',
        prometheusURL: 'http://prometheus:9090',
        category: 'KCS',
        poolId: 'CIDC-RP-30',
        inCluster: 'false',
        isDefault: 'false',
        enabled: 'true',
      },
    ]

    const worksheet = XLSX.utils.json_to_sheet(templateData)
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Clusters')

    XLSX.writeFile(workbook, 'cluster-import-template.xlsx')
  }

  const handleClear = () => {
    setClusters([])
    setFileName('')
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  const handleSubmit = () => {
    if (clusters.length === 0) {
      toast.warning(
        t(
          'clusterManagement.batchImport.noClusters',
          'No clusters to import'
        )
      )
      return
    }

    mutation.mutate({ clusters })
  }

  const handleClose = () => {
    if (mutation.isPending) return
    handleClear()
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[800px] max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <IconUpload className="h-5 w-5" />
            {t('clusterManagement.batchImport.title', 'Batch Import Clusters')}
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="file-upload">
                {t('clusterManagement.batchImport.selectFile', 'Select Excel File')}
              </Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleDownloadTemplate}
                className="text-xs gap-1"
              >
                <IconDownload className="h-3 w-3" />
                {t('clusterManagement.batchImport.downloadTemplate', 'Download Template')}
              </Button>
            </div>
            <div className="flex gap-2">
              <Input
                ref={fileInputRef}
                id="file-upload"
                type="file"
                accept=".xlsx,.xls"
                onChange={handleFileChange}
                className="hidden"
              />
              <Button
                type="button"
                variant="outline"
                onClick={handleUploadClick}
                className="flex-1"
                disabled={mutation.isPending}
              >
                <IconUpload className="h-4 w-4 mr-2" />
                {fileName || t('common.actions.upload', 'Upload')}
              </Button>
              {clusters.length > 0 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={handleClear}
                  disabled={mutation.isPending}
                >
                  <IconX className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>

          {fileName && (
            <div className="text-xs text-muted-foreground p-3 bg-muted/50 rounded space-y-2">
              <div className="font-medium">
                {t('clusterManagement.batchImport.fileFormat', 'Excel File Columns')}:
              </div>
              <div className="grid grid-cols-2 gap-1 text-xs">
                <div><code>name</code> / <code>Name</code> / <code>集群名称</code> *</div>
                <div><code>clusterId</code> / <code>ClusterID</code> / <code>集群ID</code> *</div>
                <div><code>description</code> / <code>Description</code> / <code>描述</code></div>
                <div><code>config</code> / <code>Config</code> / <code>Kubeconfig</code></div>
                <div><code>prometheusURL</code> / <code>PrometheusURL</code> / <code>Prometheus地址</code></div>
                <div><code>category</code> / <code>Category</code> / <code>分类</code></div>
                <div><code>poolId</code> / <code>PoolID</code> / <code>资源池</code></div>
                <div><code>inCluster</code> / <code>IsDefault</code> / <code>enabled</code></div>
              </div>
            </div>
          )}

          {clusters.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>
                  {t('clusterManagement.batchImport.clustersPreview', 'Clusters to Import')}{' '}
                  <Badge variant="secondary">{clusters.length}</Badge>
                </Label>
              </div>
              <div className="border rounded-lg max-h-64 overflow-y-auto">
                <div className="divide-y">
                  {clusters.map((cluster, index) => (
                    <div
                      key={`${cluster.clusterId}-${index}`}
                      className="p-3 hover:bg-muted/30 flex items-center gap-3"
                    >
                      <Badge variant="outline" className="shrink-0">
                        {index + 1}
                      </Badge>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium truncate">{cluster.name}</span>
                          {cluster.isDefault && (
                            <Badge variant="secondary" className="text-xs">
                              {t('clusterManagement.badges.default', 'Default')}
                            </Badge>
                          )}
                          {cluster.category && (
                            <Badge variant="outline" className="text-xs">
                              {cluster.category}
                            </Badge>
                          )}
                          {!cluster.enabled && (
                            <Badge variant="secondary" className="text-xs">
                              {t('status.disabled', 'Disabled')}
                            </Badge>
                          )}
                        </div>
                        <div className="text-sm text-muted-foreground font-mono truncate">
                          {cluster.clusterId}
                        </div>
                        {cluster.description && (
                          <div className="text-xs text-muted-foreground truncate">
                            {cluster.description}
                          </div>
                        )}
                      </div>
                      <IconCheck className="h-4 w-4 text-green-500 shrink-0" />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {clusters.length === 0 && fileName === '' && (
            <div className="text-center py-8 text-muted-foreground">
              <IconUpload className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>
                {t(
                  'clusterManagement.batchImport.empty',
                  'Upload an Excel file containing cluster configurations'
                )}
              </p>
              <Button
                type="button"
                variant="link"
                size="sm"
                onClick={handleDownloadTemplate}
                className="mt-2"
              >
                <IconDownload className="h-3 w-3 mr-1" />
                {t('clusterManagement.batchImport.downloadTemplate', 'Download Template')}
              </Button>
            </div>
          )}
        </div>

        <DialogFooter>
          {clusters.length > 0 && (
            <Button
              type="button"
              variant="destructive"
              onClick={handleClear}
              disabled={mutation.isPending}
            >
              {t('common.actions.clear', 'Clear')}
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            onClick={handleClose}
            disabled={mutation.isPending}
          >
            {t('common.actions.cancel', 'Cancel')}
          </Button>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={clusters.length === 0 || mutation.isPending}
          >
            {mutation.isPending
              ? t('clusterManagement.batchImport.importing', 'Importing...')
              : t('clusterManagement.batchImport.import', 'Import Clusters')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
