import * as XLSX from 'xlsx'
import { statSync } from 'node:fs'

const MAX_SHEETS = 3
const MAX_ROWS = 100
const MAX_COLS = 20
const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB

type PreviewOptions = {
  maxSheets?: number
  maxRows?: number
  maxCols?: number
}

function escapeMdTable(text: unknown): string {
  const s = String(text ?? '')
  return s.replace(/\|/g, '\\|').replace(/\n/g, ' ')
}

function sheetToMarkdown(sheet: XLSX.WorkSheet, sheetName: string, maxRows: number, maxCols: number): string {
  const ref = sheet['!ref']
  if (!ref) return `## ${sheetName}\n\n*(空 sheet)*\n`

  const rows = XLSX.utils.sheet_to_json<(string | number | boolean | undefined)[]>(sheet, {
    header: 1,
    defval: '',
    blankrows: false,
  })

  if (rows.length === 0) return `## ${sheetName}\n\n*(空 sheet)*\n`

  const sliced = rows.slice(0, maxRows + 1)
  const headerRow = sliced[0] ?? []
  const dataRows = sliced.slice(1) as (string | number | boolean | undefined)[][]

  const cols = headerRow.slice(0, maxCols)
  const headers = cols.map((h) => escapeMdTable(h))

  const body = dataRows.map((row) => {
    const cells = Array.from({ length: cols.length }, (_, i) => escapeMdTable(row[i]))
    return `| ${cells.join(' | ')} |`
  })

  const separator = `| ${cols.map(() => '---').join(' | ')} |`
  const headerLine = `| ${headers.join(' | ')} |`

  let md = `## ${sheetName}\n\n`
  md += `${headerLine}\n${separator}\n${body.join('\n')}\n`

  if (rows.length > maxRows + 1) {
    md += `\n*仅显示前 ${maxRows} 行数据*\n`
  }

  return md
}

export async function generateSheetMarkdown(
  filePath: string,
  options?: PreviewOptions,
): Promise<string> {
  const maxSheets = options?.maxSheets ?? MAX_SHEETS
  const maxRows = options?.maxRows ?? MAX_ROWS
  const maxCols = options?.maxCols ?? MAX_COLS

  const st = statSync(filePath)
  if (st.size > MAX_FILE_SIZE) {
    throw new Error('EXCEL_PREVIEW_TOO_LARGE：文件过大，无法预览（超过 10MB）')
  }

  const workbook = XLSX.readFile(filePath, { dense: false })

  if (workbook.SheetNames.length === 0) {
    throw new Error('EXCEL_PREVIEW_EMPTY_WORKBOOK：工作簿中没有 sheet')
  }

  const sheets = workbook.SheetNames.slice(0, maxSheets)
  const parts: string[] = []

  for (const name of sheets) {
    const sheet = workbook.Sheets[name]
    parts.push(sheetToMarkdown(sheet, name, maxRows, maxCols))
  }

  if (workbook.SheetNames.length > maxSheets) {
    parts.push(`\n*工作簿共有 ${workbook.SheetNames.length} 个 sheet，仅显示前 ${maxSheets} 个*\n`)
  }

  return parts.join('\n')
}
