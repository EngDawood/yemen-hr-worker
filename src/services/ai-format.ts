/**
 * Job message formatting utilities.
 * Builds message headers, no-AI fallback messages, and application context strings.
 */

import type { ProcessedJob } from '../types';

const ARABIC_MONTHS = [
  'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
  'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر',
];

const ENGLISH_MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

/**
 * Convert a date string to Arabic format. Supports:
 * - "03-02-2026"       → "03 فبراير 2026"  (EOI: DD-MM-YYYY)
 * - "09-02-2026 23:59" → "09 فبراير 2026"  (EOI: DD-MM-YYYY HH:mm)
 * - "22 Feb, 26"       → "22 فبراير 2026"  (Yemen HR: DD Mon, YY)
 * - "22 Feb, 2026"     → "22 فبراير 2026"  (Yemen HR: DD Mon, YYYY)
 */
export function formatArabicDate(dateStr: string): string {
  if (!dateStr) return 'غير محدد';

  // EOI format: DD-MM-YYYY or DD-MM-YYYY HH:mm
  const numericMatch = dateStr.match(/^(\d{2})-(\d{2})-(\d{4})/);
  if (numericMatch) {
    const [, day, month, year] = numericMatch;
    const monthIndex = parseInt(month, 10) - 1;
    if (monthIndex >= 0 && monthIndex <= 11) {
      return `${day} ${ARABIC_MONTHS[monthIndex]} ${year}`;
    }
  }

  // Yemen HR format: DD Mon, YY or DD Mon, YYYY (e.g. "22 Feb, 26")
  const textMatch = dateStr.match(/(\d{1,2})\s+([A-Za-z]{3}),?\s*(\d{2,4})/);
  if (textMatch) {
    const [, day, monthStr, yearStr] = textMatch;
    const monthIndex = ENGLISH_MONTHS[monthStr.toLowerCase()];
    if (monthIndex !== undefined) {
      const year = yearStr.length === 2 ? `20${yearStr}` : yearStr;
      return `${day} ${ARABIC_MONTHS[monthIndex]} ${year}`;
    }
  }

  return dateStr;
}

/**
 * Build the shared header used by all job messages.
 */
export function buildJobHeader(job: ProcessedJob): string {
  return `📋 المسمى الوظيفي:
${job.title}

🏢 الجهة:
${job.company}

📍 الموقع:
${job.location || 'غير محدد'}

📅 تاريخ النشر:
${formatArabicDate(job.postedDate || '')}

⏰ آخر موعد للتقديم:
${formatArabicDate(job.deadline || '')}

━━━━━━━━━━━━━━━━━━━━`;
}

/**
 * Build a no-AI fallback message from scraped data.
 * Uses actual scraped content instead of generic "visit link" message.
 */
export function buildNoAIFallback(job: ProcessedJob): string {
  const header = buildJobHeader(job);
  const parts: string[] = [header];

  // Description section
  if (job.description && job.description !== 'No description available') {
    // Truncate long descriptions
    let desc = job.description;
    if (desc.length > 600) {
      desc = desc.substring(0, 597) + '...';
    }
    parts.push(`\n📋 الوصف الوظيفي:\n${desc}`);
  } else {
    parts.push('\n📋 الوصف الوظيفي:\nالرجاء زيارة رابط الوظيفة للمزيد من التفاصيل.');
  }

  // How to apply section
  if (job.howToApply || (job.applicationLinks && job.applicationLinks.length > 0)) {
    parts.push('\n━━━━━━━━━━━━━━━━━━━━');
    parts.push('\n📧 كيفية التقديم:');

    if (job.howToApply) {
      let applyText = job.howToApply;
      if (applyText.length > 200) {
        applyText = applyText.substring(0, 197) + '...';
      }
      parts.push(applyText);
    }

    if (job.applicationLinks && job.applicationLinks.length > 0) {
      for (const link of job.applicationLinks) {
        if (link.includes('@')) {
          parts.push(`📩 إيميل: ${link}`);
        } else if (link.match(/^\+?\d/)) {
          parts.push(`📱 واتساب/هاتف: ${link}`);
        } else {
          parts.push(`🔗 رابط: ${link}`);
        }
      }
    }
  }

  return parts.join('\n');
}

/**
 * Build the application context string for AI prompts.
 */
export function buildApplyContext(job: ProcessedJob): string {
  let context = '';
  if (job.applicationLinks && job.applicationLinks.length > 0) {
    context = '\n\nApplication links/contacts (PRESERVE EXACTLY as-is, do not translate or modify):\n' +
      job.applicationLinks.join('\n');
  }
  if (job.howToApply) {
    context += '\n\nHow to Apply section:\n' + job.howToApply;
  }
  return context;
}
