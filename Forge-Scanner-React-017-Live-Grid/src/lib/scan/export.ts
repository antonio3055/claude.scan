import { RESULT_COLUMNS, exportCellValue, type ColumnId } from "./columns";
import type { QueueItem } from "./types";

export async function exportResultsXlsx(items: QueueItem[], visible: ColumnId[]): Promise<void> {
  const XLSX = await import("xlsx");
  const cols = RESULT_COLUMNS.filter((c) => visible.includes(c.id));
  const header = cols.map((c) => c.label);
  const body = items.map((item) =>
    cols.map((c) => {
      const value = exportCellValue(item, c.id);
      if (value == null) return "";
      if (typeof value === "boolean") return value ? "Yes" : "No";
      return value;
    }),
  );
  const sheet = XLSX.utils.aoa_to_sheet([header, ...body]);
  sheet["!cols"] = cols.map((c) => ({ wch: Math.max(12, c.label.length + 4) }));
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Results");
  const stamp = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(workbook, `northline-results-${stamp}.xlsx`);
}
