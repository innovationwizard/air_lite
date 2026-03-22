import type { Meta, StoryObj } from '@storybook/react';
import { BarChartComponent } from './bar-chart';

const meta = {
  title: 'Charts/Bar Chart',
  component: BarChartComponent,
  parameters: {
    layout: 'padded',
  },
  tags: ['autodocs'],
} satisfies Meta<typeof BarChartComponent>;

export default meta;
type Story = StoryObj<typeof meta>;

const topProductsData = [
  { name: 'Product A', sales: 4000, revenue: 12000 },
  { name: 'Product B', sales: 3000, revenue: 9500 },
  { name: 'Product C', sales: 5000, revenue: 15000 },
  { name: 'Product D', sales: 2780, revenue: 8900 },
  { name: 'Product E', sales: 1890, revenue: 6200 },
];

export const Default: Story = {
  args: {
    title: 'Top Products by Sales',
    description: 'Best selling products this month',
    data: topProductsData,
    bars: [
      { dataKey: 'sales', name: 'Units Sold', color: '#00aa44' },
    ],
  },
};

export const MultipleBars: Story = {
  args: {
    title: 'Sales vs Revenue',
    description: 'Comparing units sold and revenue generated',
    data: topProductsData,
    bars: [
      { dataKey: 'sales', name: 'Units', color: '#00aa44' },
      { dataKey: 'revenue', name: 'Revenue ($)', color: '#16A34A' },
    ],
  },
};

export const Stacked: Story = {
  args: {
    title: 'Stacked Bar Chart',
    description: 'Total sales breakdown',
    data: topProductsData,
    bars: [
      { dataKey: 'sales', name: 'Units', color: '#00aa44' },
      { dataKey: 'revenue', name: 'Revenue', color: '#16A34A' },
    ],
    stacked: true,
  },
};

const supplierPerformanceData = [
  { name: 'Acme Corp', supplier: 'Acme Corp', onTime: 95, late: 5 },
  { name: 'Global Parts', supplier: 'Global Parts', onTime: 88, late: 12 },
  { name: 'Local Dist', supplier: 'Local Dist', onTime: 92, late: 8 },
  { name: 'Import Co', supplier: 'Import Co', onTime: 78, late: 22 },
];

export const Horizontal: Story = {
  args: {
    title: 'Supplier Performance',
    description: 'On-time delivery rates',
    data: supplierPerformanceData,
    bars: [
      { dataKey: 'onTime', name: 'On Time (%)', color: '#16A34A' },
      { dataKey: 'late', name: 'Late (%)', color: '#EF4444' },
    ],
    xAxisKey: 'supplier',
    horizontal: true,
    height: 300,
  },
};

const monthlyStockData = [
  { name: 'Jan', month: 'Jan', critical: 12, low: 45, adequate: 18234 },
  { name: 'Feb', month: 'Feb', critical: 8, low: 38, adequate: 18450 },
  { name: 'Mar', month: 'Mar', critical: 15, low: 52, adequate: 18320 },
  { name: 'Apr', month: 'Apr', critical: 5, low: 31, adequate: 18540 },
  { name: 'May', month: 'May', critical: 3, low: 28, adequate: 18620 },
  { name: 'Jun', month: 'Jun', critical: 7, low: 35, adequate: 18488 },
];

export const StackedByCategory: Story = {
  args: {
    title: 'Stock Level Distribution',
    description: 'Products by stock status over time',
    data: monthlyStockData,
    bars: [
      { dataKey: 'critical', name: 'Critical', color: '#EF4444' },
      { dataKey: 'low', name: 'Low', color: '#F59E0B' },
      { dataKey: 'adequate', name: 'Adequate', color: '#16A34A' },
    ],
    stacked: true,
    xAxisKey: 'month',
  },
};

export const SimpleBar: Story = {
  args: {
    data: topProductsData,
    bars: [
      { dataKey: 'sales', name: 'Sales', color: '#16A34A' },
    ],
    showLegend: false,
    height: 250,
  },
};

