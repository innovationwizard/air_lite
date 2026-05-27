'use client';

import { useEffect } from 'react';
import Footer from '@/components/layout/Footer';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      <main className="flex flex-1 items-center justify-center px-4">
        <div className="w-full max-w-md text-center space-y-6">
          <p className="text-8xl font-bold text-red-200">500</p>
          <h1 className="text-2xl font-bold text-gray-900">Algo salió mal</h1>
          <p className="text-gray-500">
            Ocurrió un error inesperado. Por favor intenta de nuevo.
          </p>
          <button
            onClick={reset}
            className="inline-flex items-center justify-center rounded-md bg-emerald-600 px-6 py-2 text-sm font-medium text-white hover:bg-emerald-700 transition-colors"
          >
            Intentar de nuevo
          </button>
        </div>
      </main>
      <Footer />
    </div>
  );
}
