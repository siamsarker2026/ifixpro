'use client'

import * as XLSX from 'xlsx'

interface ExportStockExcelProps {
  data: Array<Record<string, unknown>>
  fileName?: string
}

export function ExportStockExcel({ data, fileName = 'technician_stock_snapshot.xlsx' }: ExportStockExcelProps) {
  const handleExport = () => {
    const worksheet = XLSX.utils.json_to_sheet(data)
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Stock Snapshot')
    XLSX.writeFile(workbook, fileName)
  }

  return (
    <button onClick={handleExport}>
      📥 Export Excel
    </button>
  )
}