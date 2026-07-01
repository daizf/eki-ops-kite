import { useCallback, useRef, useState } from 'react'
import { IconCheck, IconDownload, IconUpload, IconX } from '@tabler/icons-react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import * as XLSX from 'xlsx'

import { batchImportPools, PoolBatchImportItem } from '@/lib/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface PoolImportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function PoolImportDialog({
  open,
  onOpenChange,
}: PoolImportDialogProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [pools, setPools] = useState<PoolBatchImportItem[]>([])
  const [fileName, setFileName] = useState('')

  const mutation = useMutation({
    mutationFn: batchImportPools,
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['pool-list'] })

      const importedCount = result.imported.length
      const skippedCount = result.skipped.length
      const rejectedCount = result.rejected.length
      const hasIssues = skippedCount > 0 || rejectedCount > 0

      if (hasIssues) {
        const parts: string[] = []
        if (importedCount > 0)
          parts.push(
            t(
              'poolManagement.batchImport.summaryImported',
              '{{count}} imported',
              { count: importedCount }
            )
          )
        if (skippedCount > 0)
          parts.push(
            t(
              'poolManagement.batchImport.summarySkipped',
              '{{count}} skipped (duplicate)',
              { count: skippedCount }
            )
          )
        if (rejectedCount > 0)
          parts.push(
            t(
              'poolManagement.batchImport.summaryRejected',
              '{{count}} rejected',
              { count: rejectedCount }
            )
          )

        toast.warning(
          t(
            'poolManagement.batchImport.warning.partialSuccess',
            'Import completed with warnings'
          ),
          {
            description: parts.join(', '),
            duration: 10000,
          }
        )
      } else {
        toast.success(
          t(
            'poolManagement.batchImport.success',
            'Pools imported successfully'
          ),
          {
            description: t(
              'poolManagement.batchImport.successCount',
              '{{count}} pools imported',
              { count: importedCount }
            ),
          }
        )
      }

      setPools([])
      setFileName('')
      onOpenChange(false)
    },
    onError: (error: Error) => {
      toast.error(
        t('poolManagement.batchImport.error', 'Failed to import pools'),
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

          const validItems: PoolBatchImportItem[] = []
          const invalidRows: string[] = []

          jsonData.forEach((row: any, index: number) => {
            const pool: PoolBatchImportItem = {
              poolId: String(
                row['poolId'] || row['PoolID'] || row['资源池ID'] || ''
              ).trim(),
              poolName: String(
                row['poolName'] || row['PoolName'] || row['资源池名称'] || ''
              ).trim(),
              description: String(
                row['description'] || row['Description'] || row['描述'] || ''
              ).trim(),
              proxy: String(
                row['proxy'] || row['Proxy'] || row['代理'] || ''
              ).trim(),
              imageRegistry: String(
                row['imageRegistry'] ||
                  row['ImageRegistry'] ||
                  row['镜像仓库'] ||
                  ''
              ).trim(),
              eskBaseURL: String(
                row['eskBaseURL'] || row['EskBaseURL'] || row['ESK地址'] || ''
              ).trim(),
              kcsBaseURL: String(
                row['kcsBaseURL'] || row['KcsBaseURL'] || row['KCS地址'] || ''
              ).trim(),
              enable:
                typeof row['enable'] === 'boolean'
                  ? row['enable']
                  : (row['enable'] || row['Enable'] || row['启用'] || '')
                      .toString()
                      .toLowerCase() === 'true',
            }

            if (!pool.poolId || !pool.poolName) {
              invalidRows.push(`Row ${index + 2}`)
            } else {
              validItems.push(pool)
            }
          })

          setPools(validItems)

          if (validItems.length > 0) {
            const message =
              invalidRows.length > 0
                ? t(
                    'poolManagement.batchImport.parsedWithInvalid',
                    'Parsed {{count}} pools from file, {{invalid}} rows invalid',
                    {
                      count: validItems.length,
                      invalid: invalidRows.length,
                    }
                  )
                : t(
                    'poolManagement.batchImport.parsed',
                    'Parsed {{count}} pools from file',
                    {
                      count: validItems.length,
                    }
                  )
            toast.success(message)
          } else {
            toast.error(
              t(
                'poolManagement.batchImport.noValidData',
                'No valid pools found in file'
              )
            )
          }
        } catch (error) {
          toast.error(
            t('poolManagement.batchImport.parseError', 'Failed to parse file'),
            {
              description:
                error instanceof Error ? error.message : 'Invalid file format',
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
        poolId: 'CIDC-RP-29',
        poolName: '华东资源池',
        description: 'East China region pool',
        proxy: 'http://proxy.example.com:8080',
        imageRegistry: 'registry.example.com',
        eskBaseURL: 'https://esk.example.com',
        kcsBaseURL: 'https://kcs.example.com',
        enable: 'false',
      },
      {
        poolId: 'CIDC-RP-30',
        poolName: '华北资源池',
        description: 'North China region pool',
        proxy: '',
        imageRegistry: '',
        eskBaseURL: 'https://esk2.example.com',
        kcsBaseURL: '',
        enable: 'false',
      },
    ]

    const worksheet = XLSX.utils.json_to_sheet(templateData)
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Pools')

    XLSX.writeFile(workbook, 'pool-import-template.xlsx')
  }

  const handleClear = () => {
    setPools([])
    setFileName('')
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  const handleSubmit = () => {
    if (pools.length === 0) {
      toast.warning(
        t('poolManagement.batchImport.noPools', 'No pools to import')
      )
      return
    }

    mutation.mutate({ pools })
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
            {t('poolManagement.batchImport.title', 'Import Pools')}
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="pool-file-upload">
                {t(
                  'poolManagement.batchImport.selectFile',
                  'Select Excel File'
                )}
              </Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleDownloadTemplate}
                className="text-xs gap-1"
              >
                <IconDownload className="h-3 w-3" />
                {t(
                  'poolManagement.batchImport.downloadTemplate',
                  'Download Template'
                )}
              </Button>
            </div>
            <div className="flex gap-2">
              <Input
                ref={fileInputRef}
                id="pool-file-upload"
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
              {pools.length > 0 && (
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
                {t(
                  'poolManagement.batchImport.fileFormat',
                  'Excel File Columns'
                )}
                :
              </div>
              <div className="grid grid-cols-2 gap-1 text-xs">
                <div>
                  <code>poolId</code> / <code>资源池ID</code> *
                </div>
                <div>
                  <code>poolName</code> / <code>资源池名称</code> *
                </div>
                <div>
                  <code>description</code> / <code>描述</code>
                </div>
                <div>
                  <code>proxy</code> / <code>代理</code>
                </div>
                <div>
                  <code>imageRegistry</code> / <code>镜像仓库</code>
                </div>
                <div>
                  <code>eskBaseURL</code> / <code>ESK地址</code>
                </div>
                <div>
                  <code>kcsBaseURL</code> / <code>KCS地址</code>
                </div>
                <div>
                  <code>enable</code> / <code>启用</code>
                </div>
              </div>
            </div>
          )}

          {pools.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>
                  {t(
                    'poolManagement.batchImport.poolsPreview',
                    'Pools to Import'
                  )}{' '}
                  <Badge variant="secondary">{pools.length}</Badge>
                </Label>
              </div>
              <div className="border rounded-lg max-h-64 overflow-y-auto">
                <div className="divide-y">
                  {pools.map((pool, index) => (
                    <div
                      key={`${pool.poolId}-${index}`}
                      className="p-3 hover:bg-muted/30 flex items-center gap-3"
                    >
                      <Badge variant="outline" className="shrink-0">
                        {index + 1}
                      </Badge>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium truncate">
                            {pool.poolName}
                          </span>
                          {!pool.enable && (
                            <Badge variant="secondary" className="text-xs">
                              {t('status.disabled', 'Disabled')}
                            </Badge>
                          )}
                        </div>
                        <div className="text-sm text-muted-foreground font-mono truncate">
                          {pool.poolId}
                        </div>
                        {pool.description && (
                          <div className="text-xs text-muted-foreground truncate">
                            {pool.description}
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

          {pools.length === 0 && fileName === '' && (
            <div className="text-center py-8 text-muted-foreground">
              <IconUpload className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>
                {t(
                  'poolManagement.batchImport.empty',
                  'Upload an Excel file containing pool configurations'
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
                {t(
                  'poolManagement.batchImport.downloadTemplate',
                  'Download Template'
                )}
              </Button>
            </div>
          )}
        </div>

        <DialogFooter>
          {pools.length > 0 && (
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
            disabled={pools.length === 0 || mutation.isPending}
          >
            {mutation.isPending
              ? t('poolManagement.batchImport.importing', 'Importing...')
              : t('poolManagement.batchImport.import', 'Import Pools')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
