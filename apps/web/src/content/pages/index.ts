import type { KeywordPage } from '../types';
import { page as discord } from './compress-video-for-discord';
import { page as to8 } from './compress-video-to-8mb';
import { page as to10 } from './compress-video-to-10mb';
import { page as to20 } from './compress-video-to-20mb';
import { page as to25 } from './compress-video-to-25mb';
import { page as to50 } from './compress-video-to-50mb';
import { page as whatsapp } from './compress-video-for-whatsapp';
import { page as email } from './compress-video-for-email';
import { page as reduce } from './reduce-video-size';
import { page as mp4 } from './compress-mp4';
import { page as mov } from './compress-mov';
import { page as noUpload } from './compress-video-without-uploading';

/** All keyword landing pages, in sitemap/footer order (PLAN §3). */
export const KEYWORD_PAGES: KeywordPage[] = [discord, to8, to10, to20, to25, to50, whatsapp, email, reduce, mp4, mov, noUpload];

const bySlug = new Map(KEYWORD_PAGES.map((p) => [p.slug, p]));

/** The page for a slug, or undefined. */
export function getKeywordPage(slug: string): KeywordPage | undefined {
  return bySlug.get(slug);
}
