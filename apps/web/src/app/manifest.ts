import type { MetadataRoute } from 'next';
import { SITE_DESCRIPTION } from '@/config/site';

export const dynamic = 'force-static';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Snugclip',
    short_name: 'Snugclip',
    description: SITE_DESCRIPTION,
    id: '/',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#F5F1E9',
    theme_color: '#0B1518',
    categories: ['utilities', 'productivity', 'photo'],
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      { src: '/brand/icon-pwa.svg', sizes: 'any', type: 'image/svg+xml' },
    ],
  };
}
