import { useMemo } from 'react'
import {
  ColumnDef,
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  PaginationState,
  Updater,
  useReactTable,
} from '@tanstack/react-table'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, ChevronRight } from 'lucide-react'

import { Button } from './ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './ui/dropdown-menu'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from './ui/table'

interface ActionTableProps<T> {
  data: T[]
  columns: ColumnDef<T>[]
  actions: Action<T>[]
  pagination?: PaginationState
  onPaginationChange?: (updater: Updater<PaginationState>) => void
}

export interface Action<T> {
  label: string | React.ReactNode
  dynamicLabel?: (item: T) => string | React.ReactNode
  onClick: (item: T) => void
  shouldDisable?: (item: T) => boolean
}

export function ActionTable<T>({
  data,
  columns,
  actions,
  pagination,
  onPaginationChange,
}: ActionTableProps<T>) {
  const { t } = useTranslation()
  const enablePagination = !!pagination && !!onPaginationChange
  const tableColumns = useMemo(() => {
    if (actions.length > 0) {
      const actionColumn: ColumnDef<T> = {
        id: 'actions',
        header: t('common.fields.actions'),
        cell: ({ row }) => (
          <div className="text-right">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm">
                  •••
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {actions.map((action, index) => (
                  <DropdownMenuItem
                    key={index}
                    disabled={action.shouldDisable?.(row.original)}
                    onClick={() => action.onClick(row.original)}
                    className="gap-2"
                  >
                    {action.dynamicLabel
                      ? action.dynamicLabel(row.original)
                      : action.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ),
      }
      return [...columns, actionColumn]
    }
    return columns
  }, [actions, columns, t])

  const table = useReactTable<T>({
    data,
    columns: tableColumns,
    getCoreRowModel: getCoreRowModel(),
    ...(enablePagination
      ? {
          getPaginationRowModel: getPaginationRowModel(),
          state: { pagination: pagination! },
          onPaginationChange: onPaginationChange!,
          manualPagination: false,
        }
      : {}),
  })

  return (
    <div className="space-y-2">
      <div className="rounded-md border">
        <Table>
          <TableHeader className="bg-muted sticky top-0 z-10">
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead
                    key={header.id}
                    className={header.id === 'actions' ? 'text-right' : ''}
                  >
                    {header.isPlaceholder
                      ? null
                      : (header.column.columnDef.header as React.ReactNode)}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.map((row) => (
              <TableRow
                key={row.id}
                data-state={row.getIsSelected() && 'selected'}
              >
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id}>
                    {cell.column.columnDef.cell
                      ? flexRender(cell.column.columnDef.cell, cell.getContext())
                      : String(cell.getValue() || '-')}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {enablePagination && (
        <div className="flex flex-wrap items-center justify-between gap-3 px-1 py-2 text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <span>{t('common.pagination.rowsPerPage', 'Rows per page')}:</span>
            <Select
              value={String(pagination!.pageSize)}
              onValueChange={(value) =>
                onPaginationChange!((prev) => ({
                  ...prev,
                  pageSize: Number(value),
                  pageIndex: 0,
                }))
              }
            >
              <SelectTrigger size="sm" className="w-[72px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[10, 20, 50, 100].map((size) => (
                  <SelectItem key={size} value={String(size)}>
                    {size}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-3">
            <span>
              {t('common.pagination.page', 'Page')}{' '}
              {pagination!.pageIndex + 1} {t('common.pagination.of', 'of')}{' '}
              {table.getPageCount() || 1}
            </span>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                onClick={() => table.previousPage()}
                disabled={!table.getCanPreviousPage()}
                aria-label={t('common.pagination.previous', 'Previous page')}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                onClick={() => table.nextPage()}
                disabled={!table.getCanNextPage()}
                aria-label={t('common.pagination.next', 'Next page')}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
