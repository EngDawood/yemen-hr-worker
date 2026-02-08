/**
 * Job message formatting utilities.
 * Builds message headers, no-AI fallback messages, and application context strings.
 */

import type { ProcessedJob } from '../types';

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
${job.postedDate || 'غير محدد'}

⏰ آخر موعد للتقديم:
${job.deadline || 'غير محدد'}

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
