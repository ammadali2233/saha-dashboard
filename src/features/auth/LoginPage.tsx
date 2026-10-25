import { useState, type FormEvent } from 'react'
import { MailCheck } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

// Plain state and native validation: this is the first screen on a phone, so it stays light
// (no form or schema libraries in the initial download).
export function LoginPage() {
  const [email, setEmail] = useState('')
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const value = email.trim().toLowerCase()
    setError(null)
    setBusy(true)
    const { error } = await supabase.auth.signInWithOtp({
      email: value,
      options: { emailRedirectTo: window.location.origin },
    })
    setBusy(false)
    if (error) {
      setError(
        /access list|not allowed|403/i.test(error.message)
          ? 'This email is not on the DHA Retreat access list. Ask Ammad to add you.'
          : error.message,
      )
      return
    }
    setSentTo(value)
  }

  async function signInWithGoogle() {
    setError(null)
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    })
    if (error) setError(error.message)
  }

  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">SAHA Residences</p>
          <CardTitle className="text-2xl">DHA Retreat Ops</CardTitle>
          <CardDescription>Sign in with the email the owner added for you.</CardDescription>
        </CardHeader>
        <CardContent>
          {sentTo ? (
            <div className="flex flex-col items-center gap-3 py-4 text-center" role="status">
              <MailCheck className="size-10 text-primary" aria-hidden />
              <p>
                Check <strong>{sentTo}</strong> for a sign-in link.
              </p>
              <Button variant="ghost" onClick={() => setSentTo(null)}>
                Use a different email
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <Button type="button" size="lg" onClick={signInWithGoogle}>
                Continue with Google
              </Button>
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span className="h-px flex-1 bg-border" />
                or get an email link
                <span className="h-px flex-1 bg-border" />
              </div>
              <form onSubmit={onSubmit} className="flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    required
                    autoComplete="email"
                    inputMode="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
                {error && (
                  <p className="text-sm text-destructive" role="alert">
                    {error}
                  </p>
                )}
                <Button type="submit" size="lg" variant="outline" disabled={busy}>
                  {busy ? 'Sending…' : 'Email me a sign-in link'}
                </Button>
              </form>
            </div>
          )}
        </CardContent>
      </Card>
    </main>
  )
}
