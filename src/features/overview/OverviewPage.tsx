import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useAuth } from '@/app/auth'
import { formatDate, pkToday } from '@/domain/format'

export function OverviewPage() {
  const { member } = useAuth()
  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="text-sm text-muted-foreground">{formatDate(pkToday())}</p>
        <h1 className="text-2xl font-semibold">Salaam, {member?.display_name.split(' ')[0]}</h1>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Overview is on its way</CardTitle>
          <CardDescription>
            KPIs, check-ins and alerts arrive once bookings, expenses and the sheet import are in (Phase 1b to 1d).
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Signed in as {member?.email} ({member?.role}).
        </CardContent>
      </Card>
    </div>
  )
}
