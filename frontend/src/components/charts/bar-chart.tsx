/**
 * Bar Chart Component
 * Responsive bar chart using Recharts with custom theming
 */
'use client';

import * as React from 'react';
import {
  BarChart as RechartsBarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { CustomTooltip } from './custom-tooltip';

export interface BarChartDataPoint {
  name: string;
  [key: string]: string | number;
}

export interface BarChartProps {
  title?: string;
  description?: string;
  data: BarChartDataPoint[];
  bars: Array<{
    dataKey: string;
    name: string;
    color?: string;
  }>;
  xAxisKey?: string;
  height?: number;
  showGrid?: boolean;
  showLegend?: boolean;
  showTooltip?: boolean;
  horizontal?: boolean;
  stacked?: boolean;
  maxDataDate?: string;
  className?: string;
}

const DEFAULT_COLORS = [
  '#00aa44', // Primary green
  '#16A34A', // Accent green
  '#F59E0B', // Amber
  '#EF4444', // Red
  '#8B5CF6', // Purple
];

export const BarChartComponent: React.FC<BarChartProps> = ({
  title,
  description,
  data,
  bars,
  xAxisKey = 'name',
  height = 300,
  showGrid = true,
  showLegend = true,
  showTooltip = true,
  horizontal = false,
  stacked = false,
  maxDataDate,
  className,
}) => {
  const chartContent = (
    <ResponsiveContainer width="100%" height={height}>
      <RechartsBarChart
        data={data}
        layout={horizontal ? 'vertical' : 'horizontal'}
        margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
      >
        {showGrid && (
          <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" opacity={0.5} />
        )}
        {horizontal ? (
          <>
            <XAxis type="number" stroke="#64748B" fontSize={12} />
            <YAxis type="category" dataKey={xAxisKey} stroke="#64748B" fontSize={12} />
          </>
        ) : (
          <>
            <XAxis dataKey={xAxisKey} stroke="#64748B" fontSize={12} />
            <YAxis stroke="#64748B" fontSize={12} />
          </>
        )}
        {showTooltip && (
          <Tooltip
            content={<CustomTooltip maxDataDate={maxDataDate} />}
            contentStyle={{
              backgroundColor: 'transparent',
              border: 'none',
              boxShadow: 'none',
            }}
          />
        )}
        {showLegend && <Legend wrapperStyle={{ paddingTop: '1rem' }} />}
        {bars.map((bar, index) => (
          <Bar
            key={bar.dataKey}
            dataKey={bar.dataKey}
            name={bar.name}
            fill={bar.color || DEFAULT_COLORS[index % DEFAULT_COLORS.length]}
            radius={[4, 4, 0, 0]}
            stackId={stacked ? 'stack' : undefined}
          />
        ))}
      </RechartsBarChart>
    </ResponsiveContainer>
  );

  if (title || description) {
    return (
      <Card className={className}>
        <CardHeader>
          {title && <CardTitle>{title}</CardTitle>}
          {description && <CardDescription>{description}</CardDescription>}
        </CardHeader>
        <CardContent>{chartContent}</CardContent>
      </Card>
    );
  }

  return <div className={className}>{chartContent}</div>;
};

