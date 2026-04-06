/**
 * CLI UI 组件 - Table
 */

export interface TableColumn {
  key: string;
  header: string;
  width?: number;
}

export function renderTable<T extends Record<string, unknown>>(
  data: T[],
  columns: TableColumn[]
): string {
  if (data.length === 0) {
    return 'No data to display.\n';
  }

  // Calculate column widths
  const widths = columns.map(col => {
    const headerWidth = col.header.length;
    const maxDataWidth = Math.max(
      ...data.map(row => String(row[col.key] ?? '').length),
      headerWidth
    );
    return col.width ?? Math.min(maxDataWidth + 2, 40);
  });

  // Build header
  const header = columns
    .map((col, i) => col.header.padEnd(widths[i]))
    .join(' | ');

  const separator = widths.map(w => '-'.repeat(w)).join('-+-');

  // Build rows with truncation indicator
  const rows = data.map(row =>
    columns
      .map((col, i) => {
        const value = String(row[col.key] ?? '');
        if (value.length > widths[i]) {
          return value.slice(0, widths[i] - 1) + '\u2026'; // ellipsis
        }
        return value.padEnd(widths[i]);
      })
      .join(' | ')
  );

  return [header, separator, ...rows].join('\n') + '\n';
}
