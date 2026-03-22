import type { Meta, StoryObj } from '@storybook/react';
import { DataTable, type Column } from './data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { Recommendation } from '@/types/api';

const meta = {
  title: 'Dashboard/Data Table',
  component: DataTable,
  parameters: {
    layout: 'padded',
  },
  tags: ['autodocs'],
} satisfies Meta<typeof DataTable>;

export default meta;
type Story = StoryObj<typeof meta>;

// Mock data for recommendations
const mockRecommendations: Recommendation[] = [
  {
    recommendation_id: 1,
    sku: 'PROD-12345',
    product_name: 'Industrial Widget Type A',
    current_stock: 45,
    recommended_order_quantity: 500,
    reorder_point: 120,
    safety_stock: 80,
    priority: 'high',
    estimated_stockout_date: '2025-10-15',
    confidence_score: 0.87,
    supplier_id: 42,
    supplier_name: 'Acme Suppliers Inc.',
    estimated_lead_time_days: 14,
    cost_per_unit: 12.50,
    total_cost: 6250.00,
    generated_at: '2025-10-09T06:00:00Z',
  },
  {
    recommendation_id: 2,
    sku: 'PROD-67890',
    product_name: 'Premium Component B',
    current_stock: 12,
    recommended_order_quantity: 300,
    reorder_point: 50,
    safety_stock: 30,
    priority: 'critical',
    estimated_stockout_date: '2025-10-12',
    confidence_score: 0.92,
    supplier_id: 15,
    supplier_name: 'Global Parts Ltd.',
    estimated_lead_time_days: 21,
    cost_per_unit: 45.75,
    total_cost: 13725.00,
    generated_at: '2025-10-09T06:00:00Z',
  },
  {
    recommendation_id: 3,
    sku: 'PROD-11111',
    product_name: 'Standard Material C',
    current_stock: 230,
    recommended_order_quantity: 200,
    reorder_point: 180,
    safety_stock: 150,
    priority: 'medium',
    estimated_stockout_date: '2025-10-20',
    confidence_score: 0.75,
    supplier_id: 8,
    supplier_name: 'Local Distributors Co.',
    estimated_lead_time_days: 7,
    cost_per_unit: 8.25,
    total_cost: 1650.00,
    generated_at: '2025-10-09T06:00:00Z',
  },
];

// Column definitions for recommendations table
const recommendationColumns = [
  {
    key: 'sku',
    header: 'SKU',
    sortable: true,
    filterable: true,
    render: (value: unknown) => <span className="font-mono text-sm">{String(value)}</span>,
  },
  {
    key: 'product_name',
    header: 'Product',
    sortable: true,
    filterable: true,
  },
  {
    key: 'current_stock',
    header: 'Current Stock',
    sortable: true,
    render: (value: unknown) => <span className="font-medium">{String(value)}</span>,
    className: 'text-right',
  },
  {
    key: 'recommended_order_quantity',
    header: 'Order Qty',
    sortable: true,
    render: (value: unknown) => <span className="font-bold text-primary">{String(value)}</span>,
    className: 'text-right',
  },
  {
    key: 'priority',
    header: 'Priority',
    sortable: true,
    filterable: true,
    render: (value: unknown) => {
      const priority = value as 'critical' | 'high' | 'medium' | 'low';
      const variantMap = {
        critical: 'destructive' as const,
        high: 'warning' as const,
        medium: 'info' as const,
        low: 'secondary' as const,
      };
      const validPriority = (priority === 'critical' || priority === 'high' || priority === 'medium' || priority === 'low') 
        ? priority 
        : 'low';
      return (
        <Badge variant={variantMap[validPriority]}>
          {String(validPriority).toUpperCase()}
        </Badge>
      );
    },
  },
  {
    key: 'total_cost',
    header: 'Total Cost',
    sortable: true,
    render: (value: unknown) => (
      <span className="font-medium">
        ${typeof value === 'number' ? value.toLocaleString('en-US', { minimumFractionDigits: 2 }) : String(value)}
      </span>
    ),
    className: 'text-right',
  },
];

export const Default: Story = {
  args: {
    data: mockRecommendations,
    columns: recommendationColumns,
  },
};

export const Loading: Story = {
  args: {
    data: [],
    columns: recommendationColumns,
    isLoading: true,
  },
};

export const Empty: Story = {
  args: {
    data: [],
    columns: recommendationColumns,
    emptyMessage: 'No recommendations available',
  },
};

export const WithPagination: Story = {
  args: {
    data: mockRecommendations,
    columns: recommendationColumns,
    pagination: {
      nextCursor: 'eyJpZCI6M30=',
      hasPrevious: true,
    },
    onNextPage: () => console.log('Next page'),
    onPreviousPage: () => console.log('Previous page'),
  },
};

export const WithSorting: Story = {
  args: {
    data: mockRecommendations,
    columns: recommendationColumns,
    currentSort: {
      field: 'priority',
      direction: 'desc',
    },
    onSort: (field, direction) => console.log('Sort:', field, direction),
  },
};

export const WithFiltering: Story = {
  args: {
    data: mockRecommendations,
    columns: recommendationColumns,
    onFilter: (field, value) => console.log('Filter:', field, value),
  },
};

export const WithRowClick: Story = {
  args: {
    data: mockRecommendations,
    columns: recommendationColumns,
    onRowClick: (row) => console.log('Clicked row:', row),
  },
};

export const FullFeatured: Story = {
  args: {
    data: mockRecommendations,
    columns: recommendationColumns,
    pagination: {
      nextCursor: 'eyJpZCI6M30=',
      hasPrevious: false,
    },
    currentSort: {
      field: 'priority',
      direction: 'desc',
    },
    onNextPage: () => console.log('Next page'),
    onPreviousPage: () => console.log('Previous page'),
    onSort: (field, direction) => console.log('Sort:', field, direction),
    onFilter: (field, value) => console.log('Filter:', field, value),
    onRowClick: (row) => console.log('Clicked:', row.sku),
  },
};

// Simple user table example
const userColumns: Column<Record<string, unknown>>[] = [
  { key: 'user_id', header: 'ID', sortable: true },
  { key: 'username', header: 'Username', sortable: true, filterable: true },
  { key: 'email', header: 'Email', sortable: true, filterable: true },
  {
    key: 'is_active',
    header: 'Status',
    render: (value: unknown) => {
      const isActive = Boolean(value);
      return (
        <Badge variant={isActive ? 'success' : 'secondary'}>
          {isActive ? 'Active' : 'Inactive'}
        </Badge>
      );
    },
  },
  {
    key: 'actions',
    header: 'Actions',
    render: (_, row) => (
      <div className="flex gap-2">
        <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); console.log('Edit', row.username); }}>
          Edit
        </Button>
        <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); console.log('Delete', row.username); }}>
          Delete
        </Button>
      </div>
    ),
  },
];

const mockUsers = [
  { user_id: 1, username: 'jcontreras', email: 'jcontreras@airefill.com', is_active: true },
  { user_id: 2, username: 'agarcia', email: 'agarcia@airefill.com', is_active: true },
  { user_id: 3, username: 'mrodriguez', email: 'mrodriguez@airefill.com', is_active: false },
];

export const UserTable: Story = {
  args: {
    data: mockUsers,
    columns: userColumns,
    pagination: {
      nextCursor: null,
      hasPrevious: false,
    },
  },
};

