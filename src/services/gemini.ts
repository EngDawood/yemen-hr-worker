import type { ProcessedJob } from '../types';

const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 5000; // 5 seconds

interface GeminiResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
  }>;
  error?: {
    message?: string;
    code?: number;
  };
}

/**
 * Delay execution for the specified milliseconds.
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Translates and summarizes job posting using Google Gemini.
 * Prompt is ported from the n8n workflow.
 */
export async function summarizeJob(
  job: ProcessedJob,
  apiKey: string
): Promise<string> {
  const prompt = `You are an expert job analyst. Analyze this job posting and provide a structured summary.

Job Details:
Title: ${job.title}
Company: ${job.company}
Link: ${job.link}
Full Job Description:
${job.description}

IMPORTANT RULES:
- ALWAYS respond in Arabic language ONLY
- If the job description is in English, translate it to Arabic
- If the job description is bilingual, provide the output in Arabic only
- Keep the JOB TITLE exactly as it appears in the original (do not translate)
- Keep the COMPANY NAME exactly as it appears in the original (do not translate)
- Extract ALL information including company details, requirements, and application process
- Keep formatting clean and organized
- DO NOT use any markdown formatting (no **, no _, no []())
- Use only plain text with emojis

Provide this information:

📋 Job Title / المسمى الوظيفي:
${job.title}

🏢 Organization / الجهة:
${job.company}
[جملة واحدة عن الشركة إن وجدت]

📍 Location / الموقع:
[الموقع الجغرافي]

📅 Posted / تاريخ النشر:
[تاريخ النشر]

⏰ Deadline / آخر موعد:
[الموعد النهائي]

━━━━━━━━━━━━━━━━━━━━

📋 Job Description / الوصف الوظيفي:
[قدم الوصف الكامل للوظيفة بالعربية مع الأقسام التالية:
- المسؤوليات الرئيسية
- المؤهلات المطلوبة
- المهارات المطلوبة
- أي تفاصيل أخرى ذات صلة]

━━━━━━━━━━━━━━━━━━━━

📧 How to Apply / كيفية التقديم:
[تعليمات التقديم التفصيلية بالعربية بما في ذلك البريد الإلكتروني أو الرابط أو النموذج]

احتفظ بالمجموع أقل من 3500 حرف.`;

  // Retry loop with exponential backoff
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            contents: [
              {
                parts: [{ text: prompt }],
              },
            ],
            generationConfig: {
              temperature: 0.7,
              maxOutputTokens: 2048,
            },
          }),
        }
      );

      // Handle rate limiting (429) with exponential backoff
      if (response.status === 429) {
        const waitTime = Math.pow(2, attempt) * INITIAL_BACKOFF_MS; // 5s, 10s, 20s
        console.log(`Rate limited (429), retry ${attempt + 1}/${MAX_RETRIES} after ${waitTime}ms`);

        if (attempt < MAX_RETRIES - 1) {
          await delay(waitTime);
          continue;
        }

        console.error('Max retries reached for rate limiting');
        return getFallbackMessage();
      }

      // Handle other HTTP errors
      if (!response.ok) {
        const errorText = await response.text();
        console.error(`Gemini API error: ${response.status}`, errorText);

        // Retry on 5xx server errors
        if (response.status >= 500 && attempt < MAX_RETRIES - 1) {
          const waitTime = Math.pow(2, attempt) * INITIAL_BACKOFF_MS;
          console.log(`Server error (${response.status}), retry ${attempt + 1}/${MAX_RETRIES} after ${waitTime}ms`);
          await delay(waitTime);
          continue;
        }

        return getFallbackMessage();
      }

      const data: GeminiResponse = await response.json();

      if (data.error) {
        console.error('Gemini API error:', data.error.message);
        return getFallbackMessage();
      }

      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;

      if (!text) {
        console.error('No text in Gemini response');
        return getFallbackMessage();
      }

      // Clean any markdown formatting
      const cleanedText = text
        .replace(/\*\*/g, '') // Remove bold
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1: $2') // Convert [text](url) to text: url
        .replace(/_([^_]+)_/g, '$1'); // Remove italic

      return cleanedText;
    } catch (error) {
      console.error(`Error calling Gemini API (attempt ${attempt + 1}):`, error);

      // Retry on network errors
      if (attempt < MAX_RETRIES - 1) {
        const waitTime = Math.pow(2, attempt) * INITIAL_BACKOFF_MS;
        console.log(`Network error, retry ${attempt + 1}/${MAX_RETRIES} after ${waitTime}ms`);
        await delay(waitTime);
        continue;
      }
    }
  }

  console.error('All retries exhausted');
  return getFallbackMessage();
}

function getFallbackMessage(): string {
  return '📋 وظيفة جديدة متاحة\n\nالرجاء زيارة رابط الوظيفة للمزيد من التفاصيل.';
}
