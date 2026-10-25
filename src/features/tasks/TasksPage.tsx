import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { unwrap, type Row } from '@/lib/queries'
import { useAuth } from '@/app/auth'
import { EmptyState, ErrorNote, Loading, PageHeader } from '@/components/common'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Field, Select, Textarea } from '@/components/ui/form-controls'
import { Input } from '@/components/ui/input'
import { addDays } from '@/domain/booking'
import { formatDate, pkToday } from '@/domain/format'
import { cn } from '@/lib/utils'

type Task = Row<'tasks'>
const STATUSES = [
  ['todo', 'To do'],
  ['doing', 'Doing'],
  ['blocked', 'Blocked'],
  ['done', 'Done'],
] as const
const CATEGORIES = [
  ['turnover', 'Turnover'],
  ['guest_request', 'Guest request'],
  ['maintenance', 'Maintenance'],
  ['admin', 'Admin'],
  ['purchase', 'Purchase'],
] as const

function useTaskData() {
  return useQuery({
    queryKey: ['tasks'],
    queryFn: async () => {
      // staff_calendar works for every role, so names resolve without exposing booking money
      const [tasks, stays] = await Promise.all([
        supabase.from('tasks').select('*').is('deleted_at', null).order('due_date', { nullsFirst: false }),
        supabase.from('staff_calendar').select('id, item_type, guest_name, start_date, end_date').eq('item_type', 'booking'),
      ])
      return { tasks: unwrap(tasks), stays: unwrap(stays) }
    },
  })
}

function useMembers(enabled: boolean) {
  return useQuery({
    queryKey: ['app_users'],
    enabled,
    queryFn: async () =>
      unwrap(
        await supabase
          .from('app_users')
          .select('id, display_name, role, active')
          .is('deleted_at', null)
          .eq('active', true)
          .order('display_name'),
      ),
  })
}

export function TasksPage() {
  const { member } = useAuth()
  const isStaff = member?.role === 'staff'
  const [params, setParams] = useSearchParams()
  const view = params.get('view') === 'board' ? 'board' : 'list'
  const mine = params.get('mine') === '1'
  const q = useTaskData()
  const members = useMembers(!isStaff)
  const [editing, setEditing] = useState<Task | 'new' | null>(null)
  const today = pkToday()

  const stayName = useMemo(() => {
    const m = new Map<string, string>()
    for (const s of q.data?.stays ?? [])
      m.set(s.id!, `${s.guest_name ?? 'Guest'} (${formatDate(s.start_date!).replace(/ \d{4}$/, '')})`)
    return m
  }, [q.data])
  const memberName = (id: string | null) => members.data?.find((m) => m.id === id)?.display_name

  const tasks = (q.data?.tasks ?? []).filter((t) => !mine || t.assignee_id === member?.id)
  const set = (k: string, v: string | null) => {
    const n = new URLSearchParams(params)
    if (v) n.set(k, v)
    else n.delete(k)
    setParams(n, { replace: true })
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Tasks"
        actions={
          !isStaff && (
            <Button onClick={() => setEditing('new')}>
              <Plus aria-hidden /> Task
            </Button>
          )
        }
      />
      <div className="flex flex-wrap gap-2">
        <div role="tablist" className="flex rounded-lg bg-muted p-1">
          {(['list', 'board'] as const).map((v) => (
            <button
              key={v}
              role="tab"
              aria-selected={view === v}
              onClick={() => set('view', v === 'list' ? null : v)}
              className={cn(
                'h-9 rounded-md px-4 text-sm capitalize',
                view === v ? 'bg-card font-medium shadow-sm' : 'text-muted-foreground',
              )}
            >
              {v}
            </button>
          ))}
        </div>
        <Button
          variant={mine ? 'secondary' : 'outline'}
          size="sm"
          className="h-11"
          onClick={() => set('mine', mine ? null : '1')}
        >
          Assigned to me
        </Button>
      </div>
      <ErrorNote error={q.error} />
      {q.isPending ? (
        <Loading />
      ) : view === 'list' ? (
        <TaskList tasks={tasks} today={today} stayName={stayName} memberName={memberName} onOpen={setEditing} />
      ) : (
        <TaskBoard tasks={tasks} today={today} stayName={stayName} memberName={memberName} onOpen={setEditing} />
      )}
      <TaskDialog
        task={editing}
        onClose={() => setEditing(null)}
        isStaff={isStaff}
        members={members.data ?? []}
        stays={(q.data?.stays ?? []).filter((s) => s.end_date! >= addDays(today, -30))}
      />
    </div>
  )
}

type ListProps = {
  tasks: Task[]
  today: string
  stayName: Map<string, string>
  memberName: (id: string | null) => string | undefined
  onOpen: (t: Task) => void
}

function TaskList({ tasks, today, stayName, memberName, onOpen }: ListProps) {
  const qc = useQueryClient()
  const toggle = useMutation({
    mutationFn: async (t: Task) =>
      unwrap(
        await supabase
          .from('tasks')
          .update({ status: t.status === 'done' ? 'todo' : 'done' })
          .eq('id', t.id)
          .select('id')
          .single(),
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
    onError: (e: Error) => toast.error(e.message),
  })
  const open = tasks.filter((t) => t.status !== 'done')
  const groups: [string, Task[]][] = [
    ['Overdue', open.filter((t) => t.due_date && t.due_date < today)],
    ['Today', open.filter((t) => t.due_date === today)],
    ['Next 7 days', open.filter((t) => t.due_date && t.due_date > today && t.due_date <= addDays(today, 7))],
    ['Later', open.filter((t) => t.due_date && t.due_date > addDays(today, 7))],
    ['No date', open.filter((t) => !t.due_date)],
    ['Done recently', tasks.filter((t) => t.status === 'done' && t.updated_at.slice(0, 10) >= addDays(today, -7))],
  ]
  if (!tasks.length) return <EmptyState title="No tasks">Tasks are created automatically for each booking.</EmptyState>
  return (
    <div className="flex flex-col gap-4">
      {groups
        .filter(([, xs]) => xs.length)
        .map(([title, xs]) => (
          <section key={title}>
            <h2 className={cn('mb-1 text-sm font-medium', title === 'Overdue' && 'text-destructive')}>
              {title} <span className="text-muted-foreground">({xs.length})</span>
            </h2>
            <ul className="divide-y rounded-lg border bg-card">
              {xs.map((t) => (
                <li key={t.id} className="flex items-start gap-3 p-3">
                  <input
                    type="checkbox"
                    className="mt-0.5 size-5 shrink-0"
                    checked={t.status === 'done'}
                    aria-label={`Mark "${t.title}" ${t.status === 'done' ? 'not done' : 'done'}`}
                    onChange={() => toggle.mutate(t)}
                  />
                  <button className="min-w-0 flex-1 text-left" onClick={() => onOpen(t)}>
                    <span
                      className={cn('block text-sm font-medium', t.status === 'done' && 'text-muted-foreground line-through')}
                    >
                      {t.title}
                    </span>
                    <TaskMeta t={t} stayName={stayName} memberName={memberName} />
                  </button>
                  {t.due_date && (
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {formatDate(t.due_date).replace(/ \d{4}$/, '')}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))}
    </div>
  )
}

function TaskMeta({ t, stayName, memberName }: Pick<ListProps, 'stayName' | 'memberName'> & { t: Task }) {
  const who = memberName(t.assignee_id)
  return (
    <span className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
      <Badge variant="outline">{CATEGORIES.find(([k]) => k === t.category)?.[1]}</Badge>
      {t.status === 'blocked' && <Badge variant="danger">blocked</Badge>}
      {t.status === 'doing' && <Badge variant="info">doing</Badge>}
      {t.booking_id && stayName.get(t.booking_id) && <span>{stayName.get(t.booking_id)}</span>}
      {who && <span>· {who}</span>}
    </span>
  )
}

function TaskBoard({ tasks, today, stayName, memberName, onOpen }: ListProps) {
  const qc = useQueryClient()
  const move = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: Task['status'] }) =>
      unwrap(await supabase.from('tasks').update({ status }).eq('id', id).select('id').single()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
    onError: (e: Error) => toast.error(e.message),
  })
  return (
    <div className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2 md:mx-0 md:grid md:grid-cols-4 md:px-0">
      {STATUSES.map(([status, label]) => {
        const col = tasks.filter(
          (t) => t.status === status && (status !== 'done' || t.updated_at.slice(0, 10) >= addDays(today, -14)),
        )
        return (
          <section key={status} className="w-72 shrink-0 snap-start rounded-lg bg-muted p-2 md:w-auto">
            <h2 className="mb-2 px-1 text-sm font-medium">
              {label} <span className="text-muted-foreground">({col.length})</span>
            </h2>
            <ul className="flex flex-col gap-2">
              {col.map((t) => (
                <li key={t.id} className="rounded-md border bg-card p-2">
                  <button className="w-full text-left" onClick={() => onOpen(t)}>
                    <span className="block text-sm font-medium">{t.title}</span>
                    <TaskMeta t={t} stayName={stayName} memberName={memberName} />
                    {t.due_date && (
                      <span
                        className={cn(
                          'mt-1 block text-xs',
                          t.due_date < today && status !== 'done' ? 'text-destructive' : 'text-muted-foreground',
                        )}
                      >
                        Due {formatDate(t.due_date)}
                      </span>
                    )}
                  </button>
                  <Select
                    aria-label="Move to"
                    className="mt-2 h-9 text-sm"
                    value={t.status}
                    onChange={(e) => move.mutate({ id: t.id, status: e.target.value as Task['status'] })}
                  >
                    {STATUSES.map(([k, l]) => (
                      <option key={k} value={k}>
                        {l}
                      </option>
                    ))}
                  </Select>
                </li>
              ))}
            </ul>
          </section>
        )
      })}
    </div>
  )
}

function TaskDialog({
  task,
  onClose,
  isStaff,
  members,
  stays,
}: {
  task: Task | 'new' | null
  onClose: () => void
  isStaff: boolean
  members: { id: string; display_name: string }[]
  stays: { id: string | null; guest_name: string | null; start_date: string | null }[]
}) {
  const qc = useQueryClient()
  const t = task === 'new' ? null : task
  const [form, setForm] = useState<Record<string, string>>({})
  const key = task === 'new' ? 'new' : (task?.id ?? '')
  const [loadedKey, setLoadedKey] = useState('')
  if (task && loadedKey !== key) {
    setLoadedKey(key)
    setForm({
      title: t?.title ?? '',
      booking_id: t?.booking_id ?? '',
      due_date: t?.due_date ?? '',
      assignee_id: t?.assignee_id ?? '',
      category: t?.category ?? 'guest_request',
      status: t?.status ?? 'todo',
      notes: t?.notes ?? '',
    })
  }
  const set = (k: string) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const save = useMutation({
    mutationFn: async () => {
      if (!form.title?.trim()) throw new Error('Add a title')
      const values = isStaff
        ? { status: form.status as Task['status'], notes: form.notes || null }
        : {
            title: form.title.trim(),
            booking_id: form.booking_id || null,
            due_date: form.due_date || null,
            assignee_id: form.assignee_id || null,
            category: form.category as Task['category'],
            status: form.status as Task['status'],
            notes: form.notes || null,
          }
      if (t) return unwrap(await supabase.from('tasks').update(values).eq('id', t.id).select('id').single())
      return unwrap(
        await supabase
          .from('tasks')
          .insert(values as never)
          .select('id')
          .single(),
      )
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tasks'] })
      qc.invalidateQueries({ queryKey: ['overview_tasks'] })
      toast.success('Task saved')
      onClose()
    },
  })
  const remove = useMutation({
    mutationFn: async () =>
      unwrap(await supabase.from('tasks').update({ deleted_at: new Date().toISOString() }).eq('id', t!.id).select('id').single()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tasks'] })
      toast.success('Task deleted')
      onClose()
    },
  })

  return (
    <Dialog open={!!task} onOpenChange={(o) => !o && onClose()}>
      {task && (
        <DialogContent
          title={t ? 'Task' : 'New task'}
          description={t?.auto_key ? 'Created automatically for the booking' : undefined}
        >
          <div className="grid grid-cols-2 gap-4">
            <Field label="Title" htmlFor="t_title" className="col-span-2">
              <Input id="t_title" value={form.title ?? ''} onChange={set('title')} disabled={isStaff} />
            </Field>
            {!isStaff && (
              <>
                <Field label="Booking" htmlFor="t_booking" className="col-span-2">
                  <Select id="t_booking" value={form.booking_id ?? ''} onChange={set('booking_id')}>
                    <option value="">None</option>
                    {stays.map((s) => (
                      <option key={s.id} value={s.id!}>
                        {s.guest_name ?? 'Guest'} · {formatDate(s.start_date!)}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Due" htmlFor="t_due">
                  <Input id="t_due" type="date" value={form.due_date ?? ''} onChange={set('due_date')} />
                </Field>
                <Field label="Assignee" htmlFor="t_assignee">
                  <Select id="t_assignee" value={form.assignee_id ?? ''} onChange={set('assignee_id')}>
                    <option value="">Anyone</option>
                    {members.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.display_name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Category" htmlFor="t_cat">
                  <Select id="t_cat" value={form.category ?? ''} onChange={set('category')}>
                    {CATEGORIES.map(([k, l]) => (
                      <option key={k} value={k}>
                        {l}
                      </option>
                    ))}
                  </Select>
                </Field>
              </>
            )}
            <Field label="Status" htmlFor="t_status" className={isStaff ? 'col-span-2' : ''}>
              <Select id="t_status" value={form.status ?? 'todo'} onChange={set('status')}>
                {STATUSES.map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Notes" htmlFor="t_notes" className="col-span-2">
              <Textarea id="t_notes" value={form.notes ?? ''} onChange={set('notes')} />
            </Field>
            <div className="col-span-2">
              <ErrorNote error={save.error ?? remove.error} />
            </div>
            <Button size="lg" className="col-span-2" onClick={() => save.mutate()} disabled={save.isPending}>
              {save.isPending ? 'Saving…' : 'Save'}
            </Button>
            {t?.booking_id && !isStaff && (
              <Button asChild variant="outline" className="col-span-2">
                <Link to={`/bookings/${t.booking_id}`}>Open booking</Link>
              </Button>
            )}
            {t && !isStaff && (
              <Button
                variant="ghost"
                className="col-span-2 text-destructive"
                onClick={() => remove.mutate()}
                disabled={remove.isPending}
              >
                Delete task
              </Button>
            )}
          </div>
        </DialogContent>
      )}
    </Dialog>
  )
}
