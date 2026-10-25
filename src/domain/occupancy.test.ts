import { describe, expect, it } from 'vitest'
import { findConflicts, occupancy, type Stay } from './occupancy'

const goLive = '2026-10-05'
const stay = (checkIn: string, checkOut: string, extra: Partial<Stay> = {}): Stay => ({
  checkIn,
  checkOut,
  status: 'confirmed',
  bookingType: 'standard',
  ...extra,
})

describe('occupancy (rules 5 and 7)', () => {
  it('counts occupied nights in the period over available nights', () => {
    const o = occupancy('2026-12-01', '2027-01-01', [stay('2026-12-27', '2027-01-10')], [], { goLive })
    expect(o).toEqual({ occupied: 5, available: 31, rate: 5 / 31 })
  })

  it('can never exceed 100%, even with overlapping stays', () => {
    const stays = [stay('2026-12-01', '2027-01-01'), stay('2026-12-10', '2026-12-20', { status: 'completed' })]
    const o = occupancy('2026-12-01', '2027-01-01', stays, [], { goLive })
    expect(o.occupied).toBe(31)
    expect(o.rate).toBe(1)
  })

  it('ignores nights before go-live', () => {
    const o = occupancy('2026-10-01', '2026-11-01', [stay('2026-10-10', '2026-10-12')], [], { goLive })
    expect(o.available).toBe(27) // 5 Oct to 31 Oct
    expect(o.occupied).toBe(2)
  })

  it('excludes cancelled, no-show, fraud and tentative stays', () => {
    const stays = (['cancelled', 'no_show', 'fraud', 'tentative'] as const).map((status) =>
      stay('2026-11-01', '2026-11-05', { status }),
    )
    expect(occupancy('2026-11-01', '2026-12-01', stays, [], { goLive }).occupied).toBe(0)
  })

  it('removes owner and maintenance nights from available; channel holds are ignored', () => {
    const o = occupancy(
      '2026-11-01',
      '2026-12-01',
      [],
      [
        { start: '2026-11-10', end: '2026-11-12', reason: 'owner_use' },
        { start: '2026-11-20', end: '2026-11-25', reason: 'channel_hold' },
      ],
      { goLive },
    )
    expect(o.available).toBe(28)
  })

  it('a stay on a blocked night still counts, keeping the cap', () => {
    const o = occupancy(
      '2026-11-01',
      '2026-11-03',
      [stay('2026-11-01', '2026-11-03')],
      [{ start: '2026-11-01', end: '2026-11-03', reason: 'maintenance' }],
      { goLive },
    )
    expect(o).toEqual({ occupied: 2, available: 2, rate: 1 })
  })

  it('optionally drops partner/promotional nights from both sides', () => {
    const stays = [stay('2026-11-01', '2026-11-11', { bookingType: 'partner_friends' }), stay('2026-11-20', '2026-11-25')]
    expect(occupancy('2026-11-01', '2026-12-01', stays, [], { goLive }).occupied).toBe(15)
    expect(occupancy('2026-11-01', '2026-12-01', stays, [], { goLive, excludeNonStandard: true })).toEqual({
      occupied: 5,
      available: 20,
      rate: 0.25,
    })
  })
})

describe('conflict detection (rule 5)', () => {
  it('finds overlapping stays and blocks, but not turnovers or channel holds', () => {
    const conflicts = findConflicts(
      [
        stay('2026-12-27', '2027-01-10', { id: 'a' }),
        stay('2027-01-10', '2027-01-12', { id: 'b' }),
        stay('2027-01-05', '2027-01-07', { id: 'c' }),
        stay('2027-01-01', '2027-01-03', { id: 'x', status: 'cancelled' }),
      ],
      [
        { id: 'h', start: '2027-01-01', end: '2027-01-02', reason: 'channel_hold' },
        { id: 'm', start: '2027-01-11', end: '2027-01-12', reason: 'maintenance' },
      ],
    )
    expect(conflicts).toEqual([
      { a: 'a', b: 'c', start: '2027-01-05', end: '2027-01-07' },
      { a: 'b', b: 'm', start: '2027-01-11', end: '2027-01-12' },
    ])
  })
})
