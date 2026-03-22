'use client';

import React, { useState } from 'react';
import { X, Download, FileText, FileSpreadsheet, FileArchive } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  role: string;
  dateRange: { start: Date; end: Date };
  compareMode?: {
    periodA: { start: Date; end: Date };
    periodB: { start: Date; end: Date };
  };
  availableSections: { id: string; label: string }[];
}

export function ExportModal({
  isOpen,
  onClose,
  role,
  dateRange,
  compareMode,
  availableSections
}: ExportModalProps) {
  const [format, setFormat] = useState<'pdf' | 'excel' | 'csv'>('pdf');
  const [selectedSections, setSelectedSections] = useState<string[]>(
    availableSections.map(s => s.id)
  );
  const [isExporting, setIsExporting] = useState(false);

  if (!isOpen) return null;

  const handleSelectAll = () => {
    setSelectedSections(availableSections.map(s => s.id));
  };

  const handleDeselectAll = () => {
    setSelectedSections([]);
  };

  const handleToggleSection = (sectionId: string) => {
    setSelectedSections(prev =>
      prev.includes(sectionId)
        ? prev.filter(id => id !== sectionId)
        : [...prev, sectionId]
    );
  };

  const handleExport = async () => {
    if (selectedSections.length === 0) {
      alert('Por favor seleccione al menos una sección para exportar');
      return;
    }

    setIsExporting(true);

    try {
      const requestBody = {
        format,
        sections: selectedSections,
        dateRange: {
          start: dateRange.start.toISOString().split('T')[0],
          end: dateRange.end.toISOString().split('T')[0]
        },
        compareMode: compareMode ? {
          periodA: {
            start: compareMode.periodA.start.toISOString().split('T')[0],
            end: compareMode.periodA.end.toISOString().split('T')[0]
          },
          periodB: {
            start: compareMode.periodB.start.toISOString().split('T')[0],
            end: compareMode.periodB.end.toISOString().split('T')[0]
          }
        } : undefined,
        role
      };

      const response = await fetch('/api/export', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        throw new Error(`Export failed: ${response.status}`);
      }

      const blob = await response.blob();
      const contentDisposition = response.headers.get('Content-Disposition');
      const filename = contentDisposition?.match(/filename="(.+)"/)?.[1] || `${role}_export_${new Date().toISOString().split('T')[0]}.${format}`;

      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      alert('Reporte generado exitosamente');
      onClose();

    } catch (error) {
      console.error('Export error:', error);
      alert('Error al generar el reporte. Por favor intente nuevamente.');
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">Generar Reporte</h2>
            <p className="text-sm text-gray-500 mt-1">
              Seleccione el formato y las secciones a exportar
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X className="h-6 w-6" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* Format Selection */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-3">
              Formato de Exportación
            </label>
            <div className="grid grid-cols-3 gap-3">
              <button
                onClick={() => setFormat('pdf')}
                className={`flex flex-col items-center justify-center p-4 border-2 rounded-lg transition-all ${
                  format === 'pdf'
                    ? 'border-blue-500 bg-blue-50'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <FileText className={`h-8 w-8 mb-2 ${format === 'pdf' ? 'text-blue-500' : 'text-gray-400'}`} />
                <span className={`font-medium ${format === 'pdf' ? 'text-blue-700' : 'text-gray-600'}`}>
                  PDF
                </span>
              </button>

              <button
                onClick={() => setFormat('excel')}
                className={`flex flex-col items-center justify-center p-4 border-2 rounded-lg transition-all ${
                  format === 'excel'
                    ? 'border-green-500 bg-green-50'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <FileSpreadsheet className={`h-8 w-8 mb-2 ${format === 'excel' ? 'text-green-500' : 'text-gray-400'}`} />
                <span className={`font-medium ${format === 'excel' ? 'text-green-700' : 'text-gray-600'}`}>
                  Excel
                </span>
              </button>

              <button
                onClick={() => setFormat('csv')}
                className={`flex flex-col items-center justify-center p-4 border-2 rounded-lg transition-all ${
                  format === 'csv'
                    ? 'border-purple-500 bg-purple-50'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <FileArchive className={`h-8 w-8 mb-2 ${format === 'csv' ? 'text-purple-500' : 'text-gray-400'}`} />
                <span className={`font-medium ${format === 'csv' ? 'text-purple-700' : 'text-gray-600'}`}>
                  CSV (ZIP)
                </span>
              </button>
            </div>
          </div>

          {/* Section Selection */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <label className="block text-sm font-medium text-gray-700">
                Secciones a Incluir
              </label>
              <div className="space-x-2">
                <button
                  onClick={handleSelectAll}
                  className="text-xs text-blue-600 hover:text-blue-700 font-medium"
                >
                  Seleccionar Todo
                </button>
                <span className="text-gray-300">|</span>
                <button
                  onClick={handleDeselectAll}
                  className="text-xs text-gray-600 hover:text-gray-700 font-medium"
                >
                  Deseleccionar Todo
                </button>
              </div>
            </div>

            <div className="space-y-2 border rounded-lg p-4 max-h-64 overflow-y-auto">
              {availableSections.map(section => (
                <label
                  key={section.id}
                  className="flex items-center space-x-3 p-2 hover:bg-gray-50 rounded cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={selectedSections.includes(section.id)}
                    onChange={() => handleToggleSection(section.id)}
                    className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                  />
                  <span className="text-sm text-gray-700">{section.label}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Period Info */}
          <div className="bg-gray-50 rounded-lg p-4">
            <h4 className="text-sm font-medium text-gray-700 mb-2">Período de Datos</h4>
            {compareMode ? (
              <div className="text-sm text-gray-600 space-y-1">
                <p>
                  <strong>Período A:</strong> {dateRange.start.toLocaleDateString('es-GT')} a{' '}
                  {dateRange.end.toLocaleDateString('es-GT')}
                </p>
                <p>
                  <strong>Período B:</strong> {compareMode.periodB.start.toLocaleDateString('es-GT')} a{' '}
                  {compareMode.periodB.end.toLocaleDateString('es-GT')}
                </p>
              </div>
            ) : (
              <p className="text-sm text-gray-600">
                {dateRange.start.toLocaleDateString('es-GT')} a {dateRange.end.toLocaleDateString('es-GT')}
              </p>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 p-6 border-t bg-gray-50">
          <Button
            variant="outline"
            onClick={onClose}
            disabled={isExporting}
          >
            Cancelar
          </Button>
          <Button
            onClick={handleExport}
            disabled={isExporting || selectedSections.length === 0}
            className="bg-blue-600 hover:bg-blue-700"
          >
            {isExporting ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
                Generando...
              </>
            ) : (
              <>
                <Download className="h-4 w-4 mr-2" />
                Generar Reporte
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}