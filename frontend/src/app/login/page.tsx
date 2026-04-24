'use client';

import { useState, useEffect, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { createClient } from '@/lib/supabase/client';
import { getDefaultPage } from '@/lib/auth/roles';

async function resolveLandingPage(supabase: ReturnType<typeof createClient>): Promise<string> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return '/backtest';
  const { data } = await supabase
    .from('user_profiles')
    .select('role')
    .eq('id', user.id)
    .single();
  return getDefaultPage(data?.role ?? '');
}

// Maps `?error=<code>` query params coming back from /auth/callback failures
// into user-facing Spanish messages. Unknown codes fall through to a generic
// line rather than echoing the code raw (avoids leaking internals).
const CALLBACK_ERROR_MESSAGES: Record<string, string> = {
  missing_code: 'El enlace está incompleto. Solicitá uno nuevo.',
  invalid_code: 'El enlace ya se usó o expiró. Solicitá uno nuevo.',
};

// Demo shorthands: typing e.g. "gerencia" resolves to the registered email
// so decision-makers don't have to type out the full address on stage.
const USERNAME_MAP: Record<string, string> = {
  gerencia: 'gerencia@airefill.app',
};

export default function LoginPage() {
  const router = useRouter();
  const supabase = createClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Hydrate callback-failure messages from the URL on mount. Using
  // `window.location` directly (not useSearchParams) keeps this page out of
  // the Suspense-boundary requirement that useSearchParams imposes in Next 14.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const code = new URLSearchParams(window.location.search).get('error');
    if (code && CALLBACK_ERROR_MESSAGES[code]) {
      setError(CALLBACK_ERROR_MESSAGES[code]);
    }
  }, []);

  // Listen for Supabase auth events — specifically the hash-fragment / implicit
  // flow where `detectSessionInUrl: true` in the browser client parses tokens
  // embedded in the URL hash after an email-link verify redirect.
  //
  // The middleware redirects unauthenticated traffic on `/` to `/login`, and
  // browsers preserve the URL hash across those 307 redirects, so the tokens
  // typically land on this page. When the hash represents a recovery link,
  // Supabase fires a `PASSWORD_RECOVERY` event here; we route the user to
  // `/update-password` to complete the flow. A regular `SIGNED_IN` event
  // (e.g. implicit magic link) routes to the default landing.
  //
  // The PKCE flow (code-in-query-string) is handled server-side by
  // `/auth/callback`, not here — so this listener is strictly the fallback
  // for projects or email types still using the legacy implicit flow.
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event) => {
      if (event === 'PASSWORD_RECOVERY') {
        router.replace('/update-password');
      } else if (event === 'SIGNED_IN') {
        const landing = await resolveLandingPage(supabase);
        router.replace(landing);
      }
    });
    return () => subscription.unsubscribe();
  }, [supabase, router]);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const resolvedEmail = email.includes('@')
      ? email
      : (USERNAME_MAP[email.trim().toLowerCase()] ?? email);

    const { error: authError } = await supabase.auth.signInWithPassword({
      email: resolvedEmail,
      password,
    });

    if (authError) {
      setError('Credenciales incorrectas. Verifique su correo y contraseña.');
      setLoading(false);
      return;
    }

    const landing = await resolveLandingPage(supabase);
    router.push(landing);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm space-y-8">
        <div className="text-center">
          <Image
            src="/box.svg"
            alt="AI Refill"
            width={64}
            height={64}
            className="mx-auto mb-4"
          />
          <h1 className="text-2xl font-bold text-gray-900">AI Refill</h1>
          <p className="text-gray-500 mt-1 text-sm">
            Optimización inteligente de inventarios
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-600">
              {error}
            </div>
          )}

          <div>
            <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
              Correo electrónico
            </label>
            <input
              id="email"
              type="text"
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

          <div>
            <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1">
              Contraseña
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              disabled={loading}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent disabled:opacity-50"
              placeholder="••••••••"
              autoComplete="current-password"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 bg-emerald-600 text-white font-semibold rounded-lg hover:bg-emerald-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Iniciando sesión...' : 'Iniciar sesión'}
          </button>

          <Link
            href="/forgot-password"
            className="block text-center text-sm text-gray-500 hover:text-emerald-700"
          >
            ¿Olvidaste tu contraseña?
          </Link>
        </form>

        <div className="text-center text-sm text-gray-400">
          <p>— Artificial Intelligence Developments —</p>
          <p>— 2026 —</p>
        </div>
      </div>
    </div>
  );
}
