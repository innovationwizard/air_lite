'use client';

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { TrendingUp, TrendingDown, Minus, Award, DollarSign } from 'lucide-react';

interface SupplierScorecardModalProps {
  isOpen: boolean;
  onClose: () => void;
  data: {
    monthlyTrends: Array<{
      supplier_id: number;
      supplier_name: string;
      month: string;
      otif_rate: number;
      avg_lead_time: number;
      lead_time_variance: number;
      defect_rate_ppm: number;
      avg_cost_per_unit: number;
      total_spend: number;
      order_count: number;
      avg_quality_score: number;
    }>;
    rankings: Array<{
      supplier_id: number;
      supplier_name: string;
      total_spend: number;
      total_orders: number;
      overall_otif: number;
      overall_quality: number;
      cost_trend_pct: number;
    }>;
    dateRange: {
      start: string;
      end: string;
    };
  } | null;
}

export function SupplierScorecardModal({ isOpen, onClose, data }: SupplierScorecardModalProps) {
  if (!data) return null;

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('es-GT', {
      style: 'currency',
      currency: 'GTQ',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(amount);
  };

  const formatPercentage = (value: number) => {
    return `${(value ?? 0).toFixed(1)}%`;
  };

  const formatMonth = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('es-GT', { year: 'numeric', month: 'short' });
  };

  const getTrendIcon = (value: number) => {
    if (value > 2) return <TrendingUp className="h-4 w-4 text-green-600" />;
    if (value < -2) return <TrendingDown className="h-4 w-4 text-red-600" />;
    return <Minus className="h-4 w-4 text-gray-400" />;
  };

  const getPerformanceBadge = (otif: number) => {
    if (otif >= 95) return <Badge className="bg-green-100 text-green-800">Excelente</Badge>;
    if (otif >= 85) return <Badge className="bg-yellow-100 text-yellow-800">Bueno</Badge>;
    return <Badge className="bg-red-100 text-red-800">Necesita Mejora</Badge>;
  };

  // Group trends by supplier for top 5
  const supplierGroups = data.rankings.slice(0, 5).map(ranking => {
    const trends = data.monthlyTrends
      .filter(t => t.supplier_id === ranking.supplier_id)
      .sort((a, b) => new Date(b.month).getTime() - new Date(a.month).getTime())
      .slice(0, 6);
    return { ...ranking, trends };
  });

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Award className="h-6 w-6 text-blue-600" />
            Tablero de Proveedores
          </DialogTitle>
          <DialogDescription>
            Análisis de desempeño mensual - Top 5 proveedores por gasto total
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Rankings Overview */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Ranking de Proveedores</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left p-2">Rank</th>
                      <th className="text-left p-2">Proveedor</th>
                      <th className="text-right p-2">Gasto Total</th>
                      <th className="text-right p-2">Órdenes</th>
                      <th className="text-center p-2">OTIF</th>
                      <th className="text-center p-2">Calidad</th>
                      <th className="text-center p-2">Tendencia Costo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.rankings.slice(0, 10).map((supplier, index) => (
                      <tr key={supplier.supplier_id} className="border-b hover:bg-gray-50">
                        <td className="p-2 font-bold text-gray-500">#{index + 1}</td>
                        <td className="p-2 font-medium">{supplier.supplier_name}</td>
                        <td className="p-2 text-right font-semibold">
                          {formatCurrency(supplier.total_spend)}
                        </td>
                        <td className="p-2 text-right">{supplier.total_orders}</td>
                        <td className="p-2 text-center">
                          {getPerformanceBadge(supplier.overall_otif)}
                        </td>
                        <td className="p-2 text-center">
                          <span className={supplier.overall_quality >= 90 ? 'text-green-600 font-semibold' : 'text-gray-600'}>
                            {formatPercentage(supplier.overall_quality)}
                          </span>
                        </td>
                        <td className="p-2 text-center">
                          <div className="flex items-center justify-center gap-1">
                            {getTrendIcon(supplier.cost_trend_pct)}
                            <span className={
                              supplier.cost_trend_pct > 0 ? 'text-red-600' : 
                              supplier.cost_trend_pct < 0 ? 'text-green-600' : 
                              'text-gray-600'
                            }>
                              {Math.abs(supplier.cost_trend_pct ?? 0).toFixed(1)}%
                            </span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {/* Monthly Trends for Top 5 Suppliers */}
          {supplierGroups.map((supplierGroup, idx) => (
            <Card key={supplierGroup.supplier_id} className="border-l-4 border-l-blue-500">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">
                    #{idx + 1} {supplierGroup.supplier_name}
                  </CardTitle>
                  <div className="flex items-center gap-4 text-sm text-gray-600">
                    <span>
                      <DollarSign className="h-4 w-4 inline mr-1" />
                      {formatCurrency(supplierGroup.total_spend)}
                    </span>
                    <span className="text-xs">
                      {supplierGroup.total_orders} órdenes
                    </span>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b text-gray-600">
                        <th className="text-left p-2">Mes</th>
                        <th className="text-center p-2">OTIF %</th>
                        <th className="text-center p-2">Lead Time</th>
                        <th className="text-center p-2">Varianza</th>
                        <th className="text-center p-2">Defectos PPM</th>
                        <th className="text-right p-2">Costo/Unidad</th>
                        <th className="text-right p-2">Gasto</th>
                        <th className="text-center p-2">Calidad</th>
                      </tr>
                    </thead>
                    <tbody>
                      {supplierGroup.trends.map((trend, trendIdx) => (
                        <tr key={trendIdx} className="border-b hover:bg-blue-50">
                          <td className="p-2 font-medium">{formatMonth(trend.month)}</td>
                          <td className="p-2 text-center">
                            <span className={
                              trend.otif_rate >= 95 ? 'text-green-600 font-semibold' :
                              trend.otif_rate >= 85 ? 'text-yellow-600' :
                              'text-red-600 font-semibold'
                            }>
                              {formatPercentage(trend.otif_rate)}
                            </span>
                          </td>
                          <td className="p-2 text-center">{(trend.avg_lead_time ?? 0).toFixed(1)} días</td>
                          <td className="p-2 text-center">
                            ±{(trend.lead_time_variance ?? 0).toFixed(1)} días
                          </td>
                          <td className="p-2 text-center">
                            <span className={(trend.defect_rate_ppm ?? 0) > 50 ? 'text-red-600' : 'text-gray-600'}>
                              {(trend.defect_rate_ppm ?? 0).toFixed(1)}
                            </span>
                          </td>
                          <td className="p-2 text-right">
                            {formatCurrency(trend.avg_cost_per_unit)}
                          </td>
                          <td className="p-2 text-right font-semibold">
                            {formatCurrency(trend.total_spend)}
                          </td>
                          <td className="p-2 text-center">
                            <span className={trend.avg_quality_score >= 90 ? 'text-green-600' : 'text-gray-600'}>
                              {formatPercentage(trend.avg_quality_score)}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}