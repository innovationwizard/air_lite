import type { Meta, StoryObj } from '@storybook/react';
import { KPICard } from './kpi-card';
import { Package, DollarSign, TrendingUp, AlertTriangle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

const meta = {
  title: 'Dashboard/KPI Card',
  component: KPICard,
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <div className="w-[350px]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof KPICard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    title: 'Total Revenue',
    value: 125000,
    format: 'currency',
  },
};

export const WithPositiveChange: Story = {
  args: {
    title: 'Total Sales',
    value: 45234,
    format: 'number',
    change: 12.5,
    changeLabel: 'vs last month',
  },
};

export const WithNegativeChange: Story = {
  args: {
    title: 'Stockout Incidents',
    value: 3,
    format: 'number',
    change: -25,
    changeLabel: 'vs last week',
    variant: 'success',
  },
};

export const WithIcon: Story = {
  args: {
    title: 'Inventory Value',
    value: 1250000,
    format: 'currency',
    change: 5.2,
    icon: <Package className="h-4 w-4" />,
  },
};

export const Percentage: Story = {
  args: {
    title: 'Gross Margin',
    value: 28.5,
    format: 'percentage',
    change: 2.3,
    variant: 'success',
    icon: <TrendingUp className="h-4 w-4" />,
  },
};

export const Critical: Story = {
  args: {
    title: 'Critical Stock Items',
    value: 47,
    format: 'number',
    change: 15,
    variant: 'critical',
    icon: <AlertTriangle className="h-4 w-4" />,
    trend: 'up',
  },
};

export const Warning: Story = {
  args: {
    title: 'Low Stock Items',
    value: 123,
    format: 'number',
    variant: 'warning',
    trend: 'down',
  },
};

export const WithTrend: Story = {
  args: {
    title: 'Average Order Value',
    value: 3250,
    format: 'currency',
    change: 8.3,
    trend: 'up',
    variant: 'info',
  },
};

export const WithSubtitle: Story = {
  args: {
    title: 'Inventory Turnover',
    value: 4.2,
    format: 'text',
    subtitle: 'Times per year',
    change: 0.5,
    variant: 'success',
  },
};

export const WithFooter: Story = {
  args: {
    title: 'Active Products',
    value: 18543,
    format: 'number',
    footer: (
      <div className="flex gap-2">
        <Badge variant="success">In Stock: 15,234</Badge>
        <Badge variant="warning">Low: 3,309</Badge>
      </div>
    ),
  },
};

export const ComplexKPI: Story = {
  args: {
    title: 'Total Working Capital',
    value: 2450000,
    format: 'currency',
    subtitle: 'Tied in inventory',
    change: -3.2,
    changeLabel: 'vs last quarter',
    trend: 'down',
    variant: 'info',
    icon: <DollarSign className="h-4 w-4" />,
    footer: (
      <div className="text-xs text-muted-foreground">
        Target: $2.2M
      </div>
    ),
  },
};

export const Dashboard = {
  render: () => (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 bg-background">
      <KPICard
        title="Total Revenue"
        value={1250000}
        format="currency"
        change={12.5}
        icon={<DollarSign className="h-4 w-4" />}
      />
      <KPICard
        title="Inventory Turnover"
        value={4.2}
        format="text"
        subtitle="Times per year"
        change={0.3}
        variant="success"
        icon={<TrendingUp className="h-4 w-4" />}
      />
      <KPICard
        title="Critical Items"
        value={47}
        format="number"
        change={-5}
        variant="critical"
        icon={<AlertTriangle className="h-4 w-4" />}
        trend="down"
      />
      <KPICard
        title="Perfect Order Rate"
        value={96.7}
        format="percentage"
        change={1.2}
        variant="success"
        trend="up"
      />
    </div>
  ),
};

