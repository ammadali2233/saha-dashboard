import { describe, expect, it } from 'vitest'
import { toCsv } from './csv'

describe('toCsv', () => {
  it('quotes commas, quotes and line breaks; blanks nulls', () => {
    expect(
      toCsv([
        ['Item', 'Amount', 'Note'],
        ['Rent, Nov', 150000, 'said "paid"'],
        ['Line\nbreak', null, undefined],
      ]),
    ).toBe('Item,Amount,Note\r\n"Rent, Nov",150000,"said ""paid"""\r\n"Line\nbreak",,')
  })
})
