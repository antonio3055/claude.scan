import { useVirtualizer } from "@tanstack/react-virtual";
import { Columns3, Download } from "lucide-react";
import { useMemo, useRef } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Hint } from "@/components/ui/tooltip";
import {
  RESULT_COLUMNS,
  WIDTH_CLASS,
  type ColumnId,
  type ResultColumn,
} from "@/lib/scan/columns";
import { exportResultsXlsx } from "@/lib/scan/export";
import { STATUS_LABEL, type QueueItem, type ScanStatus } from "@/lib/scan/types";
import { cn, formatCurrency, formatDurationMs, formatPercent } from "@/lib/utils";
import { useScanStore } from "@/store/scan-store";

const ROW_HEIGHT = 36;

export function ResultsGrid() {
  const items = useScanStore((s) => s.items);
  const visibleColumns = useScanStore((s) => s.visibleColumns);
  const setColumnVisible = useScanStore((s) => s.setColumnVisible);
  const resetColumns = useScanStore((s) => s.resetColumns);
  const parentRef = useRef<HTMLDivElement>(null);

  const columns = useMemo(
    () => RESULT_COLUMNS.filter((c) => visibleColumns.includes(c.id)),
    [visibleColumns],
  );

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 16,
  });

  const virtualRows = virtualizer.getVirtualItems();
  const paddingTop = virtualRows.length > 0 ? virtualRows[0]!.start : 0;
  const paddingBottom =
    virtualRows.length > 0
      ? virtualizer.getTotalSize() - virtualRows[virtualRows.length - 1]!.end
      : 0;

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h2 className="text-xs font-medium tracking-wide text-muted uppercase">Results</h2>
        <span className="text-2xs text-subtle">Fills in as each file finishes</span>
        <div className="ml-auto flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="outline" size="sm">
                <Columns3 />
                Columns
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="max-h-80 overflow-y-auto">
              <DropdownMenuLabel>Visible columns</DropdownMenuLabel>
              {RESULT_COLUMNS.map((col) => (
                <DropdownMenuCheckboxItem
                  key={col.id}
                  checked={visibleColumns.includes(col.id)}
                  onCheckedChange={(checked) => setColumnVisible(col.id, Boolean(checked))}
                  onSelect={(e) => e.preventDefault()}
                >
                  {col.label}
                </DropdownMenuCheckboxItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => resetColumns()}>Show all</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => void exportResultsXlsx(items, visibleColumns)}
          >
            <Download />
            Export to .xlsx
          </Button>
        </div>
      </div>
      <div
        ref={parentRef}
        className="relative min-h-96 flex-1 overflow-auto rounded-md bg-surface-2 shadow-border"
      >
        {items.length === 0 ? (
          <div className="flex h-full min-h-64 flex-col items-center justify-center gap-1 px-6 text-center">
            <p className="text-sm font-medium text-fg">No statements in the grid</p>
            <p className="max-w-sm text-xs text-muted">
              Upload PDFs or a zip of statements, then press Start. Rows appear immediately and fill in as
              extraction finishes.
            </p>
          </div>
        ) : (
          <table className="w-max min-w-full border-separate border-spacing-0 text-2xs">
            <thead>
              <tr>
                {columns.map((col, index) => (
                  <th
                    key={col.id}
                    className={cn(
                      "sticky top-0 z-20 border-b border-border bg-surface px-2.5 py-2 text-left text-2xs font-medium tracking-wide text-muted uppercase",
                      col.align === "right" && "text-right",
                      WIDTH_CLASS[col.width],
                      index === 0 && "left-0 z-30",
                    )}
                  >
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {paddingTop > 0 && (
                <tr>
                  <td colSpan={columns.length} style={{ height: paddingTop }} />
                </tr>
              )}
              {virtualRows.map((virtualRow) => {
                const item = items[virtualRow.index]!;
                return (
                  <ResultRow
                    key={item.id}
                    item={item}
                    columns={columns}
                    height={virtualRow.size}
                  />
                );
              })}
              {paddingBottom > 0 && (
                <tr>
                  <td colSpan={columns.length} style={{ height: paddingBottom }} />
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}

function ResultRow({
  item,
  columns,
  height,
}: {
  item: QueueItem;
  columns: ResultColumn[];
  height: number;
}) {
  return (
    <tr
      className={cn(
        "group transition-colors duration-300 ease-smooth",
        item.status === "scanning" ? "bg-scanning-dim" : "hover:bg-surface",
      )}
      style={{ height }}
    >
      {columns.map((col, index) => (
        <td
          key={col.id}
          className={cn(
            "border-b border-border px-2.5 text-fg transition-colors duration-300 ease-smooth",
            col.numeric && "font-mono tabular-nums",
            col.align === "right" && "text-right",
            WIDTH_CLASS[col.width],
            index === 0 && "sticky left-0 z-10",
            index === 0 && (item.status === "scanning" ? "bg-scanning-dim" : "bg-surface-2 group-hover:bg-surface"),
          )}
        >
          <Cell item={item} id={col.id} />
        </td>
      ))}
    </tr>
  );
}

function Cell({ item, id }: { item: QueueItem; id: ColumnId }) {
  const r = item.result;
  if (id === "filename") {
    return (
      <span className="block truncate font-medium" title={item.filename}>
        {item.filename}
        {item.fromCache ? (
          <span className="ml-1.5 font-normal text-subtle">cached</span>
        ) : null}
      </span>
    );
  }
  if (id === "status") return <StatusBadge status={item.status} />;
  if (!r) {
    return <span className="text-subtle">—</span>;
  }
  switch (id) {
    case "companyName":
      return <span className="block truncate">{r.companyName ?? "—"}</span>;
    case "dba":
      return <span className="block truncate">{r.dba ?? "—"}</span>;
    case "statementName":
      return <span className="block truncate font-mono">{r.statementName ?? "—"}</span>;
    case "address":
      return <span className="block truncate">{r.address ?? "—"}</span>;
    case "bank":
      return <span className="block truncate">{r.bank ?? "—"}</span>;
    case "accountNumber":
      return <span className="font-mono tabular-nums">{r.accountNumber ?? "—"}</span>;
    case "statementPeriod":
      return <span className="font-mono tabular-nums">{r.statementPeriod ?? "—"}</span>;
    case "openingBalance":
      return <>{formatCurrency(r.openingBalance)}</>;
    case "endingBalance":
      return <>{formatCurrency(r.endingBalance)}</>;
    case "deposits":
      return <>{formatCurrency(r.deposits)}</>;
    case "withdrawals":
      return <>{formatCurrency(r.withdrawals)}</>;
    case "reconciles":
      return <Reconciles value={r.reconciles} reason={r.reconcileReason} />;
    case "revenue":
      return <>{formatCurrency(r.revenue)}</>;
    case "confidenceLevel":
      return <Confidence value={r.confidenceLevel} />;
    case "pagesRead":
      return <>{r.pagesRead ?? "—"}</>;
    case "usedOcr":
      return <>{r.usedOcr == null ? "—" : r.usedOcr ? "Yes" : "No"}</>;
    case "extractionScore":
      return <>{formatPercent(r.extractionScore)}</>;
    case "timeTaken":
      return <>{formatDurationMs(r.timeTakenMs)}</>;
    default:
      return <span className="text-subtle">—</span>;
  }
}

function StatusBadge({ status }: { status: ScanStatus }) {
  const tone =
    status === "complete"
      ? "complete"
      : status === "needs_review"
        ? "review"
        : status === "failed"
          ? "failed"
          : status === "scanning"
            ? "scanning"
            : "queued";
  return (
    <Badge tone={tone} className={status === "scanning" ? "animate-pulse" : undefined}>
      {STATUS_LABEL[status]}
    </Badge>
  );
}

function Reconciles({ value, reason }: { value: boolean | null; reason: string | null | undefined }) {
  if (value == null) return <span className="text-subtle">—</span>;
  const label = value ? "Yes" : "No";
  const inner = (
    <span className={value ? "text-complete" : "text-failed"}>{label}</span>
  );
  if (!value && reason) {
    return <Hint label={reason}>{inner}</Hint>;
  }
  return inner;
}

function Confidence({ value }: { value: "high" | "medium" | "low" | null }) {
  if (!value) return <span className="text-subtle">—</span>;
  const tone = value === "high" ? "complete" : value === "medium" ? "review" : "failed";
  return <Badge tone={tone}>{value}</Badge>;
}
