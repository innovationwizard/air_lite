'use client';

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertTriangle, Calendar, Activity } from 'lucide-react';

interface AtRiskShipmentsModalProps {
  isOpen: boolean;
  onClose: () => void;
  data: {
    atRiskShipments: Array<{
      purchase_id: number;
      purchase_date: string;
      expected_delivery: string;
      predicted_delivery: string;
      supplier_id: number;
      supplier_name: string;
      product_id: number;
      product_name: string;
      sku: string;
      quantity: number;
      order_value: number;
      risk_score: number;
      predicted_delay_days: number;
      days_until_due: number;
      current_stock: number;
      risk_level: 'high' | 'medium' | 'low';
      recommended_action: string;
    }>;
    summary: {
      total_at_risk: number;
      high_risk_count: number;
      medium_risk_count: number;
      total_value_at_risk: number;
    };
    aiAccuracy: {
      total_predictions_last_30d: number;
      correct_predictions: number;
      accuracy_rate: string;
      avg_prediction_error_days: string;
    };
    dateRange: {
      start: string;
      end: string;
    };
  } | null;
}

export function AtRiskShipmentsModal({ isOpen, onClose, data }: AtRiskShipmentsModalProps) {
  if (!data) return null;

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('es-GT', {
      style: 'currency',
      currency: 'GTQ',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(amount);
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('es-GT');
  };

  const getRiskBadge = (level: string, score: number) => {
    if (level === 'high') {
      return <Badge className="bg-red-100 text-red-800">Alto Riesgo ({score}%)</Badge>;
    }
    if (level === 'medium') {
      return <Badge className="bg-yellow-100 text-yellow-800">Riesgo Medio ({score}%)</Badge>;
    }
    return <Badge className="bg-green-100 text-green-800">Bajo Riesgo ({score}%)</Badge>;
  };

  const getStockBadge = (stock: number, quantity: number) => {
    if (stock < quantity * 0.5) {
      return <Badge variant="destructive">Stock Crítico</Badge>;
    }
    if (stock < quantity) {
      return <Badge className="bg-yellow-100 text-yellow-800">Stock Bajo</Badge>;
    }
    return <Badge className="bg-green-100 text-green-800">Stock OK</Badge>;
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-6 w-6 text-orange-600" />
            Envíos en Riesgo - Predicciones AI
          </DialogTitle>
          <DialogDescription>
            Órdenes de compra con alta probabilidad de retraso basadas en análisis histórico
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* AI Model Performance Banner */}
          <Alert className="border-blue-200 bg-blue-50">
            <Activity className="h-4 w-4 text-blue-600" />
            <AlertTitle className="text-blue-900">Precisión del Modelo AI</AlertTitle>
            <AlertDescription className="text-blue-800">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-2">
                <div>
                  <span className="text-xs text-blue-600">Predicciones (30 días)</span>
                  <p className="text-lg font-bold">{data.aiAccuracy.total_predictions_last_30d}</p>
                </div>
                <div>
                  <span className="text-xs text-blue-600">Tasa de Acierto</span>
                  <p className="text-lg font-bold">{data.aiAccuracy.accuracy_rate}</p>
                </div>
                <div>
                  <span className="text-xs text-blue-600">Error Promedio</span>
                  <p className="text-lg font-bold">{data.aiAccuracy.avg_prediction_error_days} días</p>
                </div>
                <div>
                  <span className="text-xs text-blue-600">Predicciones Correctas</span>
                  <p className="text-lg font-bold">{data.aiAccuracy.correct_predictions}</p>
                </div>
              </div>
            </AlertDescription>
          </Alert>

          {/* Summary Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-gray-600">Total en Riesgo</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">{data.summary.total_at_risk}</p>
                <p className="text-xs text-gray-500">órdenes pendientes</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-gray-600">Alto Riesgo</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold text-red-600">{data.summary.high_risk_count}</p>
                <p className="text-xs text-gray-500">requieren acción inmediata</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-gray-600">Riesgo Medio</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold text-yellow-600">{data.summary.medium_risk_count}</p>
                <p className="text-xs text-gray-500">monitoreo activo</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-gray-600">Valor en Riesgo</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">{formatCurrency(data.summary.total_value_at_risk)}</p>
                <p className="text-xs text-gray-500">inversión afectada</p>
              </CardContent>
            </Card>
          </div>

          {/* At-Risk Shipments Table */}
          <Card>
            <CardHeader>
              <CardTitle>Órdenes con Riesgo de Retraso</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left p-2">Nivel Riesgo</th>
                      <th className="text-left p-2">Proveedor</th>
                      <th className="text-left p-2">Producto</th>
                      <th className="text-center p-2">Stock Actual</th>
                      <th className="text-center p-2">Fecha Esperada</th>
                      <th className="text-center p-2">Fecha Predicha</th>
                      <th className="text-center p-2">Retraso</th>
                      <th className="text-right p-2">Valor Orden</th>
                      <th className="text-left p-2">Acción Recomendada</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.atRiskShipments.map((shipment) => (
                      <tr 
                        key={shipment.purchase_id} 
                        className={`border-b hover:bg-gray-50 ${
                          shipment.risk_level === 'high' ? 'bg-red-50' :
                          shipment.risk_level === 'medium' ? 'bg-yellow-50' : ''
                        }`}
                      >
                        <td className="p-2">
                          {getRiskBadge(shipment.risk_level, shipment.risk_score)}
                        </td>
                        <td className="p-2 font-medium">{shipment.supplier_name}</td>
                        <td className="p-2">
                          <div>
                            <p className="font-medium">{shipment.product_name}</p>
                            <p className="text-xs text-gray-500">{shipment.sku}</p>
                            <p className="text-xs text-gray-500">{shipment.quantity} unidades</p>
                          </div>
                        </td>
                        <td className="p-2 text-center">
                          <div>
                            <p className="font-semibold">{shipment.current_stock}</p>
                            {getStockBadge(shipment.current_stock, shipment.quantity)}
                          </div>
                        </td>
                        <td className="p-2 text-center">
                          <div>
                            <Calendar className="h-4 w-4 inline mr-1 text-gray-400" />
                            <p className="text-xs">{formatDate(shipment.expected_delivery)}</p>
                            <p className="text-xs text-gray-500">
                              ({shipment.days_until_due > 0 ? `${shipment.days_until_due} días` : 'Vencido'})
                            </p>
                          </div>
                        </td>
                        <td className="p-2 text-center">
                          <p className="text-xs font-medium text-orange-600">
                            {formatDate(shipment.predicted_delivery)}
                          </p>
                        </td>
                        <td className="p-2 text-center">
                          <Badge variant="destructive">
                            +{shipment.predicted_delay_days} días
                          </Badge>
                        </td>
                        <td className="p-2 text-right font-semibold">
                          {formatCurrency(shipment.order_value)}
                        </td>
                        <td className="p-2">
                          <p className="text-xs">{shipment.recommended_action}</p>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </div>
      </DialogContent>
    </Dialog>
  );
}