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
  title: 'AI Refill — Optimización Inteligente de Inventarios',
  description:
    'Sistema de predicción de demanda y optimización de inventarios impulsado por inteligencia artificial.',
  icons: {
    icon: [{ url: '/box.png', type: 'image/png' }],
    apple: [{ url: '/box.png', type: 'image/png' }],
  },
  // metadataBase resolves relative OG image URLs to absolute (required by WhatsApp)
  // Update this when custom domain is configured
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || 'https://air-lite-app.vercel.app'),
  openGraph: {
    title: 'AI Refill — Optimización Inteligente de Inventarios',
    description:
      'Sistema de predicción de demanda y optimización de inventarios impulsado por inteligencia artificial.',
    type: 'website',
    locale: 'es_GT',
    images: [
      {
        url: '/opengraph-image',
        width: 1200,
        height: 630,
        alt: 'AI Refill — Optimización Inteligente de Inventarios',
        type: 'image/png',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'AI Refill — Optimización Inteligente de Inventarios',
    description:
      'Sistema de predicción de demanda y optimización de inventarios impulsado por inteligencia artificial.',
    images: ['/opengraph-image'],
  },
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
