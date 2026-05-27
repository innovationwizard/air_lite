'use client';

import { useState, FormEvent, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import Footer from '@/components/layout/Footer';
import { createClient } from '@/lib/supabase/client';
import { getDefaultPage } from '@/lib/auth/roles';

/**
 * Minimum password length. Supabase's server-side default is 6; we enforce 8
 * in the UI because it's the most common industry floor and short enough not
 * to drive users to reuse. Server-side remains the enforcing authority — this
 * is defense in depth, not the only check.
 */
const MIN_PASSWORD_LENGTH = 8;

export default function UpdatePasswordPage() {
  const router = useRouter();
  const supabase = createClient();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);

  // Verify on mount that the user arrived here with a valid session. If they
  // navigated here directly (no reset flow), punt them to /login. This is
  // belt-and-suspenders — the middleware already requires auth for this path.
  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) {
        router.replace('/login');
        return;
      }
      setSessionReady(true);
    });
  }, [supabase, router]);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);

    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`);
      return;
    }
    if (password !== confirm) {
      setError('Las contraseñas no coinciden.');
      return;
    }

    setLoading(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });

    if (updateError) {
      setError('No se pudo actualizar la contraseña. Intentá de nuevo o solicitá un nuevo enlace.');
      setLoading(false);
      return;
    }

    // Redirect to the user's role-appropriate landing page. Default to
    // /backtest if the profile lookup fails for any reason.
    const { data: { user } } = await supabase.auth.getUser();
    let destination = '/backtest';
    if (user) {
      const { data: profile } = await supabase
        .from('user_profiles')
        .select('role')
        .eq('id', user.id)
        .single();
      if (profile?.role) {
        destination = getDefaultPage(profile.role);
      }
    }

    router.push(destination);
  };

  if (!sessionReady) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <p className="text-sm text-gray-500">Verificando sesión…</p>
      </div>
    );
  }

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
            <h1 className="text-2xl font-bold text-gray-900">Nueva contraseña</h1>
            <p className="text-gray-500 mt-1 text-sm">
              Elegí una contraseña para tu cuenta.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-600">
                {error}
              </div>
            )}

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1">
                Nueva contraseña
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={MIN_PASSWORD_LENGTH}
                disabled={loading}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent disabled:opacity-50"
                placeholder="••••••••"
                autoComplete="new-password"
                autoFocus
              />
              <p className="text-xs text-gray-500 mt-1">
                Mínimo {MIN_PASSWORD_LENGTH} caracteres.
              </p>
            </div>

            <div>
              <label htmlFor="confirm" className="block text-sm font-medium text-gray-700 mb-1">
                Confirmá la contraseña
              </label>
              <input
                id="confirm"
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
                minLength={MIN_PASSWORD_LENGTH}
                disabled={loading}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent disabled:opacity-50"
                placeholder="••••••••"
                autoComplete="new-password"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 bg-emerald-600 text-white font-semibold rounded-lg hover:bg-emerald-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Actualizando...' : 'Guardar nueva contraseña'}
            </button>
          </form>
        </div>
      </main>
      <Footer />
    </div>
  );
}
