import type { ProcessedJob } from '../types';

const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 2000; // 2 seconds

/**
 * Delay execution for the specified milliseconds.
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Translates and summarizes job posting using Cloudflare Workers AI (Qwen 2.5).
 */
export async function summarizeJob(
  job: ProcessedJob,
  ai: Ai
): Promise<string> {
  // Build the header with pre-extracted data
  const header = `📋 المسمى الوظيفي:
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

  // Retry loop with exponential backoff
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const response = await ai.run(
        '@cf/meta/llama-3.3-70b-instruct-fp8-fast' as Parameters<typeof ai.run>[0],
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
        console.error('Invalid AI response format');
        if (attempt < MAX_RETRIES - 1) {
          const waitTime = Math.pow(2, attempt) * INITIAL_BACKOFF_MS;
          console.log(`Retrying after ${waitTime}ms...`);
          await delay(waitTime);
          continue;
        }
        return header + '\n\n📋 الوصف الوظيفي:\nالرجاء زيارة رابط الوظيفة للمزيد من التفاصيل.';
      }

      // Extract text from response
      const text = 'response' in response ? (response as { response: string }).response : null;

      if (!text) {
        console.error('No text in AI response:', JSON.stringify(response));
        if (attempt < MAX_RETRIES - 1) {
          const waitTime = Math.pow(2, attempt) * INITIAL_BACKOFF_MS;
          console.log(`Empty response, retrying after ${waitTime}ms...`);
          await delay(waitTime);
          continue;
        }
        return header + '\n\n📋 الوصف الوظيفي:\nالرجاء زيارة رابط الوظيفة للمزيد من التفاصيل.';
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
      console.error(`Error calling Workers AI (attempt ${attempt + 1}):`, error);

      // Retry on errors
      if (attempt < MAX_RETRIES - 1) {
        const waitTime = Math.pow(2, attempt) * INITIAL_BACKOFF_MS;
        console.log(`Error occurred, retry ${attempt + 1}/${MAX_RETRIES} after ${waitTime}ms`);
        await delay(waitTime);
        continue;
      }
    }
  }

  console.error('All retries exhausted');
  return header + '\n\n📋 الوصف الوظيفي:\nالرجاء زيارة رابط الوظيفة للمزيد من التفاصيل.';
}
