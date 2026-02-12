/**
 * AI response parsing utilities.
 * Per-source category maps and extraction/validation from Workers AI output.
 */

/** YemenHR categories — matches yemenhr.com job board categories */
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
  'Legal/Law': 'قانون',
  'Others': 'أخرى',
};

/** ReliefWeb categories — humanitarian job sector categories */
const RELIEFWEB_CATEGORIES: Record<string, string> = {
  'Program/Project Management': 'إدارة برامج ومشاريع',
  'Monitoring and Evaluation': 'متابعة وتقييم',
  'Coordination': 'تنسيق',
  'Logistics/Procurement': 'لوجستيك ومشتريات',
  'Protection/Human Rights': 'حماية وحقوق إنسان',
  'Health': 'صحة',
  'Education': 'تعليم',
  'WASH': 'مياه وصرف صحي',
  'Information Management': 'إدارة معلومات',
  'Administration/Finance': 'إدارة ومالية',
  'Human Resources': 'موارد بشرية',
  'Communications/Advocacy': 'اتصالات ودعوة',
  'Food and Nutrition': 'أمن غذائي وتغذية',
  'Information Technology': 'تقنية معلومات',
  'Others': 'أخرى',
};

/** Source → category map lookup */
const SOURCE_CATEGORIES: Record<string, Record<string, string>> = {
  yemenhr: YEMENHR_CATEGORIES,
  reliefweb: RELIEFWEB_CATEGORIES,
};

/** Get valid Arabic categories for a source. Falls back to YemenHR categories. */
export function getValidCategoriesForSource(source?: string): string[] {
  const map = (source && SOURCE_CATEGORIES[source]) || YEMENHR_CATEGORIES;
  return Object.values(map);
}

/**
 * Match raw category strings (e.g., from RSS) against a source's English→Arabic map.
 * Returns the first matching Arabic category, or undefined if no match.
 */
export function matchCategoryFromRaw(rawCategories: string[], source: string): string | undefined {
  const map = SOURCE_CATEGORIES[source];
  if (!map) return undefined;
  for (const raw of rawCategories) {
    const trimmed = raw.trim();
    if (map[trimmed]) return map[trimmed];
  }
  return undefined;
}

// Backward compat — used by ai.ts for the default category list
export const VALID_CATEGORIES_AR = Object.values(YEMENHR_CATEGORIES);

/**
 * Keyword→category mapping for fallback classification when AI doesn't output a category line.
 * Checked against job title + description. First match wins, so order matters (specific before general).
 */
const KEYWORD_CATEGORIES: Array<{ keywords: RegExp; category: string; sources?: string[] }> = [
  // Healthcare / Medical
  { keywords: /\b(doctor|nurse|medic|pharma|health|clinic|hospital|medical|nutrition|صح|طب|تمريض|صيدل)/i, category: 'رعاية صحية' },
  // Engineering
  { keywords: /\b(engineer|civil|mechanical|electrical|structural|مهندس|هندس)/i, category: 'هندسة' },
  // IT / Computers
  { keywords: /\b(software|developer|programmer|IT\b|data\s*(?:analyst|scientist|engineer)|cyber|network|system\s*admin|تقنية|برمج|حاسوب)/i, category: 'تقنية معلومات' },
  // Finance / Accounting
  { keywords: /\b(accountant|finance|financial|audit|budget|treasury|محاسب|مالي|تدقيق)/i, category: 'محاسبة ومالية' },
  // Human Resources
  { keywords: /\b(human\s*resource|HR\b|recruitment|talent|موارد\s*بشر)/i, category: 'موارد بشرية' },
  // Sales / Marketing
  { keywords: /\b(sales|marketing|brand|digital\s*market|content|social\s*media|مبيعات|تسويق)/i, category: 'مبيعات وتسويق' },
  // Education / Training
  { keywords: /\b(teacher|trainer|training|education|instructor|tutor|تعليم|تدريب|مدرس)/i, category: 'تعليم وتدريب' },
  // Logistics
  { keywords: /\b(logistics|supply\s*chain|warehouse|procurement|shipping|لوجست|مشتريات|مستودع)/i, category: 'لوجستيك' },
  // Legal
  { keywords: /\b(legal|lawyer|attorney|law\b|compliance|قانون|محام)/i, category: 'قانون' },
  // Communication
  { keywords: /\b(communicat|journalist|media|public\s*relation|PR\b|اتصال|إعلام|صحاف)/i, category: 'اتصالات' },
  // Consulting
  { keywords: /\b(consult|advisory|استشار)/i, category: 'استشارات' },
  // Administration (broad — keep last among specific categories)
  { keywords: /\b(admin|office\s*manager|secretary|executive\s*assist|إدار|سكرتار)/i, category: 'إدارة' },
  // Development / Programme (broad catch for programme/project officers)
  { keywords: /\b(programme|program\s*officer|project\s*officer|development\s*officer|تطوير)/i, category: 'تطوير' },
];

/** ReliefWeb-specific keyword overrides (humanitarian sector) */
const RELIEFWEB_KEYWORD_CATEGORIES: Array<{ keywords: RegExp; category: string }> = [
  { keywords: /\b(programme|program|project)\s*(officer|manager|coordinator|director|lead)/i, category: 'إدارة برامج ومشاريع' },
  { keywords: /\b(M&E|monitoring|evaluation|MEAL)/i, category: 'متابعة وتقييم' },
  { keywords: /\b(coordinat)/i, category: 'تنسيق' },
  { keywords: /\b(logistics|procurement|supply)/i, category: 'لوجستيك ومشتريات' },
  { keywords: /\b(protection|GBV|child\s*protect|human\s*rights)/i, category: 'حماية وحقوق إنسان' },
  { keywords: /\b(health|medic|nurse|doctor|nutrition)/i, category: 'صحة' },
  { keywords: /\b(education|teacher|school)/i, category: 'تعليم' },
  { keywords: /\b(WASH|water|sanitation|hygiene)/i, category: 'مياه وصرف صحي' },
  { keywords: /\b(information\s*manage|IM\b|data\s*manage)/i, category: 'إدارة معلومات' },
  { keywords: /\b(admin|finance|accountant|budget)/i, category: 'إدارة ومالية' },
  { keywords: /\b(human\s*resource|HR\b|recruitment)/i, category: 'موارد بشرية' },
  { keywords: /\b(communicat|advocacy|media|public\s*info)/i, category: 'اتصالات ودعوة' },
  { keywords: /\b(food|nutrition|food\s*security)/i, category: 'أمن غذائي وتغذية' },
  { keywords: /\b(IT\b|software|developer|technology|ICT)/i, category: 'تقنية معلومات' },
];

/**
 * Classify a job by keyword matching on title + description.
 * Used as fallback when AI doesn't output a category line.
 */
export function classifyByKeywords(title: string, description: string, source?: string): string {
  const text = `${title} ${description}`;
  const keywords = source === 'reliefweb' ? RELIEFWEB_KEYWORD_CATEGORIES : KEYWORD_CATEGORIES;
  for (const { keywords: pattern, category } of keywords) {
    if (pattern.test(text)) return category;
  }
  return 'أخرى';
}

/**
 * Extract category label from AI response.
 * Looks for `🏷️ الفئة: <category>` pattern anywhere in the text.
 * Validates against source-specific category list.
 */
export function extractCategoryFromAIResponse(text: string, source?: string): string {
  const validCategories = getValidCategoriesForSource(source);
  for (const line of text.split('\n')) {
    const match = line.match(/🏷️\s*الفئة:\s*(.+)/);
    if (match) {
      const category = match[1].trim();
      if (validCategories.includes(category)) return category;
      // Fuzzy match: check if the AI output contains a known category
      for (const valid of validCategories) {
        if (category.includes(valid) || valid.includes(category)) return valid;
      }
      return 'أخرى';
    }
  }
  return '';  // Empty = not found (caller should use keyword fallback)
}

/**
 * Remove the category line from AI output (it goes in footer instead).
 */
export function removeCategoryLine(text: string): string {
  return text.replace(/🏷️\s*الفئة:.*\n?/, '').trim();
}
