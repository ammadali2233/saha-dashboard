import { useEffect, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import { OPERATING_CATEGORIES, SETUP_CATEGORIES, useExpense, useSaveExpense } from './api'
import { openFile, uploadFile } from '@/features/bookings/api'
import { usePartners } from '@/lib/queries'
import { supabase } from '@/lib/supabase'
import { ErrorNote, Loading, PageHeader } from '@/components/common'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field, Select, Textarea } from '@/components/ui/form-controls'
import { Card, CardContent } from '@/components/ui/card'
import { pkToday } from '@/domain/format'

const schema = z
  .object({
    kind: z.enum(['setup', 'operating']),
    expense_date: z.string().min(1, 'Pick a date'),
    category: z.string().min(1, 'Pick a category'),
    item: z.string().trim().min(1, 'What was it for?'),
    vendor: z.string().trim(),
    amount: z.coerce.number().positive('Enter the amount'),
    budget_amount: z.union([z.literal(''), z.coerce.number().nonnegative()]),
    status: z.enum(['due', 'paid']),
    paid_date: z.string(),
    paid_by_partner_id: z.string(),
    reimbursable: z.boolean(),
    reimbursed_date: z.string(),
    notes: z.string(),
  })
  .refine((v) => v.status !== 'paid' || !!v.paid_date, { message: 'When was it paid?', path: ['paid_date'] })

type FormValues = z.input<typeof schema>
type Parsed = z.output<typeof schema>

export function ExpenseFormPage() {
  const { id } = useParams()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const existing = useExpense(id)
  const partners = usePartners()
  const save = useSaveExpense()
  const [file, setFile] = useState<File | null>(null)

  const form = useForm<FormValues, unknown, Parsed>({
    resolver: zodResolver(schema),
    defaultValues: {
      kind: params.get('kind') === 'setup' ? 'setup' : 'operating',
      expense_date: pkToday(),
      category: '',
      item: '',
      vendor: '',
      amount: '' as unknown as number,
      budget_amount: '',
      status: 'paid',
      paid_date: pkToday(),
      paid_by_partner_id: '',
      reimbursable: true,
      reimbursed_date: '',
      notes: '',
    },
  })

  useEffect(() => {
    const e = existing.data
    if (!e) return
    form.reset({
      kind: e.kind,
      expense_date: e.expense_date,
      category: e.category,
      item: e.item,
      vendor: e.vendor ?? '',
      amount: Number(e.amount),
      budget_amount: e.budget_amount ?? '',
      status: e.status,
      paid_date: e.paid_date ?? '',
      paid_by_partner_id: e.paid_by_partner_id ?? '',
      reimbursable: e.reimbursable,
      reimbursed_date: e.reimbursed_date ?? '',
      notes: e.notes ?? '',
    })
  }, [existing.data, form])

  const v = useWatch({ control: form.control })
  const categories = v.kind === 'setup' ? SETUP_CATEGORIES : OPERATING_CATEGORIES
  const byPartner = !!v.paid_by_partner_id

  async function onSubmit(x: Parsed) {
    try {
      const receipt_path = file ? await uploadFile('receipts', file, x.kind) : (existing.data?.receipt_path ?? null)
      const operatingByPartner = x.kind === 'operating' && !!x.paid_by_partner_id
      await save.mutateAsync({
        id,
        kind: x.kind,
        expense_date: x.expense_date,
        category: x.category,
        item: x.item,
        vendor: x.vendor || null,
        amount: x.amount,
        currency: 'PKR',
        budget_amount: x.kind === 'setup' && x.budget_amount !== '' ? x.budget_amount : null,
        status: x.status,
        paid_date: x.status === 'paid' ? x.paid_date : null,
        paid_by_partner_id: x.paid_by_partner_id || null,
        reimbursable: operatingByPartner && x.reimbursable,
        reimbursed_date: operatingByPartner && x.reimbursable && x.reimbursed_date ? x.reimbursed_date : null,
        notes: x.notes || null,
        receipt_path,
      })
      toast.success(id ? 'Expense updated' : 'Expense added')
      navigate(`/money?tab=${x.kind}`, { replace: true })
    } catch {
      // shown via save.error
    }
  }

  async function softDelete() {
    if (!id || !window.confirm('Delete this expense? The owner can restore it.')) return
    const { error } = await supabase.from('expenses').update({ deleted_at: new Date().toISOString() }).eq('id', id)
    if (error) return toast.error(error.message)
    toast.success('Expense deleted')
    navigate('/money', { replace: true })
  }

  if (id && existing.isPending) return <Loading />
  const err = form.formState.errors

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="flex flex-col gap-4">
      <PageHeader title={id ? 'Edit expense' : 'New expense'} back={`/money?tab=${v.kind ?? 'operating'}`} />
      <Card>
        <CardContent className="grid grid-cols-1 gap-4 pt-4 sm:grid-cols-2">
          <Field label="Kind" htmlFor="kind" hint={v.kind === 'setup' ? 'Capital: stays out of the P&L' : 'Counts in the P&L'}>
            <Select
              id="kind"
              {...form.register('kind', { onChange: () => form.setValue('category', '') })}
            >
              <option value="operating">Operating</option>
              <option value="setup">Setup</option>
            </Select>
          </Field>
          <Field label="Category" htmlFor="category" error={err.category?.message}>
            <Select id="category" {...form.register('category')} aria-invalid={!!err.category}>
              <option value="">Choose…</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Item" htmlFor="item" error={err.item?.message} className="sm:col-span-2">
            <Input id="item" {...form.register('item')} aria-invalid={!!err.item} />
          </Field>
          <Field label="Amount (PKR)" htmlFor="amount" error={err.amount?.message}>
            <Input id="amount" type="number" inputMode="decimal" step="any" {...form.register('amount')} aria-invalid={!!err.amount} />
          </Field>
          <Field label="Date" htmlFor="expense_date" error={err.expense_date?.message}>
            <Input id="expense_date" type="date" {...form.register('expense_date')} />
          </Field>
          {v.kind === 'setup' && (
            <Field label="Budget (PKR)" htmlFor="budget_amount">
              <Input id="budget_amount" type="number" inputMode="decimal" step="any" {...form.register('budget_amount')} />
            </Field>
          )}
          <Field label="Vendor" htmlFor="vendor">
            <Input id="vendor" {...form.register('vendor')} />
          </Field>
          <Field label="Status" htmlFor="status">
            <Select id="status" {...form.register('status')}>
              <option value="paid">Paid</option>
              <option value="due">Due</option>
            </Select>
          </Field>
          {v.status === 'paid' && (
            <Field label="Paid on" htmlFor="paid_date" error={err.paid_date?.message}>
              <Input id="paid_date" type="date" {...form.register('paid_date')} />
            </Field>
          )}
          <Field
            label="Paid by"
            htmlFor="paid_by_partner_id"
            hint={
              byPartner
                ? v.kind === 'setup'
                  ? "Counts as this partner's capital contribution"
                  : 'The project account owes this back'
                : undefined
            }
          >
            <Select id="paid_by_partner_id" {...form.register('paid_by_partner_id')}>
              <option value="">Project account</option>
              {partners.data?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} (personally)
                </option>
              ))}
            </Select>
          </Field>
          {v.kind === 'operating' && byPartner && (
            <>
              <label className="flex min-h-11 items-center gap-3 text-sm">
                <input type="checkbox" className="size-5" {...form.register('reimbursable')} />
                Reimburse this partner from the project account
              </label>
              {v.reimbursable && (
                <Field label="Reimbursed on" htmlFor="reimbursed_date" hint="Leave empty until repaid">
                  <Input id="reimbursed_date" type="date" {...form.register('reimbursed_date')} />
                </Field>
              )}
            </>
          )}
          <Field
            label="Receipt (photo or PDF)"
            htmlFor="receipt"
            className="sm:col-span-2"
            hint={existing.data?.receipt_path ? 'A receipt is attached; choose a file to replace it' : undefined}
          >
            <Input id="receipt" type="file" accept="image/*,application/pdf" className="py-2" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </Field>
          <Field label="Notes" htmlFor="notes" className="sm:col-span-2">
            <Textarea id="notes" {...form.register('notes')} />
          </Field>
        </CardContent>
      </Card>
      <ErrorNote error={save.error} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="lg" disabled={save.isPending} className="flex-1 sm:flex-none">
          {save.isPending ? 'Saving…' : id ? 'Save changes' : 'Add expense'}
        </Button>
        {existing.data?.receipt_path && (
          <Button type="button" variant="outline" size="lg" onClick={() => openFile('receipts', existing.data!.receipt_path!).catch((e: Error) => toast.error(e.message))}>
            View receipt
          </Button>
        )}
        {id && (
          <Button type="button" variant="ghost" size="lg" className="text-destructive" onClick={softDelete}>
            Delete
          </Button>
        )}
      </div>
    </form>
  )
}
