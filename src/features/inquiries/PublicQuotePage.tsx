import { useParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { QuoteDocument } from './QuoteDocument'
import type { QuoteDoc } from '@/domain/quote'

/** Read-only quote for the guest, opened from the shared link. No sign-in; the token is the key. */
export function PublicQuotePage() {
  const { token } = useParams()
  const q = useQuery({
    queryKey: ['public_quote', token],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_public_quote', { p_token: token! })
      if (error) throw new Error(error.message)
      return data as unknown as (QuoteDoc & { status: string }) | null
    },
  })
  return (
    <main className="min-h-dvh px-4 py-6">
      {q.isPending ? (
        <p className="py-10 text-center text-muted-foreground">Loading quotation…</p>
      ) : !q.data ? (
        <p className="py-10 text-center text-muted-foreground">
          This quotation link is not valid any more. Please ask us for a new one.
        </p>
      ) : (
        <>
          {q.data.status !== 'sent' && (
            <p className="mx-auto mb-3 max-w-2xl rounded-md bg-muted p-3 text-center text-sm">
              {q.data.status === 'accepted'
                ? 'This quotation has been accepted. Thank you!'
                : `This quotation is ${q.data.status}.`}
            </p>
          )}
          <QuoteDocument
            doc={{
              ...q.data,
              advance_pct: Number(q.data.advance_pct),
              deposit_amount: Number(q.data.deposit_amount),
              lines: q.data.lines.map((l) => ({
                ...l,
                qty: Number(l.qty),
                unit_amount: Number(l.unit_amount),
                amount: Number(l.amount),
              })),
            }}
          />
        </>
      )}
    </main>
  )
}
