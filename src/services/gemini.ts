import type { ProcessedJob } from '../types';
import { delay } from '../utils/format';

const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 2000; // 2 seconds

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
 * Call Workers AI with retry logic, response validation, and cleanup.
 * Returns the header + AI content, or falls back to buildNoAIFallback.
 */
async function callWorkersAI(
  ai: Ai,
  prompt: string,
  job: ProcessedJob,
  header: string,
  sourceLabel: string
): Promise<string> {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const response = await ai.run(
        '@cf/qwen/qwen3-30b-a3b-fp8' as Parameters<typeof ai.run>[0],
        {
          messages: [
            {
              role: 'user',
              content: prompt,
            },
          ],
          max_tokens: 1024,
          temperature: 0.7,
        }
      );

      // Handle response
      if (!response || typeof response !== 'object') {
        console.error(`Invalid AI response format (${sourceLabel})`);
        if (attempt < MAX_RETRIES - 1) {
          const waitTime = Math.pow(2, attempt) * INITIAL_BACKOFF_MS;
          console.log(`Retrying after ${waitTime}ms...`);
          await delay(waitTime);
          continue;
        }
        return buildNoAIFallback(job);
      }

      // Extract text from response
      const text = 'response' in response ? (response as { response: string }).response : null;

      if (!text) {
        console.error(`No text in AI response (${sourceLabel}):`, JSON.stringify(response));
        if (attempt < MAX_RETRIES - 1) {
          const waitTime = Math.pow(2, attempt) * INITIAL_BACKOFF_MS;
          console.log(`Empty response, retrying after ${waitTime}ms...`);
          await delay(waitTime);
          continue;
        }
        return buildNoAIFallback(job);
      }

      // Clean any markdown formatting and remove preamble
      let cleanedText = text
        .replace(/\*\*/g, '') // Remove bold
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1: $2') // Convert [text](url) to text: url
        .replace(/_([^_]+)_/g, '$1'); // Remove italic

      // Remove any preamble before the actual content (starts with 📋)
      const contentStart = cleanedText.indexOf('📋');
      if (contentStart > 0) {
        cleanedText = cleanedText.substring(contentStart);
      }

      // Combine pre-built header with AI-generated content
      return header + '\n\n' + cleanedText.trim();
    } catch (error) {
      console.error(`Error calling Workers AI (${sourceLabel}, attempt ${attempt + 1}):`, error);

      if (attempt < MAX_RETRIES - 1) {
        const waitTime = Math.pow(2, attempt) * INITIAL_BACKOFF_MS;
        console.log(`Error occurred, retry ${attempt + 1}/${MAX_RETRIES} after ${waitTime}ms`);
        await delay(waitTime);
        continue;
      }
    }
  }

  console.error(`All retries exhausted (${sourceLabel})`);
  return buildNoAIFallback(job);
}

/**
 * Translates and summarizes job posting using Cloudflare Workers AI.
 */
export async function summarizeJob(
  job: ProcessedJob,
  ai: Ai
): Promise<string> {
  const header = buildJobHeader(job);

  const prompt = `Translate and summarize this job posting to Arabic.

Job Description:
${job.description}

CRITICAL RULES:
- DO NOT include any introduction or preamble
- Respond ONLY in Arabic
- BE CONCISE - maximum 400 characters for description, 200 for how to apply
- NO markdown formatting (no **, no _, no []())
- Use plain text only

Output ONLY this format (nothing else):

📋 الوصف الوظيفي:
[ترجمة وملخص مختصر للوظيفة في 2-3 جمل بالعربية]

━━━━━━━━━━━━━━━━━━━━

📧 كيفية التقديم:
[استخدم الرموز المناسبة فقط:]
📩 إيميل: [إن وجد]
🔗 فورم: [إن وجد رابط فورم]
🌐 موقع: [إن وجد رابط موقع]
📱 واتساب: [إن وجد]
📞 هاتف: [إن وجد]`;

  return callWorkersAI(ai, prompt, job, header, 'Yemen HR');
}

/**
 * Summarize EOI job with English-to-Arabic translation prompt.
 * Falls back to buildNoAIFallback on failure.
 */
export async function summarizeEOIJob(
  job: ProcessedJob,
  ai: Ai
): Promise<string> {
  const header = buildJobHeader(job);

  // Build application links context for the prompt
  let applyContext = '';
  if (job.applicationLinks && job.applicationLinks.length > 0) {
    applyContext = '\n\nApplication links/contacts (PRESERVE EXACTLY as-is, do not translate or modify):\n' +
      job.applicationLinks.join('\n');
  }
  if (job.howToApply) {
    applyContext += '\n\nHow to Apply section:\n' + job.howToApply;
  }

  const prompt = `Translate this English job posting to Arabic and summarize concisely.

Job Description (in English):
${job.description}${applyContext}

CRITICAL RULES:
- The content is in ENGLISH - translate to Arabic
- DO NOT include any introduction or preamble
- Respond ONLY in Arabic
- BE CONCISE - maximum 400 characters for description, 200 for how to apply
- NO markdown formatting (no **, no _, no []())
- Use plain text only
- PRESERVE all URLs, email addresses, and phone numbers EXACTLY as-is (do not translate them)

Output ONLY this format (nothing else):

📋 الوصف الوظيفي:
[ترجمة وملخص مختصر للوظيفة في 2-3 جمل بالعربية]

━━━━━━━━━━━━━━━━━━━━

📧 كيفية التقديم:
[استخدم الرموز المناسبة فقط:]
📩 إيميل: [إن وجد]
🔗 فورم: [إن وجد رابط فورم]
🌐 موقع: [إن وجد رابط موقع]
📱 واتساب: [إن وجد]
📞 هاتف: [إن وجد]`;

  return callWorkersAI(ai, prompt, job, header, 'EOI');
}
