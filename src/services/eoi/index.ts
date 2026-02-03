// Types
export type { EOIJobDetail, EOIJob } from './types';
// Client (network)
export { fetchEOIJobs, fetchEOIJobsRaw, fetchEOIJobDetail } from './client';
// Parser (pure)
export { cleanEOIDescription, extractHowToApply, buildEnrichedDescription, formatEOIDate } from './parser';
// Feed generation
export { generateAtomFeed, generateRSSFeed } from './feed';
