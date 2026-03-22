/**
 * Area Chart Component
 * Responsive area chart using Recharts with custom theming
 */
'use client';

import * as React from 'react';
import {
  AreaChart as RechartsAreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { CustomTooltip } from './custom-tooltip';

export interface AreaChartDataPoint {
  name: string;
  [key: string]: string | number;
}

export interface AreaChartProps {
  title?: string;
  description?: string;
  data: AreaChartDataPoint[];
  areas: Array<{
    dataKey: string;
    name: string;
    color?: string;
  }>;
  xAxisKey?: string;
  height?: number;
  showGrid?: boolean;
  showLegend?: boolean;
  showTooltip?: boolean;
  stacked?: boolean;
  maxDataDate?: string;
  className?: string;
}

const DEFAULT_COLORS = [
  '#00aa44', // Primary green
  '#16A34A', // Accent green
  '#F59E0B', // Amber
];

export const AreaChartComponent: React.FC<AreaChartProps> = ({
  title,
  description,
  data,
  areas,
  xAxisKey = 'name',
  height = 300,
  showGrid = true,
  showLegend = true,
  showTooltip = true,
  stacked = false,
  maxDataDate,
  className,
}) => {
  const chartContent = (
    <ResponsiveContainer width="100%" height={height}>
      <RechartsAreaChart
        data={data}
        margin={{ top: 10, right: 30, left: 0, bottom: 0 }}
      >
        <defs>
          {areas.map((area, index) => {
            const color = area.color || DEFAULT_COLORS[index % DEFAULT_COLORS.length];
            return (
              <linearGradient
                key={area.dataKey}
                id={`gradient-${area.dataKey}`}
                x1="0"
                y1="0"
                x2="0"
                y2="1"
              >
                <stop offset="5%" stopColor={color} stopOpacity={0.3} />
                <stop offset="95%" stopColor={color} stopOpacity={0.05} />
              </linearGradient>
            );
          })}
        </defs>
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
        {showLegend && <Legend wrapperStyle={{ paddingTop: '1rem' }} />}
        {areas.map((area, index) => (
          <Area
            key={area.dataKey}
            type="monotone"
            dataKey={area.dataKey}
            name={area.name}
            stroke={area.color || DEFAULT_COLORS[index % DEFAULT_COLORS.length]}
            strokeWidth={2}
            fill={`url(#gradient-${area.dataKey})`}
            fillOpacity={1}
            stackId={stacked ? 'stack' : undefined}
          />
        ))}
      </RechartsAreaChart>
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

