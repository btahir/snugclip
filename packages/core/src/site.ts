// The one definition of the site address (RULES §10, PLAN §14). The web app's
// `src/config/site.ts` re-exports these next to DONATION_LINKS; nothing else hard-codes the host.
export const SITE_URL = 'https://snugclip.vercel.app';

/** Relative support route used by the web app. */
export const SUPPORT_PATH = '/support/';

/** Absolute support URL for surfaces without a router (CLI, MCP, AGENTS.md). */
export const SUPPORT_URL = `${SITE_URL}${SUPPORT_PATH}`;

/** Published JSON Schema for job files v1. */
export const JOB_SCHEMA_URL = `${SITE_URL}/schema/job.v1.json`;

export const CORE_VERSION = '0.1.0';
