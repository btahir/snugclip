import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/config/site';
import { KEYWORD_PAGES } from '@/content/pages';

export const dynamic = 'force-static';

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = '2026-09-27';
  return [
    { url: `${SITE_URL}/`, lastModified, changeFrequency: 'monthly', priority: 1 },
    ...KEYWORD_PAGES.map((p) => ({ url: `${SITE_URL}/${p.slug}/`, lastModified, changeFrequency: 'monthly' as const, priority: 0.8 })),
    { url: `${SITE_URL}/about/`, lastModified, changeFrequency: 'yearly', priority: 0.5 },
    { url: `${SITE_URL}/support/`, lastModified, changeFrequency: 'yearly', priority: 0.4 },
  ];
}
