/**
 * Line Chart Component
 * Responsive line chart using Recharts with custom theming
 */
'use client';

import * as React from 'react';
import {
  LineChart as RechartsLineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { CustomTooltip } from './custom-tooltip';

export interface LineChartDataPoint {
  name: string;
  [key: string]: string | number;
}

export interface LineChartProps {
  title?: string;
  description?: string;
  data: LineChartDataPoint[];
  lines: Array<{
    dataKey: string;
    name: string;
    color?: string;
  }>;
  xAxisKey?: string;
  height?: number;
  showGrid?: boolean;
  showLegend?: boolean;
  showTooltip?: boolean;
  maxDataDate?: string;
  className?: string;
}

// Default colors from our theme
const DEFAULT_COLORS = [
  '#00aa44', // Primary green
  '#16A34A', // Accent green
  '#F59E0B', // Amber
  '#EF4444', // Red
  '#8B5CF6', // Purple
  '#06B6D4', // Cyan
];

export const LineChartComponent: React.FC<LineChartProps> = ({
  title,
  description,
  data,
  lines,
  xAxisKey = 'name',
  height = 300,
  showGrid = true,
  showLegend = true,
  showTooltip = true,
  maxDataDate,
  className,
}) => {
  const chartContent = (
    <ResponsiveContainer width="100%" height={height}>
      <RechartsLineChart
        data={data}
        margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
      >
        {showGrid && (
          <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" opacity={0.5} />
        )}
        <XAxis
          dataKey={xAxisKey}
          stroke="#64748B"
          fontSize={12}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          stroke="#64748B"
          fontSize={12}
          tickLine={false}
          axisLine={false}
          tickFormatter={(value) => `${value?.toLocaleString() ?? ''}`}
        />
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
        {showLegend && (
          <Legend
            wrapperStyle={{ paddingTop: '1rem' }}
            iconType="line"
          />
        )}
        {lines.map((line, index) => (
          <Line
            key={line.dataKey}
            type="monotone"
            dataKey={line.dataKey}
            name={line.name}
            stroke={line.color || DEFAULT_COLORS[index % DEFAULT_COLORS.length]}
            strokeWidth={2}
            dot={{ r: 4 }}
            activeDot={{ r: 6 }}
          />
        ))}
      </RechartsLineChart>
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

