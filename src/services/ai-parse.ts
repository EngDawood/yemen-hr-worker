/**
 * AI response parsing utilities.
 * Category extraction and validation from Workers AI output.
 */

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

export const VALID_CATEGORIES_AR = Object.values(YEMENHR_CATEGORIES);

/**
 * Extract category label from AI response (first 5 lines).
 * Looks for `🏷️ الفئة: <category>` pattern.
 */
export function extractCategoryFromAIResponse(text: string): string {
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
export function removeCategoryLine(text: string): string {
  return text.replace(/🏷️\s*الفئة:.*\n?/, '').trim();
}
