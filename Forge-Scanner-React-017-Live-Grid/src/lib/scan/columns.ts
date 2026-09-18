import type { QueueItem } from "./types";

export type ColumnId =
  | "filename"
  | "status"
  | "companyName"
  | "dba"
  | "statementName"
  | "address"
  | "bank"
  | "accountNumber"
  | "statementPeriod"
  | "openingBalance"
  | "endingBalance"
  | "deposits"
  | "withdrawals"
  | "reconciles"
  | "revenue"
  | "confidenceLevel"
  | "pagesRead"
  | "usedOcr"
  | "extractionScore"
  | "timeTaken";

export type ColumnWidth = "name" | "status" | "wide" | "addr" | "num" | "mid";

export interface ResultColumn {
  id: ColumnId;
  label: string;
  width: ColumnWidth;
  align: "left" | "right";
  numeric?: boolean;
  locked?: boolean;
}

export const RESULT_COLUMNS: ResultColumn[] = [
  { id: "filename", label: "Filename", width: "name", align: "left", locked: true },
  { id: "status", label: "Status", width: "status", align: "left", locked: true },
  { id: "companyName", label: "Company name", width: "wide", align: "left" },
  { id: "dba", label: "DBA", width: "mid", align: "left" },
  { id: "statementName", label: "Statement name", width: "wide", align: "left" },
  { id: "address", label: "Address", width: "addr", align: "left" },
  { id: "bank", label: "Bank", width: "wide", align: "left" },
  { id: "accountNumber", label: "Account number", width: "mid", align: "left" },
  { id: "statementPeriod", label: "Statement period", width: "wide", align: "left" },
  { id: "openingBalance", label: "Opening balance", width: "num", align: "right", numeric: true },
  { id: "endingBalance", label: "Ending balance", width: "num", align: "right", numeric: true },
  { id: "deposits", label: "Deposits", width: "num", align: "right", numeric: true },
  { id: "withdrawals", label: "Withdrawals", width: "num", align: "right", numeric: true },
  { id: "reconciles", label: "Reconciles", width: "mid", align: "left" },
  { id: "revenue", label: "Revenue", width: "num", align: "right", numeric: true },
  { id: "confidenceLevel", label: "Confidence", width: "mid", align: "left" },
  { id: "pagesRead", label: "Pages read", width: "num", align: "right", numeric: true },
  { id: "usedOcr", label: "Used OCR", width: "mid", align: "left" },
  { id: "extractionScore", label: "Extraction score", width: "num", align: "right", numeric: true },
  { id: "timeTaken", label: "Time taken", width: "num", align: "right", numeric: true },
];

export const DEFAULT_VISIBLE = RESULT_COLUMNS.map((c) => c.id);

export const WIDTH_CLASS: Record<ColumnWidth, string> = {
  name: "w-col-name min-w-col-name",
  status: "w-col-status min-w-col-status",
  wide: "w-col-wide min-w-col-wide",
  addr: "w-col-addr min-w-col-addr",
  num: "w-col-num min-w-col-num",
  mid: "w-col-mid min-w-col-mid",
};

export function exportCellValue(item: QueueItem, id: ColumnId): string | number | boolean | null {
  const r = item.result;
  switch (id) {
    case "filename":
      return item.filename;
    case "status":
      return item.status;
    case "companyName":
      return r?.companyName ?? null;
    case "dba":
      return r?.dba ?? null;
    case "statementName":
      return r?.statementName ?? null;
    case "address":
      return r?.address ?? null;
    case "bank":
      return r?.bank ?? null;
    case "accountNumber":
      return r?.accountNumber ?? null;
    case "statementPeriod":
      return r?.statementPeriod ?? null;
    case "openingBalance":
      return r?.openingBalance ?? null;
    case "endingBalance":
      return r?.endingBalance ?? null;
    case "deposits":
      return r?.deposits ?? null;
    case "withdrawals":
      return r?.withdrawals ?? null;
    case "reconciles":
      return r?.reconciles ?? null;
    case "revenue":
      return r?.revenue ?? null;
    case "confidenceLevel":
      return r?.confidenceLevel ?? null;
    case "pagesRead":
      return r?.pagesRead ?? null;
    case "usedOcr":
      return r?.usedOcr ?? null;
    case "extractionScore":
      return r?.extractionScore ?? null;
    case "timeTaken":
      return r?.timeTakenMs ?? null;
  }
}
