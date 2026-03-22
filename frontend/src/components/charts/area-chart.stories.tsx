import type { Meta, StoryObj } from '@storybook/react';
import { AreaChartComponent } from './area-chart';

const meta = {
  title: 'Charts/Area Chart',
  component: AreaChartComponent,
  parameters: {
    layout: 'padded',
  },
  tags: ['autodocs'],
} satisfies Meta<typeof AreaChartComponent>;

export default meta;
type Story = StoryObj<typeof meta>;

const inventoryValueData = [
  { name: 'Jan', value: 2400000 },
  { name: 'Feb', value: 2210000 },
  { name: 'Mar', value: 2580000 },
  { name: 'Apr', value: 2390000 },
  { name: 'May', value: 2780000 },
  { name: 'Jun', value: 2650000 },
];

export const Default: Story = {
  args: {
    title: 'Inventory Value Over Time',
    description: 'Total inventory value by month',
    data: inventoryValueData,
    areas: [
      { dataKey: 'value', name: 'Inventory Value ($)', color: '#00aa44' },
    ],
  },
};

const demandTrendData = [
  { name: 'W1', week: 'W1', demand: 2400, capacity: 3000 },
  { name: 'W2', week: 'W2', demand: 1398, capacity: 3000 },
  { name: 'W3', week: 'W3', demand: 9800, capacity: 3000 },
  { name: 'W4', week: 'W4', demand: 3908, capacity: 3000 },
  { name: 'W5', week: 'W5', demand: 4800, capacity: 3000 },
  { name: 'W6', week: 'W6', demand: 3800, capacity: 3000 },
];

export const MultipleAreas: Story = {
  args: {
    title: 'Demand vs Capacity',
    description: 'Weekly demand tracking against capacity',
    data: demandTrendData,
    areas: [
      { dataKey: 'demand', name: 'Actual Demand', color: '#00aa44' },
      { dataKey: 'capacity', name: 'Capacity', color: '#16A34A' },
    ],
    xAxisKey: 'week',
  },
};

export const Stacked: Story = {
  args: {
    title: 'Stacked Area Chart',
    description: 'Cumulative view of multiple metrics',
    data: demandTrendData,
    areas: [
      { dataKey: 'demand', name: 'Demand', color: '#00aa44' },
      { dataKey: 'capacity', name: 'Capacity', color: '#16A34A' },
    ],
    stacked: true,
    xAxisKey: 'week',
  },
};

const revenueData = [
  { name: 'Jan', month: 'Jan', revenue: 450000, cost: 320000 },
  { name: 'Feb', month: 'Feb', revenue: 480000, cost: 335000 },
  { name: 'Mar', month: 'Mar', revenue: 520000, cost: 365000 },
  { name: 'Apr', month: 'Apr', revenue: 495000, cost: 348000 },
  { name: 'May', month: 'May', revenue: 580000, cost: 405000 },
  { name: 'Jun', month: 'Jun', revenue: 610000, cost: 425000 },
];

export const RevenueVsCost: Story = {
  args: {
    title: 'Revenue vs Cost Analysis',
    description: 'Monthly financial performance',
    data: revenueData,
    areas: [
      { dataKey: 'revenue', name: 'Revenue', color: '#16A34A' },
      { dataKey: 'cost', name: 'Cost', color: '#EF4444' },
    ],
    xAxisKey: 'month',
    height: 350,
  },
};

const stockLevelData = [
  { name: 'Oct 1', date: 'Oct 1', level: 15000 },
  { name: 'Oct 5', date: 'Oct 5', level: 14200 },
  { name: 'Oct 10', date: 'Oct 10', level: 13800 },
  { name: 'Oct 15', date: 'Oct 15', level: 16500 },
  { name: 'Oct 20', date: 'Oct 20', level: 15800 },
  { name: 'Oct 25', date: 'Oct 25', level: 17200 },
];

export const Simple: Story = {
  args: {
    data: stockLevelData,
    areas: [
      { dataKey: 'level', name: 'Stock Level', color: '#00aa44' },
    ],
    xAxisKey: 'date',
    showLegend: false,
    height: 200,
  },
};

export const NoCard: Story = {
  args: {
    data: inventoryValueData,
    areas: [
      { dataKey: 'value', name: 'Value', color: '#16A34A' },
    ],
    height: 300,
  },
};

export const WithCustomColors: Story = {
  args: {
    title: 'Custom Color Scheme',
    data: demandTrendData,
    areas: [
      { dataKey: 'demand', name: 'Demand', color: '#8B5CF6' },
      { dataKey: 'capacity', name: 'Capacity', color: '#06B6D4' },
    ],
    xAxisKey: 'week',
  },
};

