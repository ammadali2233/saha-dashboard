// Reads the Google Sheet .xlsx export into plain rows keyed by header text.
import ExcelJS from 'exceljs'

export type Cell = string | number | boolean | null

export interface SheetRow {
  row: number
  get(header: string): Cell
  str(header: string): string
  num(header: string): number | null
  date(header: string): string | null
}

function cellValue(c: ExcelJS.Cell): Cell {
  let v: unknown = c.value
  if (v && typeof v === 'object') {
    if (v instanceof Date) return v.toISOString().slice(0, 10)
    const o = v as Record<string, unknown>
    if ('result' in o) v = o.result
    else if ('richText' in o) v = (o.richText as { text: string }[]).map((t) => t.text).join('')
    else if ('text' in o) v = o.text
    else if ('formula' in o || 'sharedFormula' in o) v = null // formula with no cached result = blank
    else if ('error' in o) v = null
  }
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  if (v === undefined || v === '') return null
  return v as Cell
}

/** Rows below `headerRow`, keyed by the header cell text. Rows without `keyHeader` are skipped. */
export function readTable(ws: ExcelJS.Worksheet, headerRow: number, keyHeader: string): SheetRow[] {
  const headers = new Map<string, number>()
  ws.getRow(headerRow).eachCell((c, col) => {
    const h = String(cellValue(c) ?? '').trim()
    if (h && !headers.has(h)) headers.set(h, col)
  })
  if (!headers.has(keyHeader)) throw new Error(`"${ws.name}": header "${keyHeader}" not found in row ${headerRow}`)

  const out: SheetRow[] = []
  for (let r = headerRow + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r)
    const get = (h: string): Cell => {
      const col = headers.get(h)
      if (!col) throw new Error(`"${ws.name}": no column "${h}"`)
      return cellValue(row.getCell(col))
    }
    if (get(keyHeader) == null) continue
    out.push({
      row: r,
      get,
      str: (h) => String(get(h) ?? '').trim(),
      num: (h) => {
        const v = get(h)
        if (v == null) return null
        const n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, ''))
        return Number.isFinite(n) ? n : null
      },
      date: (h) => {
        const v = get(h)
        if (v == null) return null
        const s = String(v)
        return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null
      },
    })
  }
  return out
}

export async function openWorkbook(path: string) {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(path)
  const sheet = (name: string) => {
    const ws = wb.getWorksheet(name)
    if (!ws) throw new Error(`Tab "${name}" not found in ${path}`)
    return ws
  }
  return { wb, sheet }
}
