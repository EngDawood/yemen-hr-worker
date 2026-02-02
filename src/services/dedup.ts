/**
 * Cross-source deduplication service.
 * Prevents posting the same job from different sources (Yemen HR vs EOI).
 */

/**
 * Normalize a string for comparison.
 * Lowercases, removes punctuation, and collapses whitespace.
 */
export function normalize(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^\w\s\u0600-\u06FF]/g, '') // Keep alphanumeric, spaces, and Arabic chars
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Generate a normalized key from title + company for cross-source matching.
 * Used to detect if the same job appears on both Yemen HR and EOI.
 */
export function normalizeJobKey(title: string, company: string): string {
  const normalizedTitle = normalize(title);
  const normalizedCompany = normalize(company);
  return `dedup:${normalizedTitle}:${normalizedCompany}`;
}

/**
 * Check if two jobs are likely duplicates based on title and company.
 */
export function areJobsDuplicates(
  job1: { title: string; company: string },
  job2: { title: string; company: string }
): boolean {
  return normalizeJobKey(job1.title, job1.company) === normalizeJobKey(job2.title, job2.company);
}
