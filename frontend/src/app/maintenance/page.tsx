'use client';

import { PowerOff } from 'lucide-react';
import Image from 'next/image';
import Footer from '@/components/layout/Footer';

export default function MaintenancePage() {
  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      <main className="flex flex-1 items-center justify-center px-4">
        <div className="w-full max-w-2xl text-center space-y-8">
          <div className="flex flex-col items-center gap-4 mb-8">
            <Image
              src="/box.svg"
              alt="AI Refill Logo"
              width={80}
              height={80}
              className="w-20 h-20"
            />
            <h1 className="text-5xl font-bold text-gray-900">AI Refill</h1>
          </div>

          <div className="flex justify-center mb-8">
            <div className="relative">
              <div className="absolute inset-0 bg-gray-200 rounded-full blur-2xl"></div>
              <div className="relative bg-white p-8 rounded-full border-2 border-gray-200">
                <PowerOff className="w-24 h-24 text-gray-400" strokeWidth={1.5} />
              </div>
            </div>
          </div>

          <h2 className="text-3xl md:text-4xl font-bold text-gray-900 leading-tight">
            Los motores de Inteligencia Artificial están apagados temporalmente.
          </h2>

          <p className="text-lg md:text-xl text-gray-500 max-w-xl mx-auto leading-relaxed">
            Por favor contacte a la administración para volver a encenderlos.
          </p>
        </div>
      </main>
      <Footer />
    </div>
  );
}
