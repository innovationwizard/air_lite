/**
 * Custom Tooltip Component for Charts
 * Handles zero data gracefully with data availability information
 */
'use client';

import * as React from 'react';

export interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{
    dataKey: string;
    name: string;
    value: number;
    color: string;
  }>;
  label?: string;
  maxDataDate?: string;
  showDataAvailability?: boolean;
}

export const CustomTooltip: React.FC<CustomTooltipProps> = ({
  active,
  payload,
  label,
  maxDataDate,
  showDataAvailability = true,
}) => {
  if (!active || !payload || payload.length === 0) {
    return null;
  }

  const hasZeroValues = payload.some(item => item.value === 0);
  const allZeroValues = payload.every(item => item.value === 0);

  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-3 max-w-xs">
      <p className="font-semibold text-gray-900 mb-2">{label}</p>
      
      {payload.map((entry, index) => (
        <div key={index} className="flex items-center gap-2 mb-1">
          <div 
            className="w-3 h-3 rounded-full" 
            style={{ backgroundColor: entry.color }}
          />
          <span className="text-sm text-gray-600">{entry.name}:</span>
          <span className={`text-sm font-medium ${
            entry.value === 0 ? 'text-gray-400' : 'text-gray-900'
          }`}>
            {entry.value === 0 ? '0' : entry.value.toLocaleString()}
          </span>
        </div>
      ))}
      
      {showDataAvailability && (hasZeroValues || allZeroValues) && maxDataDate && (
        <div className="mt-2 pt-2 border-t border-gray-100">
          <p className="text-xs text-gray-500">
            📅 Datos disponibles hasta {new Date(maxDataDate).toLocaleDateString('es-ES')}
          </p>
        </div>
      )}
    </div>
  );
};
