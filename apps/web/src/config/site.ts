/**
 * Site-wide constants. SITE_URL is defined once in @snugclip/core and re-exported here.
 * DONATION_LINKS below is the only place in the repo where a Stripe URL may appear (RULES §5);
 * every "Support" link goes to our own /support/ page, which reads them from here.
 */
import { SITE_URL, SUPPORT_PATH } from '@snugclip/core';

export { SITE_URL };
export const SITE_NAME = 'Snugclip';
export const SUPPORT_URL = SUPPORT_PATH; // "/support/"
export const GITHUB_URL = 'https://github.com/btahir/snugclip';
export const APP_VERSION = '0.1.0';
export const SITE_TAGLINE = 'Fit any video under any size limit. Never over.';
export const SITE_DESCRIPTION =
  'Free, open-source video compressor that fits your clip under an exact size limit for Discord, WhatsApp or email. Runs in your browser: never uploaded, works offline.';

export const DONATION_LINKS = {
  once: "https://buy.stripe.com/fZu14m0FO3v050PfqP3ks00",
  monthly: [
    { label: "$5", note: "Supporter", href: "https://buy.stripe.com/9B68wOewEaXsgJxdiH3ks01" },
    { label: "$15", note: "Backer", href: "https://buy.stripe.com/7sYbJ088g3v0gJx4Mb3ks02" },
    { label: "$50", note: "Sponsor", href: "https://buy.stripe.com/28EeVc88g5D80Kz2E33ks03" },
    { label: "$100", note: "Company sponsor", href: "https://buy.stripe.com/00w14m6088PkbpdceD3ks04" },
  ],
} as const;
