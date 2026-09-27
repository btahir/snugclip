import type { Metadata, Viewport } from 'next';
import { preload } from 'react-dom';
import { SITE_DESCRIPTION, SITE_NAME, SITE_URL } from '@/config/site';
import { t } from '@/i18n/en';
import { THEME_INIT_SCRIPT } from '@/lib/theme';
import { SwRegister } from '@/components/site/SwRegister';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: t.meta.homeTitle, template: '%s' },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  authors: [{ name: 'Snugclip contributors' }],
  openGraph: {
    type: 'website',
    siteName: SITE_NAME,
    title: t.meta.homeTitle,
    description: SITE_DESCRIPTION,
    url: '/',
    images: [{ url: '/og/default.png', width: 1200, height: 630, alt: 'Snugclip' }],
  },
  twitter: { card: 'summary_large_image', title: t.meta.homeTitle, description: SITE_DESCRIPTION, images: ['/og/default.png'] },
  icons: {
    icon: [
      { url: '/favicon.svg', type: 'image/svg+xml' },
      { url: '/icons/favicon-32.png', sizes: '32x32', type: 'image/png' },
    ],
    shortcut: '/favicon.ico',
    apple: [{ url: '/icons/apple-touch-icon.png', sizes: '180x180' }],
  },
  manifest: '/manifest.webmanifest',
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#F5F1E9' },
    { media: '(prefers-color-scheme: dark)', color: '#0B1518' },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  preload('/fonts/outfit-latin-wght-normal.woff2', { as: 'font', type: 'font/woff2', crossOrigin: 'anonymous' });
  preload('/fonts/atkinson-hyperlegible-next-latin-wght-normal.woff2', { as: 'font', type: 'font/woff2', crossOrigin: 'anonymous' });
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        {children}
        <SwRegister />
      </body>
    </html>
  );
}
