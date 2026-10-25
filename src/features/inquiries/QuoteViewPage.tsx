import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { useMutation } from '@tanstack/react-query'
import { CheckCircle2, Copy, FileDown, Link2, Pencil, Send, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import { toDoc, useInvalidateSales, useQuote } from './api'
import { QuoteDocument } from './QuoteDocument'
import { supabase } from '@/lib/supabase'
import { unwrap, useSettings } from '@/lib/queries'
import { ErrorNote, Loading, PageHeader, StatusBadge } from '@/components/common'
import { Button } from '@/components/ui/button'
import { formatDate, pkToday } from '@/domain/format'
import { quoteWhatsApp } from '@/domain/quote'

async function sha256Hex(text: string) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function copy(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast.success(`${what} copied`)
  } catch {
    toast.error('Could not copy: long-press to select instead')
  }
}

export function QuoteViewPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const q = useQuote(id)
  const settings = useSettings()
  const invalidate = useInvalidateSales()
  const [link, setLink] = useState<string | null>(null)

  const checkFree = async () => {
    const quote = q.data!.quote
    const conflicts = unwrap(await supabase.rpc('find_conflicts', { p_start: quote.check_in, p_end: quote.check_out }))
    const hard = conflicts.filter((c) => c.is_hard)
    if (hard.length) throw new Error(`Not available: overlaps ${hard.map((c) => c.label).join(', ')}.`)
  }

  const send = useMutation({
    mutationFn: async () => {
      await checkFree()
      unwrap(await supabase.from('quotes').update({ status: 'sent' }).eq('id', id!).select('id').single())
    },
    onSuccess: () => {
      invalidate()
      toast.success('Marked as sent. Copy the text or the link for WhatsApp.')
    },
  })
  const share = useMutation({
    mutationFn: async () => {
      if (q.data!.quote.status === 'draft') await send.mutateAsync()
      const bytes = crypto.getRandomValues(new Uint8Array(24))
      const token = btoa(String.fromCharCode(...bytes))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '')
      unwrap(
        await supabase
          .from('quotes')
          .update({ share_token_hash: await sha256Hex(token) })
          .eq('id', id!)
          .select('id')
          .single(),
      )
      return `${window.location.origin}/q/${token}`
    },
    onSuccess: (url) => {
      setLink(url)
      copy(url, 'Link')
    },
  })
  const accept = useMutation({
    mutationFn: async () => unwrap(await supabase.rpc('accept_quote', { p_quote: id! })) as string,
    onSuccess: (bookingId) => {
      invalidate()
      toast.success('Booking confirmed with its payment schedule')
      navigate(`/bookings/${bookingId}`)
    },
  })
  const decline = useMutation({
    mutationFn: async () =>
      unwrap(await supabase.from('quotes').update({ status: 'declined' }).eq('id', id!).select('id').single()),
    onSuccess: () => {
      invalidate()
      toast.success('Quote declined')
    },
  })
  const pdf = useMutation({
    mutationFn: async () => {
      const { data } = await supabase.auth.getSession()
      const res = await fetch(`/api/quote-pdf?id=${id}`, {
        headers: { authorization: `Bearer ${data.session?.access_token ?? ''}` },
      })
      if (!res.ok)
        throw new Error(
          res.status === 404
            ? 'PDFs are generated on the deployed site (Netlify), not in local dev.'
            : `PDF failed (${res.status})`,
        )
      const blob = await res.blob()
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `${q.data!.quote.number} DHA Retreat quotation.pdf`
      a.click()
      URL.revokeObjectURL(a.href)
    },
  })

  if (q.isPending || !settings.data) return <Loading />
  if (q.error || !q.data) return <ErrorNote error={q.error ?? 'Quote not found'} />
  const quote = q.data.quote
  const doc = toDoc(quote, q.data.lines, settings.data)
  const open = quote.status === 'draft' || quote.status === 'sent'
  const expired = quote.status === 'sent' && quote.valid_until && quote.valid_until < pkToday()

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={quote.number}
        back="/inquiries?tab=quotes"
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            {quote.prepared_for} <StatusBadge status={expired ? 'expired' : quote.status} />
            {expired && <span>valid until {formatDate(quote.valid_until!)}</span>}
          </span>
        }
        actions={
          open && (
            <Button asChild variant="outline">
              <Link to={`/quotes/${quote.id}/edit`}>
                <Pencil aria-hidden /> Edit
              </Link>
            </Button>
          )
        }
      />

      <div className="flex flex-wrap gap-2">
        {quote.status === 'draft' && (
          <Button onClick={() => send.mutate()} disabled={send.isPending}>
            <Send aria-hidden /> Check dates and mark sent
          </Button>
        )}
        <Button variant="outline" onClick={() => copy(quoteWhatsApp(doc), 'WhatsApp text')}>
          <Copy aria-hidden /> Copy for WhatsApp
        </Button>
        {open && (
          <Button variant="outline" onClick={() => share.mutate()} disabled={share.isPending}>
            <Link2 aria-hidden /> {quote.share_token_hash ? 'New share link' : 'Share link'}
          </Button>
        )}
        <Button variant="outline" onClick={() => pdf.mutate()} disabled={pdf.isPending}>
          <FileDown aria-hidden /> {pdf.isPending ? 'Making PDF…' : 'PDF'}
        </Button>
        {open && (
          <Button
            variant="secondary"
            disabled={accept.isPending}
            onClick={() =>
              window.confirm('Confirm the booking? This creates the booking, its payment schedule and tasks.') && accept.mutate()
            }
          >
            <CheckCircle2 aria-hidden /> Accept → booking
          </Button>
        )}
        {open && (
          <Button variant="ghost" className="text-destructive" onClick={() => decline.mutate()} disabled={decline.isPending}>
            <XCircle aria-hidden /> Declined
          </Button>
        )}
        {quote.booking_id && (
          <Button asChild variant="secondary">
            <Link to={`/bookings/${quote.booking_id}`}>Open booking</Link>
          </Button>
        )}
      </div>
      {link && (
        <p className="break-all rounded-md bg-muted p-3 text-sm">
          Read-only link (copied):{' '}
          <a className="text-primary underline" href={link} target="_blank" rel="noreferrer">
            {link}
          </a>
          . A new link replaces the old one.
        </p>
      )}
      <ErrorNote error={send.error ?? share.error ?? accept.error ?? decline.error ?? pdf.error} />
      <QuoteDocument doc={doc} />
    </div>
  )
}
