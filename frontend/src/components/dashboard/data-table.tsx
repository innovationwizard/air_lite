/**
 * Data Table Component
 * Advanced table with sorting, filtering, cursor-based pagination, and row actions
 */
'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { ChevronLeft, ChevronRight, ArrowUp, ArrowDown, ChevronsUpDown, Search } from 'lucide-react';

export interface Column<T> {
  key: string;
  header: string;
  sortable?: boolean;
  filterable?: boolean;
  render?: (value: unknown, row: T) => React.ReactNode;
  className?: string;
}

export interface DataTableProps<T> {
  data: T[];
  columns: Column<T>[];
  isLoading?: boolean;
  pagination?: {
    nextCursor: string | null;
    hasPrevious: boolean;
  };
  onNextPage?: () => void;
  onPreviousPage?: () => void;
  onSort?: (field: string, direction: 'asc' | 'desc') => void;
  onFilter?: (field: string, value: string) => void;
  currentSort?: { field: string; direction: 'asc' | 'desc' };
  emptyMessage?: string;
  className?: string;
  onRowClick?: (row: T) => void;
}

export function DataTable<T extends Record<string, any>>({
  data,
  columns,
  isLoading = false,
  pagination,
  onNextPage,
  onPreviousPage,
  onSort,
  onFilter,
  currentSort,
  emptyMessage = 'No data available',
  className,
  onRowClick,
}: DataTableProps<T>) {
  const [filters, setFilters] = React.useState<Record<string, string>>({});
  const [showFilters, setShowFilters] = React.useState(false);

  const handleSort = (field: string) => {
    if (!onSort) return;

    const newDirection =
      currentSort?.field === field && currentSort?.direction === 'asc'
        ? 'desc'
        : 'asc';

    onSort(field, newDirection);
  };

  const handleFilter = (field: string, value: string) => {
    setFilters((prev) => ({ ...prev, [field]: value }));
    onFilter?.(field, value);
  };

  const SortIcon: React.FC<{ field: string }> = ({ field }) => {
    if (!currentSort || currentSort.field !== field) {
      return <ChevronsUpDown className="h-4 w-4 text-muted-foreground" />;
    }

    return currentSort.direction === 'asc' ? (
      <ArrowUp className="h-4 w-4 text-primary" />
    ) : (
      <ArrowDown className="h-4 w-4 text-primary" />
    );
  };

  // Show filter toggle button if any column is filterable
  const hasFilterableColumns = columns.some((col) => col.filterable);

  return (
    <div className={cn('space-y-4', className)}>
      {/* Filter Toggle */}
      {hasFilterableColumns && (
        <div className="flex justify-end">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowFilters(!showFilters)}
          >
            <Search className="h-4 w-4 mr-2" />
            {showFilters ? 'Hide Filters' : 'Show Filters'}
          </Button>
        </div>
      )}

      {/* Table Container */}
      <div className="rounded-md border">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            {/* Table Header */}
            <thead className="bg-muted/50">
              <tr className="border-b">
                {columns.map((column) => (
                  <th
                    key={column.key}
                    className={cn(
                      'px-4 py-3 text-left font-medium text-muted-foreground',
                      column.sortable && 'cursor-pointer hover:text-foreground',
                      column.className
                    )}
                    onClick={() => column.sortable && handleSort(column.key)}
                  >
                    <div className="flex items-center gap-2">
                      <span>{column.header}</span>
                      {column.sortable && <SortIcon field={column.key} />}
                    </div>
                  </th>
                ))}
              </tr>

              {/* Filter Row */}
              {showFilters && (
                <tr className="border-b bg-background">
                  {columns.map((column) => (
                    <th key={`filter-${column.key}`} className="px-4 py-2">
                      {column.filterable && (
                        <Input
                          placeholder={`Filter ${column.header.toLowerCase()}...`}
                          value={filters[column.key] || ''}
                          onChange={(e) => handleFilter(column.key, e.target.value)}
                          className="h-8"
                        />
                      )}
                    </th>
                  ))}
                </tr>
              )}
            </thead>

            {/* Table Body */}
            <tbody>
              {isLoading ? (
                // Loading Skeleton
                Array.from({ length: 5 }).map((_, idx) => (
                  <tr key={`skeleton-${idx}`} className="border-b">
                    {columns.map((column) => (
                      <td key={column.key} className="px-4 py-3">
                        <Skeleton className="h-4 w-full" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : data.length === 0 ? (
                // Empty State
                <tr>
                  <td
                    colSpan={columns.length}
                    className="px-4 py-8 text-center text-muted-foreground"
                  >
                    {emptyMessage}
                  </td>
                </tr>
              ) : (
                // Data Rows
                data.map((row, idx) => (
                  <tr
                    key={idx}
                    className={cn(
                      'border-b transition-colors',
                      onRowClick && 'cursor-pointer hover:bg-muted/50'
                    )}
                    onClick={() => onRowClick?.(row)}
                  >
                    {columns.map((column) => (
                      <td
                        key={column.key}
                        className={cn('px-4 py-3', column.className)}
                      >
                        {column.render
                          ? column.render(row[column.key], row)
                          : row[column.key]}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination Controls */}
      {pagination && (onNextPage || onPreviousPage) && (
        <div className="flex items-center justify-between">
          <div className="text-sm text-muted-foreground">
            {pagination.hasPrevious || pagination.nextCursor
              ? 'Use navigation buttons to browse pages'
              : 'Showing all results'}
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={onPreviousPage}
              disabled={!pagination.hasPrevious || isLoading}
            >
              <ChevronLeft className="h-4 w-4 mr-1" />
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={onNextPage}
              disabled={!pagination.nextCursor || isLoading}
            >
              Next
              <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

