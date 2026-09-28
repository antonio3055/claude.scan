/**
 * Rebuild text lines from PDF.js text items.
 *
 * Items are grouped by baseline, then joined by the measured gap between them
 * rather than unconditionally with a space. Some banks emit every single
 * character as its own text item; joining those with spaces produced
 * "2 3 H U N D R E D  V E N T U R E S  I N C", which no downstream rule could
 * read. Measuring the gap reconstructs the real words and leaves ordinary
 * word-per-item statements exactly as they were.
 *
 * Plain JavaScript with no DOM, so the Node suite exercises this exact code.
 */

/** Baselines within this many units are treated as the same visual row. */
const ROW_TOLERANCE = 2;

/**
 * Characters inside a word are emitted flush (gap 0), so a small threshold
 * separates real words without splitting letter-spaced text.
 */
export function spaceThreshold(size) {
  return Math.max(0.5, (Number(size) || 10) * 0.12);
}

export function toRowItem(item) {
  const transform = item?.transform ?? [];
  const size = Math.abs(Number(transform[0] ?? transform[3] ?? 0)) || Number(item?.height ?? 0) || 10;
  return {
    x: Number(transform[4] ?? 0),
    y: Number(transform[5] ?? 0),
    width: Number(item?.width ?? 0),
    size,
    text: String(item?.str ?? '')
  };
}

export function joinRow(row) {
  const sorted = [...row].sort((a, b) => a.x - b.x);
  let line = '';
  let cursor = null;

  for (const item of sorted) {
    if (!item.text) continue;

    if (cursor !== null && item.x - cursor >= spaceThreshold(item.size)) line += ' ';

    line += item.text;
    cursor = item.x + item.width;
  }

  return line.replace(/\s+/g, ' ').trim();
}

/**
 * v10 row reconstruction: group text items by baseline, then order by x.
 *
 * `mergeNearRows` is for application forms. Their generators print each
 * answer a little above its label -- 0.75 units on one form (670.416 /
 * 671.169), 1.5 on another -- so label and answer can round into
 * neighbouring buckets and split one printed line in two, the answer on its
 * own line above its label ("DIMAS TOWER INC." / "Legal Business Name"),
 * where no label-based rule can pair them. With it, neighbouring buckets
 * whose nearest items are closer than a bucket's width are joined back into
 * one line. Statements never use it: joining their near lines puts a
 * holder's name on one line with the bank's phone numbers beside it, and
 * their text is left exactly as it has always been built.
 */
export function rebuildRows(items, { mergeNearRows = false } = {}) {
  const rows = new Map();

  for (const raw of items ?? []) {
    const item = toRowItem(raw);
    const key = Math.round(item.y / ROW_TOLERANCE) * ROW_TOLERANCE;
    const row = rows.get(key) ?? [];
    row.push(item);
    rows.set(key, row);
  }

  const ordered = [...rows.entries()].sort((a, b) => b[0] - a[0]).map(([, row]) => row);
  const merged = [];
  for (const row of ordered) {
    const above = merged[merged.length - 1];
    const gap = mergeNearRows && above ? Math.min(...above.map((item) => item.y)) - Math.max(...row.map((item) => item.y)) : Infinity;
    if (gap < ROW_TOLERANCE) above.push(...row);
    else merged.push([...row]);
  }

  return (
    merged
      .map((row) => joinRow(row))
      .filter(Boolean)
      .join('\n') + '\n'
  );
}
