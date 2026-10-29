import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Download } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { unwrap } from '@/lib/queries'
import { ErrorNote } from '@/components/common'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatDate, formatTimestamp } from '@/domain/format'

/** Nightly JSON snapshots (owner only: the backups bucket is owner-readable). */
export function BackupsCard({ owner }: { owner: boolean }) {
  const qc = useQueryClient()
  const files = useQuery({
    queryKey: ['backups'],
    enabled: owner,
    queryFn: async () => {
      const { data, error } = await supabase.storage.from('backups').list('', { limit: 100, sortBy: { column: 'name', order: 'desc' } })
      if (error) throw new Error(error.message)
      return (data ?? []).filter((f) => f.name.endsWith('.json'))
    },
  })
  const runs = useQuery({
    queryKey: ['sync_runs', 'backups'],
    queryFn: async () =>
      unwrap(await supabase.from('sync_runs').select('*').in('job_name', ['nightly_backup', 'sheet_mirror']).order('started_at', { ascending: false }).limit(6)),
  })
  const now = useMutation({
    mutationFn: async () => {
      const { data } = await supabase.auth.getSession()
      const res = await fetch('/api/backup-now', { method: 'POST', headers: { authorization: `Bearer ${data.session?.access_token ?? ''}` } })
      if (!res.ok) throw new Error(res.status === 404 ? 'Backups run on the deployed site (Netlify), not in local dev.' : await res.text())
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['backups'] })
      qc.invalidateQueries({ queryKey: ['sync_runs'] })
      toast.success('Backup saved')
    },
  })
  async function download(name: string) {
    const { data, error } = await supabase.storage.from('backups').createSignedUrl(name, 120, { download: name })
    if (error) return toast.error(error.message)
    window.location.href = data.signedUrl
  }

  const lastBackup = runs.data?.find((r) => r.job_name === 'nightly_backup')
  const lastMirror = runs.data?.find((r) => r.job_name === 'sheet_mirror')
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>Backups</CardTitle>
        {owner && (
          <Button variant="outline" size="sm" onClick={() => now.mutate()} disabled={now.isPending}>
            {now.isPending ? 'Backing up…' : 'Back up now'}
          </Button>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        <p className="text-muted-foreground">
          Every night at 01:00 Karachi time: a full JSON snapshot (kept 30 days) and a refresh of the read-only Google Sheet copy. To restore,
          see README "Restoring from a backup".
        </p>
        <ul className="text-sm">
          <li>
            Last snapshot:{' '}
            {lastBackup ? (
              <>
                <Badge variant={lastBackup.result === 'ok' ? 'success' : 'danger'}>{lastBackup.result}</Badge> {formatTimestamp(lastBackup.started_at)}
                {lastBackup.error && <span className="block text-destructive">{lastBackup.error}</span>}
              </>
            ) : (
              'not yet'
            )}
          </li>
          <li>
            Last Google Sheet copy:{' '}
            {lastMirror ? (
              <>
                <Badge variant={lastMirror.result === 'ok' ? 'success' : 'danger'}>{lastMirror.result}</Badge> {formatTimestamp(lastMirror.started_at)}
                {lastMirror.error && <span className="block text-destructive">{lastMirror.error}</span>}
              </>
            ) : (
              'not yet (needs the Google service account)'
            )}
          </li>
        </ul>
        <ErrorNote error={now.error ?? files.error} />
        {owner && (
          <ul className="divide-y rounded-md border">
            {files.data?.slice(0, 10).map((f) => (
              <li key={f.name} className="flex items-center justify-between gap-2 px-3 py-2">
                <span>
                  {formatDate(f.name.slice(0, 10))}
                  <span className="ml-2 text-xs text-muted-foreground">{Math.round(Number(f.metadata?.size ?? 0) / 1024)} KB</span>
                </span>
                <Button variant="ghost" size="sm" onClick={() => download(f.name)}>
                  <Download aria-hidden /> Download
                </Button>
              </li>
            ))}
            {files.data?.length === 0 && <li className="px-3 py-2 text-muted-foreground">No snapshots yet.</li>}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
