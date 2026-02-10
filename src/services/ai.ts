/**
 * AI translation/summary service.
 * Calls Workers AI with retry logic and response parsing.
 */

import type { Env, ProcessedJob } from '../types';
import { delay } from '../utils/format';
import { stripMarkdown } from '../utils/html';
import { buildJobHeader, buildNoAIFallback, buildApplyContext } from './ai-format';
import { VALID_CATEGORIES_AR, extractCategoryFromAIResponse, removeCategoryLine } from './ai-parse';
import { getPromptConfig, getPromptTemplate, renderTemplate } from './ai-prompts';
import { DEFAULT_SOURCE } from './sources/registry';

// Re-export for backward compatibility (tests + other modules import from './ai')
export { buildJobHeader, buildNoAIFallback } from './ai-format';

const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 2000; // 2 seconds
const DEFAULT_AI_MODEL = '@cf/qwen/qwen3-30b-a3b-fp8'; // Default Workers AI model

/** Models that use OpenAI Responses API format (input + instructions) instead of chat completions (messages) */
const RESPONSES_API_MODELS = ['@cf/openai/gpt-oss-120b', '@cf/openai/gpt-oss-20b'];

function isResponsesAPIModel(model: string): boolean {
  return RESPONSES_API_MODELS.some(m => model.startsWith(m));
}

export interface AISummaryResult {
  summary: string;
  category: string;
}

/**
 * Extract text content from Workers AI response.
 * Handles multiple response formats:
 * - Standard Workers AI: { response: string }
 * - Chat completions: { choices: [{ message: { content: string } }] }
 * - Responses API (gpt-oss): { output: [{ content: [{ text: string }] }] } or { output_text: string }
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

  // Responses API format: output_text shorthand
  if ('output_text' in obj && typeof obj.output_text === 'string') {
    return obj.output_text || null;
  }

  // Responses API format: output array with content blocks
  if ('output' in obj && Array.isArray(obj.output)) {
    for (const item of obj.output as Array<Record<string, unknown>>) {
      if (item.type === 'message' && Array.isArray(item.content)) {
        for (const block of item.content as Array<Record<string, unknown>>) {
          if (block.type === 'output_text' && typeof block.text === 'string') {
            return block.text || null;
          }
        }
      }
    }
  }

  return null;
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
  sourceLabel: string,
  aiModel: string = DEFAULT_AI_MODEL
): Promise<string> {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      // Use Responses API format for gpt-oss models, chat completions for others
      const params = isResponsesAPIModel(aiModel)
        ? { input: prompt, instructions: 'You are a professional Arabic translator and job summarizer.' }
        : { messages: [{ role: 'user', content: prompt }], max_tokens: 1024, temperature: 0.7 };

      const response = await ai.run(
        aiModel as Parameters<typeof ai.run>[0],
        params as Record<string, unknown>
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
      let cleanedText = stripMarkdown(text);

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
 * Translates and summarizes a job posting using Cloudflare Workers AI.
 * Returns both the summary text and an Arabic category label.
 *
 * Uses per-source prompt config to control output sections:
 * - Sources with howToApply data (eoi, reliefweb): include apply section
 * - Sources without: omit apply section entirely to prevent hallucination
 */
export async function summarizeJob(
  job: ProcessedJob,
  env: Env
): Promise<AISummaryResult> {
  const header = buildJobHeader(job);
  const hasCategory = !!job.category;
  const source = job.source || DEFAULT_SOURCE;
  const promptConfig = await getPromptConfig(source, env);

  // Only include apply context when source actually provides apply data
  const applyContext = promptConfig.includeHowToApply ? buildApplyContext(job) : '';

  // Build category instruction for AI
  const categoryList = VALID_CATEGORIES_AR.join('، ');
  const categorySection = hasCategory
    ? '' // Category already known, don't ask AI to classify
    : `\n🏷️ الفئة: [اختر واحدة فقط من: ${categoryList}]\n`;

  // Source hint gives AI context about the data shape
  const sourceHintSection = promptConfig.sourceHint
    ? `\nSOURCE CONTEXT: ${promptConfig.sourceHint}\n`
    : '';

  // Conditional apply output template
  const applyOutputTemplate = promptConfig.includeHowToApply
    ? `\n\n━━━━━━━━━━━━━━━━━━━━\n\n📧 كيفية التقديم:\n[معلومات التقديم فقط - لا تتجاوز 120 حرف:]\n📩 [إيميل] 🔗 [رابط] 📱 [واتساب]`
    : '';

  // Without apply section, description gets more character budget
  const descLimit = promptConfig.includeHowToApply ? 250 : 350;
  const totalLimit = promptConfig.includeHowToApply ? 400 : 380;

  const applyLimitLine = promptConfig.includeHowToApply
    ? '\n- How to apply section: MAXIMUM 120 characters total'
    : '';

  // Anti-hallucination rule for sources without apply data
  const noApplyRule = promptConfig.includeHowToApply
    ? ''
    : '\n- DO NOT include any how-to-apply section, contact information, emails, phone numbers, or application links';

  const template = await getPromptTemplate(env);
  const prompt = renderTemplate(template, {
    sourceHint: sourceHintSection,
    description: job.description,
    applyContext,
    descLimit: String(descLimit),
    totalLimit: String(totalLimit),
    applyLimitLine,
    noApplyRule,
    categorySection,
    applyOutputTemplate,
  });

  const aiModel = env.AI_MODEL || DEFAULT_AI_MODEL;
  const sourceLabel = source;
  const rawSummary = await callWorkersAI(env.AI, prompt, job, header, sourceLabel, aiModel);

  // Determine category
  let category: string;
  if (hasCategory) {
    category = job.category!;
  } else {
    category = extractCategoryFromAIResponse(rawSummary);
  }

  let summary = removeCategoryLine(rawSummary);

  // Append static fallback apply section for sources without AI-generated apply data
  if (!promptConfig.includeHowToApply && promptConfig.applyFallback) {
    summary += `\n\n━━━━━━━━━━━━━━━━━━━━\n\n📧 كيفية التقديم:\n${promptConfig.applyFallback}`;
  }

  return { summary, category };
}
