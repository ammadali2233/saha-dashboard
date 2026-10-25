// Hourly iCal import (Airbnb, Booking.com). Stubs, date changes, "possibly cancelled" flags, holds.
import type { Config } from '@netlify/functions'
import { runIcalImport } from '../lib/ical-sync'

export default async () => Response.json(await runIcalImport('schedule'))

export const config: Config = { schedule: '@hourly' }
