import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const badgeVariants = cva('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap', {
  variants: {
    variant: {
      default: 'bg-muted text-foreground',
      success: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
      warning: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
      danger: 'bg-destructive/15 text-destructive',
      info: 'bg-sky-500/15 text-sky-700 dark:text-sky-300',
      outline: 'border text-muted-foreground',
    },
  },
  defaultVariants: { variant: 'default' },
})

export function Badge({
  className,
  variant,
  ...props
}: React.ComponentProps<'span'> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />
}
