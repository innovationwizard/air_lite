import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

// All pages depend on Supabase Auth (via middleware) — skip static prerendering
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'AI Refill Lite — Optimización Inteligente de Inventarios',
  description:
    'Sistema de predicción de demanda y optimización de inventarios impulsado por inteligencia artificial.',
  metadataBase: new URL('https://www.airefill.app'),
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" className={inter.variable}>
      <body className="font-sans antialiased">
        {children}
      </body>
    </html>
  );
}
