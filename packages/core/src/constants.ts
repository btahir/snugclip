/** Public site. Kept in one constant so it is never hard-coded twice (RULES §10). */
export const SITE_URL = 'https://snugclip.vercel.app';

/**
 * Absolute support URL used by surfaces without their own page router (CLI, MCP, AGENTS.md).
 * The web app links its own relative `/support/` route, which resolves to the same page.
 * Stripe links live only in the web app's `src/config/site.ts`, never here.
 */
export const SUPPORT_URL = `${SITE_URL}/support/`;

/** Relative support path for the web app. */
export const SUPPORT_PATH = '/support/';

/** Core library version, reported in every Report. */
export const CORE_VERSION = '0.1.0';

/** Version of the job file format (`*.snugclip.json`). */
export const JOB_SCHEMA_VERSION = 1;

/** Version of the Report object embedded in job files and returned by the CLI/MCP. */
export const REPORT_SCHEMA_VERSION = 1;

/** Decimal megabyte, the unit the UI shows (1 MB = 1,000,000 bytes). */
export const MB = 1_000_000;
/** Binary mebibyte, used only where a platform really means MiB (stated per preset). */
export const MiB = 1_048_576;

/** Smallest and largest custom target the UI accepts (BRIEF: custom 1–4096 MB). */
export const MIN_TARGET_BYTES = 1 * MB;
export const MAX_TARGET_BYTES = 4096 * MB;
