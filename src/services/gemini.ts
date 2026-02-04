import type { ProcessedJob } from '../types';
import { delay } from '../utils/format';

const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 2000; // 2 seconds

/** English→Arabic category map for Yemen HR jobs */
const YEMENHR_CATEGORIES: Record<string, string> = {
  'Development': 'تطوير',
  'Healthcare': 'رعاية صحية',
  'Computers/IT': 'تقنية معلومات',
  'Finance/Accounting': 'محاسبة ومالية',
  'Engineering': 'هندسة',
  'Sales/Marketing': 'مبيعات وتسويق',
  'Administration': 'إدارة',
  'Logistics': 'لوجستيك',
  'Human Resources': 'موارد بشرية',
  'Communication': 'اتصالات',
  'Education/Training': 'تعليم وتدريب',
  'Consulting': 'استشارات',
  'Others': 'أخرى',
};

const VALID_CATEGORIES_AR = Object.values(YEMENHR_CATEGORIES);

/**
 * Extract category label from AI response (first 5 lines).
 * Looks for `🏷️ الفئة: <category>` pattern.
 */
function extractCategoryFromAIResponse(text: string): string {
  const lines = text.split('\n').slice(0, 5);
  for (const line of lines) {
    const match = line.match(/🏷️\s*الفئة:\s*(.+)/);
    if (match) {
      const category = match[1].trim();
      if (VALID_CATEGORIES_AR.includes(category)) return category;
      // Fuzzy match: check if the AI output contains a known category
      for (const valid of VALID_CATEGORIES_AR) {
        if (category.includes(valid) || valid.includes(category)) return valid;
      }
      return 'أخرى';
    }
  }
  return 'أخرى';
}

/**
 * Remove the category line from AI output (it goes in footer instead).
 */
function removeCategoryLine(text: string): string {
  return text.replace(/🏷️\s*الفئة:.*\n?/, '').trim();
}

export interface AISummaryResult {
  summary: string;
  category: string;
}

/**
 * Extract text content from Workers AI response.
 * Handles both standard Workers AI format ({ response: string })
 * and OpenAI chat completion format ({ choices: [{ message: { content: string } }] }).
 */
function extractAIText(response: unknown): string | null {
  if (!response || typeof response !== 'object') return null;
  const obj = response as Record<string, unknown>;

  // Workers AI standard format
  if ('response' in obj && typeof obj.response === 'string') {
    return obj.response || null;
  }

  // OpenAI chat completion format (used by Qwen3 and other models)
  if ('choices' in obj && Array.isArray(obj.choices)) {
    const content = (obj.choices as Array<{ message?: { content?: string } }>)[0]?.message?.content;
    return content || null;
  }

  return null;
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

      // Extract text from response (handles both Workers AI and OpenAI formats)
      const text = extractAIText(response);

      if (!text) {
        console.error(`No text in AI response (${sourceLabel}):`, JSON.stringify(response).substring(0, 500));
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
 * Returns both the summary text and an Arabic category label.
 */
export async function summarizeJob(
  job: ProcessedJob,
  ai: Ai
): Promise<AISummaryResult> {
  const header = buildJobHeader(job);

  const categoryList = VALID_CATEGORIES_AR.join('، ');

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

🏷️ الفئة: [اختر واحدة فقط من: ${categoryList}]

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

  const rawSummary = await callWorkersAI(ai, prompt, job, header, 'Yemen HR');
  const category = extractCategoryFromAIResponse(rawSummary);
  const summary = removeCategoryLine(rawSummary);

  return { summary, category };
}

/**
 * Summarize EOI job with English-to-Arabic translation prompt.
 * Category comes from EOI metadata (job.category), not AI classification.
 * Falls back to buildNoAIFallback on failure.
 */
export async function summarizeEOIJob(
  job: ProcessedJob,
  ai: Ai
): Promise<AISummaryResult> {
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

  const summary = await callWorkersAI(ai, prompt, job, header, 'EOI');
  return { summary, category: job.category || '' };
}
