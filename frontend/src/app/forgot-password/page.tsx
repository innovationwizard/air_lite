'use client';

import { useState, FormEvent } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import Footer from '@/components/layout/Footer';
import { createClient } from '@/lib/supabase/client';

export default function ForgotPasswordPage() {
  const supabase = createClient();
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);

    // Intentionally swallow the supabase response — never surface to the UI
    // whether the email exists or not (prevents account enumeration).
    await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/callback?next=/update-password`,
    });

    setSubmitted(true);
    setLoading(false);
  };

  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      <main className="flex flex-1 items-center justify-center px-4">
        <div className="w-full max-w-sm space-y-8">
          <div className="text-center">
            <Image
              src="/box.svg"
              alt="AI Refill"
              width={64}
              height={64}
              className="mx-auto mb-4"
            />
            <h1 className="text-2xl font-bold text-gray-900">Recuperar contraseña</h1>
            <p className="text-gray-500 mt-1 text-sm">
              Te enviamos un enlace a tu correo para elegir una nueva.
            </p>
          </div>

          {submitted ? (
            <div className="space-y-4">
              <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-4 text-sm text-emerald-800">
                <p className="font-medium mb-1">Si existe una cuenta con ese correo, ya te enviamos el enlace.</p>
                <p>Revisá tu bandeja de entrada (y la carpeta de spam). El enlace es de un solo uso y expira pronto.</p>
              </div>
              <Link
                href="/login"
                className="block w-full py-2.5 text-center bg-white border border-gray-300 text-gray-700 font-semibold rounded-lg hover:bg-gray-50 transition-colors"
              >
                Volver a iniciar sesión
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
                  Correo electrónico
                </label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  disabled={loading}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent disabled:opacity-50"
                  placeholder="correo@empresa.com"
                  autoComplete="email"
                  autoFocus
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 bg-emerald-600 text-white font-semibold rounded-lg hover:bg-emerald-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? 'Enviando...' : 'Enviar enlace'}
              </button>

              <Link
                href="/login"
                className="block text-center text-sm text-gray-500 hover:text-gray-700"
              >
                Volver a iniciar sesión
              </Link>
            </form>
          )}
        </div>
      </main>
      <Footer />
    </div>
  );
}
