import { useEffect, useState } from 'react'
import { IconEdit, IconShieldCheck, IconX } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'

import { Cluster, Role } from '@/types/api'
import { useClusterList } from '@/lib/api'
import { CATEGORIES } from '@/lib/constants'
import { resourceCatalog } from '@/lib/resource-catalog'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'

import { Separator } from '../ui/separator'

interface RBACDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  role?: Role | null
  onSubmit: (data: Partial<Role>) => void
  isSubmitting?: boolean
}

type ArrayRoleField =
  | 'clusters'
  | 'clusterTags'
  | 'namespaces'
  | 'resources'
  | 'verbs'

const emptyRoleForm = (): Partial<Role> => ({
  name: '',
  description: '',
  clusters: [],
  clusterCategories: ['*'],
  clusterTags: ['*'],
  namespaces: [],
  resources: [],
  verbs: [],
})

const roleToForm = (role?: Role | null): Partial<Role> => {
  if (!role) return emptyRoleForm()

  return {
    name: role.name,
    description: role.description || '',
    clusters: role.clusters || [],
    clusterCategories: role.clusterCategories || ['*'],
    clusterTags: role.clusterTags || ['*'],
    namespaces: role.namespaces || [],
    resources: role.resources || [],
    verbs: role.verbs || [],
  }
}

const RESOURCE_SUGGESTIONS = [
  '*',
  ...resourceCatalog
    .filter((resource) => resource.type !== 'crs')
    .map((resource) => resource.type),
]

const VERB_SUGGESTIONS = [
  '*',
  'get',
  'create',
  'update',
  'delete',
  'log',
  'exec',
]

function ListEditor({
  label,
  items,
  onChange,
  input,
  onInputChange,
  placeholder,
  hint,
  suggestions,
}: {
  label: string
  items: string[]
  onChange: (items: string[]) => void
  input: string
  onInputChange: (value: string) => void
  placeholder?: string
  hint?: string
  suggestions?: string[]
}) {
  const inputFilter = input.split(',').at(-1)?.trim().toLowerCase() || ''
  const quickSuggestions =
    suggestions
      ?.filter((s) => !items.includes(s))
      .filter((s) => !inputFilter || s.toLowerCase().includes(inputFilter))
      .slice(0, 12) || []

  const addValues = (values: string[]) => {
    const nextValues = values.map((value) => value.trim()).filter(Boolean)
    if (nextValues.length === 0) return

    onChange(Array.from(new Set([...items, ...nextValues])))
    onInputChange('')
  }

  const add = () => {
    addValues(input.split(','))
  }

  const remove = (val: string) => {
    onChange(items.filter((i) => i !== val))
  }

  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {hint && (
        <p className="text-pretty text-xs text-muted-foreground">{hint}</p>
      )}
      <div className="flex flex-wrap gap-2">
        {items.map((it) => (
          <div
            key={it}
            className="inline-flex max-w-full items-center gap-2 rounded-full border px-2 py-1 text-sm"
          >
            <span className="min-w-0 truncate select-none" title={it}>
              {it}
            </span>
            <button
              type="button"
              aria-label={`remove ${it}`}
              onClick={() => remove(it)}
              className="inline-flex shrink-0 items-center justify-center"
            >
              <IconX className="h-3 w-3" />
            </button>
          </div>
        ))}
      </div>
      <Input
        value={input}
        placeholder={placeholder}
        onChange={(e) => onInputChange(e.target.value)}
        required={items.length === 0}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            add()
          }
        }}
      />
      {quickSuggestions.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {quickSuggestions.map((s) => (
            <Button
              key={s}
              type="button"
              variant="outline"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => addValues([s])}
            >
              {s}
            </Button>
          ))}
        </div>
      )}
    </div>
  )
}

export function RBACDialog({
  open,
  onOpenChange,
  role,
  onSubmit,
  isSubmitting,
}: RBACDialogProps) {
  const { t } = useTranslation()
  const isEdit = !!role

  const [form, setForm] = useState<Partial<Role>>({
    ...emptyRoleForm(),
    clusterCategories: ['*'],
    clusterTags: ['*'],
  })
  const [drafts, setDrafts] = useState<Record<ArrayRoleField, string>>({
    clusters: '',
    clusterTags: '',
    namespaces: '',
    resources: '',
    verbs: '',
  })

  useEffect(() => {
    if (!open) return
    setForm({
      ...roleToForm(role),
      clusterCategories: role?.clusterCategories || ['*'],
      clusterTags: role?.clusterTags || ['*'],
    })
    setDrafts({
      clusters: '',
      clusterTags: '',
      namespaces: '',
      resources: '',
      verbs: '',
    })
  }, [role, open])

  const handleChange = (field: keyof Role, value: string) =>
    setForm((prev) => ({ ...(prev || {}), [field]: value }))

  const setArrayField = (field: string, items: string[]) => {
    setForm((prev) => ({ ...(prev || {}), [field]: items }))
  }

  const setDraft = (field: ArrayRoleField, value: string) => {
    setDrafts((prev) => ({ ...prev, [field]: value }))
  }

  const withDraftValues = (field: ArrayRoleField) => {
    const items = form[field] || []
    const draftItems = drafts[field].split(',').map((value) => value.trim())
    return Array.from(new Set([...items, ...draftItems])).filter(Boolean)
  }

  const formatValues = (values: string[]) => {
    if (values.length === 0) return '-'
    if (values.includes('*')) return t('common.values.all', 'All')
    return values.join(', ')
  }

  // Categories dropdown multi-select toggle
  const toggleCategory = (cat: string) => {
    const current = form.clusterCategories || ['*']
    let next: string[]
    if (current.includes('*') && current.length === 1) {
      next = [cat]
    } else if (current.includes(cat)) {
      next = current.filter((c) => c !== cat)
      if (next.length === 0) next = ['*']
    } else {
      if (cat === '*') {
        next = ['*']
      } else {
        next = [...current.filter((c) => c !== '*'), cat]
      }
    }
    setArrayField('clusterCategories', next)
  }

  const preview = {
    clusters: withDraftValues('clusters'),
    namespaces: withDraftValues('namespaces'),
    resources: withDraftValues('resources'),
    verbs: withDraftValues('verbs'),
  }

  const { data: clusterList = [] } = useClusterList()

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    onSubmit({
      name: form.name?.trim() || '',
      description: form.description || '',
      clusters: withDraftValues('clusters'),
      clusterCategories: form.clusterCategories || ['*'],
      clusterTags: withDraftValues('clusterTags'),
      namespaces: withDraftValues('namespaces'),
      resources: withDraftValues('resources'),
      verbs: withDraftValues('verbs'),
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="!max-w-4xl max-h-[90vh] overflow-y-auto sm:!max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isEdit ? (
              <IconEdit className="h-5 w-5" />
            ) : (
              <IconShieldCheck className="h-5 w-5" />
            )}
            {isEdit
              ? `${t('common.actions.edit', 'Edit')} ${t('common.fields.role', 'Role')}`
              : `${t('common.actions.add', 'Add')} ${t('common.fields.role', 'Role')}`}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="role-name">
              {t('common.fields.role', 'Role')} *
            </Label>
            <Input
              id="role-name"
              value={form.name || ''}
              onChange={(e) => handleChange('name', e.target.value)}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="role-desc">
              {t('common.fields.description', 'Description')}
            </Label>
            <Textarea
              id="role-desc"
              value={form.description || ''}
              onChange={(e) => handleChange('description', e.target.value)}
              rows={3}
            />
          </div>
          <Separator />
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <h3 className="text-lg font-medium">
                {t('common.fields.permissions', 'Permissions')}
              </h3>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <ListEditor
                label={t('common.fields.clusters', 'Clusters')}
                items={form.clusters || ['*']}
                onChange={(items) => setArrayField('clusters', items)}
                input={drafts.clusters}
                onInputChange={(value) => setDraft('clusters', value)}
                placeholder="* or cluster-name"
                suggestions={
                  Array.isArray(clusterList)
                    ? ['*', ...(clusterList as Cluster[]).map((c) => c.name)]
                    : ['*']
                }
              />

              {/* Cluster Categories — dropdown multi-select from CATEGORIES */}
              <div className="space-y-2">
                <Label>
                  {t('common.fields.clusterCategories', 'Cluster Categories')}
                </Label>
                <Select
                  value={
                    (form.clusterCategories || ['*']).length === 1 &&
                    (form.clusterCategories || ['*'])[0] === '*'
                      ? '__all__'
                      : '__multi__'
                  }
                  onValueChange={() => {}}
                >
                  <SelectTrigger>
                    <SelectValue
                      placeholder={t(
                        'rbac.dialog.allCategories',
                        'All Categories'
                      )}
                    />
                  </SelectTrigger>
                </Select>
                <div className="flex flex-wrap gap-2">
                  {(form.clusterCategories || ['*']).map((cat) =>
                    cat === '*' ? (
                      <Badge key="*" variant="secondary" className="text-sm">
                        {t('rbac.dialog.allCategories', 'All')}
                        <button
                          type="button"
                          className="ml-1"
                          onClick={() => setArrayField('clusterCategories', [])}
                        >
                          <IconX className="h-3 w-3" />
                        </button>
                      </Badge>
                    ) : (
                      <Badge key={cat} variant="secondary" className="text-sm">
                        {cat}
                        <button
                          type="button"
                          className="ml-1"
                          onClick={() => toggleCategory(cat)}
                        >
                          <IconX className="h-3 w-3" />
                        </button>
                      </Badge>
                    )
                  )}
                </div>
                <Select
                  onValueChange={(value) => {
                    if (value === '__all__') {
                      setArrayField('clusterCategories', ['*'])
                    } else {
                      toggleCategory(value)
                    }
                  }}
                >
                  <SelectTrigger>
                    <SelectValue
                      placeholder={t(
                        'rbac.dialog.addCategory',
                        'Add a category...'
                      )}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">
                      {t('rbac.dialog.allCategories', 'All Categories')}
                    </SelectItem>
                    {CATEGORIES.map((cat) => (
                      <SelectItem key={cat} value={cat}>
                        {cat}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <ListEditor
                label={t('common.fields.clusterTags', 'Cluster Tags')}
                items={form.clusterTags || ['*']}
                onChange={(items) => setArrayField('clusterTags', items)}
                input={drafts.clusterTags}
                onInputChange={(value) => setDraft('clusterTags', value)}
                placeholder="* or tag-name"
              />

              <ListEditor
                label={t('common.fields.namespaces', 'Namespaces')}
                items={form.namespaces || ['*']}
                onChange={(items) => setArrayField('namespaces', items)}
                input={drafts.namespaces}
                onInputChange={(value) => setDraft('namespaces', value)}
                placeholder="* or namespace"
                suggestions={['*']}
              />

              <ListEditor
                label={t('common.fields.resources', 'Resources')}
                items={form.resources || ['*']}
                onChange={(items) => setArrayField('resources', items)}
                input={drafts.resources}
                onInputChange={(value) => setDraft('resources', value)}
                placeholder="* or pods,deployments,namespaces"
                hint={t(
                  'rbac.resourceHint',
                  'Use plural resource names. Type to filter suggestions. For CRDs and custom resources, enter the CRD name from the URL, for example widgets.example.com.'
                )}
                suggestions={RESOURCE_SUGGESTIONS}
              />

              <ListEditor
                label={`${t('common.fields.actions', 'Actions')} / ${t('common.fields.verbs', 'Verbs')}`}
                items={form.verbs || ['*']}
                onChange={(items) => setArrayField('verbs', items)}
                input={drafts.verbs}
                onInputChange={(value) => setDraft('verbs', value)}
                placeholder="* or get,create,update,delete,log,exec"
                suggestions={VERB_SUGGESTIONS}
              />
            </div>
            <div className="rounded-md border bg-muted/40 p-3 text-sm">
              <div className="mb-1 font-medium">
                {t('rbac.permissionPreviewTitle', 'Permission Preview')}
              </div>
              <p className="text-pretty text-muted-foreground">
                {t(
                  'rbac.permissionPreview',
                  'Allows {{verbs}} on {{resources}} in namespaces {{namespaces}} on clusters {{clusters}}.',
                  {
                    verbs: formatValues(preview.verbs),
                    resources: formatValues(preview.resources),
                    namespaces: formatValues(preview.namespaces),
                    clusters: formatValues(preview.clusters),
                  }
                )}
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              {t('common.actions.cancel', 'Cancel')}
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting
                ? t('common.actions.saving', 'Saving...')
                : isEdit
                  ? t('common.actions.save', 'Save')
                  : t('common.actions.create', 'Create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export default RBACDialog
