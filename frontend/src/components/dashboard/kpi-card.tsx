/**
 * KPI Card Component
 * Displays key performance indicators with trend indicators and animations
 */
import * as React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn, formatNumber, formatCurrency } from '@/lib/utils';
import { ArrowUp, ArrowDown, Minus, TrendingUp, TrendingDown } from 'lucide-react';

export type KPIVariant = 'default' | 'success' | 'warning' | 'critical' | 'info';
export type TrendDirection = 'up' | 'down' | 'neutral';

export interface KPICardProps {
  title: string;
  value: number | string;
  format?: 'number' | 'currency' | 'percentage' | 'text';
  currency?: string;
  change?: number;
  changeLabel?: string;
  trend?: TrendDirection;
  variant?: KPIVariant;
  icon?: React.ReactNode;
  subtitle?: string;
  className?: string;
  footer?: React.ReactNode;
}

const variantStyles: Record<KPIVariant, string> = {
  default: 'border-border',
  success: 'border-accent/30 bg-accent/5',
  warning: 'border-amber-200 bg-amber-50',
  critical: 'border-destructive/30 bg-destructive/5',
  info: 'border-primary/30 bg-primary/5',
};

const TrendIcon: React.FC<{ direction: TrendDirection; className?: string }> = ({ 
  direction, 
  className 
}) => {
  const iconClass = cn('h-4 w-4', className);
  
  switch (direction) {
    case 'up':
      return <TrendingUp className={cn(iconClass, 'text-accent')} />;
    case 'down':
      return <TrendingDown className={cn(iconClass, 'text-destructive')} />;
    case 'neutral':
      return <Minus className={cn(iconClass, 'text-muted-foreground')} />;
  }
};

const ChangeIndicator: React.FC<{ change: number; label?: string }> = ({ 
  change, 
  label 
}) => {
  const isPositive = change > 0;
  const isNeutral = change === 0;
  
  const Icon = isNeutral ? Minus : isPositive ? ArrowUp : ArrowDown;
  const colorClass = isNeutral 
    ? 'text-muted-foreground' 
    : isPositive 
    ? 'text-accent' 
    : 'text-destructive';
  
  return (
    <div className={cn('flex items-center gap-1 text-sm', colorClass)}>
      <Icon className="h-3 w-3" />
      <span className="font-medium">
        {Math.abs(change)}%
      </span>
      {label && <span className="text-muted-foreground">{label}</span>}
    </div>
  );
};

export const KPICard = React.forwardRef<HTMLDivElement, KPICardProps>(
  (
    {
      title,
      value,
      format = 'number',
      currency = 'USD',
      change,
      changeLabel = 'vs last period',
      trend,
      variant = 'default',
      icon,
      subtitle,
      className,
      footer,
    },
    ref
  ) => {
    // Format value based on type
    const formattedValue = React.useMemo(() => {
      if (format === 'text') return value;
      
      const numValue = typeof value === 'number' ? value : parseFloat(value as string);
      
      switch (format) {
        case 'currency':
          return formatCurrency(numValue, currency);
        case 'percentage':
          return `${(isNaN(numValue) ? 0 : numValue).toFixed(1)}%`;
        case 'number':
        default:
          return formatNumber(numValue);
      }
    }, [value, format, currency]);

    return (
      <Card
        ref={ref}
        className={cn(
          'kpi-card-hover',
          variantStyles[variant],
          className
        )}
      >
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            {title}
          </CardTitle>
          {icon && (
            <div className="text-muted-foreground">
              {icon}
            </div>
          )}
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {/* Main Value */}
            <div className="text-3xl font-bold font-heading">
              {formattedValue}
            </div>

            {/* Subtitle */}
            {subtitle && (
              <p className="text-xs text-muted-foreground">
                {subtitle}
              </p>
            )}

            {/* Change Indicator and Trend */}
            <div className="flex items-center justify-between">
              {change !== undefined && (
                <ChangeIndicator change={change} label={changeLabel} />
              )}
              
              {trend && (
                <TrendIcon direction={trend} />
              )}
            </div>

            {/* Footer */}
            {footer && (
              <div className="pt-2 border-t">
                {footer}
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    );
  }
);

KPICard.displayName = 'KPICard';

