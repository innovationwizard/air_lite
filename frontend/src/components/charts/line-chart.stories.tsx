import type { Meta, StoryObj } from '@storybook/react';
import { LineChartComponent } from './line-chart';

const meta = {
  title: 'Charts/Line Chart',
  component: LineChartComponent,
  parameters: {
    layout: 'padded',
  },
  tags: ['autodocs'],
} satisfies Meta<typeof LineChartComponent>;

export default meta;
type Story = StoryObj<typeof meta>;

// Mock data for demand forecasts
const demandForecastData = [
  { name: 'Jan', actual: 4000, forecast: 3800, lowerBound: 3600, upperBound: 4000 },
  { name: 'Feb', actual: 3000, forecast: 3200, lowerBound: 3000, upperBound: 3400 },
  { name: 'Mar', actual: 5000, forecast: 4800, lowerBound: 4600, upperBound: 5000 },
  { name: 'Apr', actual: 4500, forecast: 4600, lowerBound: 4400, upperBound: 4800 },
  { name: 'May', actual: 6000, forecast: 5800, lowerBound: 5600, upperBound: 6000 },
  { name: 'Jun', actual: 5500, forecast: 5600, lowerBound: 5400, upperBound: 5800 },
];

export const Default: Story = {
  args: {
    title: 'Demand Forecast',
    description: 'Actual vs predicted demand over time',
    data: demandForecastData,
    lines: [
      { dataKey: 'actual', name: 'Actual Demand', color: '#00aa44' },
      { dataKey: 'forecast', name: 'Forecast', color: '#16A34A' },
    ],
  },
};

export const WithConfidenceInterval: Story = {
  args: {
    title: 'Demand Forecast with Confidence Interval',
    description: '30-day rolling forecast',
    data: demandForecastData,
    lines: [
      { dataKey: 'actual', name: 'Actual', color: '#00aa44' },
      { dataKey: 'forecast', name: 'Predicted', color: '#16A34A' },
      { dataKey: 'upperBound', name: 'Upper Bound', color: '#F59E0B' },
      { dataKey: 'lowerBound', name: 'Lower Bound', color: '#EF4444' },
    ],
  },
};

const salesTrendData = [
  { name: 'Week 1', sales: 12000 },
  { name: 'Week 2', sales: 15000 },
  { name: 'Week 3', sales: 13500 },
  { name: 'Week 4', sales: 18000 },
  { name: 'Week 5', sales: 16500 },
  { name: 'Week 6', sales: 19000 },
];

export const SingleLine: Story = {
  args: {
    title: 'Weekly Sales Trend',
    data: salesTrendData,
    lines: [
      { dataKey: 'sales', name: 'Sales ($)', color: '#00aa44' },
    ],
    height: 250,
  },
};

const inventoryData = [
  { name: 'Jan', month: 'Jan', onHand: 8500, safetyStock: 5000 },
  { name: 'Feb', month: 'Feb', onHand: 7200, safetyStock: 5000 },
  { name: 'Mar', month: 'Mar', onHand: 9100, safetyStock: 5000 },
  { name: 'Apr', month: 'Apr', onHand: 6800, safetyStock: 5000 },
  { name: 'May', month: 'May', onHand: 10200, safetyStock: 5000 },
  { name: 'Jun', month: 'Jun', onHand: 8900, safetyStock: 5000 },
];

export const MultipleLines: Story = {
  args: {
    title: 'Inventory Levels vs Safety Stock',
    description: 'Monitor inventory against safety thresholds',
    data: inventoryData,
    lines: [
      { dataKey: 'onHand', name: 'On Hand', color: '#00aa44' },
      { dataKey: 'safetyStock', name: 'Safety Stock', color: '#EF4444' },
    ],
    xAxisKey: 'month',
  },
};

export const NoGridNoLegend: Story = {
  args: {
    data: salesTrendData,
    lines: [
      { dataKey: 'sales', name: 'Sales', color: '#16A34A' },
    ],
    showGrid: false,
    showLegend: false,
    height: 200,
  },
};

export const Standalone: Story = {
  args: {
    data: demandForecastData,
    lines: [
      { dataKey: 'actual', name: 'Actual', color: '#00aa44' },
      { dataKey: 'forecast', name: 'Forecast', color: '#16A34A' },
    ],
    height: 350,
  },
};

