import Link from 'next/link';
import Footer from '@/components/layout/Footer';

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      <main className="flex flex-1 items-center justify-center px-4">
        <div className="w-full max-w-md text-center space-y-6">
          <p className="text-8xl font-bold text-gray-200">404</p>
          <h1 className="text-2xl font-bold text-gray-900">Página no encontrada</h1>
          <p className="text-gray-500">
            La página que buscas no existe o fue movida.
          </p>
          <Link
            href="/dashboard"
            className="inline-flex items-center justify-center rounded-md bg-emerald-600 px-6 py-2 text-sm font-medium text-white hover:bg-emerald-700 transition-colors"
          >
            Volver al inicio
          </Link>
        </div>
      </main>
      <Footer />
    </div>
  );
}
