import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { MailCheck } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

const schema = z.object({ email: z.string().trim().toLowerCase().email('Enter a valid email address') })
type FormValues = z.infer<typeof schema>

export function LoginPage() {
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const form = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: { email: '' } })

  async function onSubmit({ email }: FormValues) {
    setError(null)
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin },
    })
    if (error) {
      setError(
        /access list|not allowed|403/i.test(error.message)
          ? 'This email is not on the DHA Retreat access list. Ask Ammad to add you.'
          : error.message,
      )
      return
    }
    setSentTo(email)
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
            <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4" noValidate>
              <div className="flex flex-col gap-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  inputMode="email"
                  aria-invalid={!!form.formState.errors.email}
                  {...form.register('email')}
                />
                {form.formState.errors.email && (
                  <p className="text-sm text-destructive">{form.formState.errors.email.message}</p>
                )}
              </div>
              {error && (
                <p className="text-sm text-destructive" role="alert">
                  {error}
                </p>
              )}
              <Button type="submit" size="lg" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? 'Sending…' : 'Email me a sign-in link'}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </main>
  )
}
