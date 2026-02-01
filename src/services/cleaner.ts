/**
 * HTML cleaner ported from n8n workflow.
 * Extracts and cleans job description from Yemen HR job pages.
 */

export interface ExtractedJobData {
  description: string;
  location?: string;
  postedDate?: string;
  deadline?: string;
}

export function cleanJobDescription(html: string): ExtractedJobData {
  if (!html) {
    return { description: 'No description available' };
  }

  let text = html;

  // Remove unwanted sections (from n8n workflow)
  text = text.replace(/Important Notes[\s\S]*$/i, '');
  text = text.replace(/Time Remaining[\s\S]*$/i, '');
  text = text.replace(/Save & Share[\s\S]*$/i, '');
  text = text.replace(/Sign in to track your application[\s\S]*$/i, '');
  text = text.replace(/Track Your Application[\s\S]*$/i, '');

  // Convert HTML to text
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<\/p>/gi, '\n');
  text = text.replace(/<\/div>/gi, '\n');
  text = text.replace(/<\/li>/gi, '\n');
  text = text.replace(/<li>/gi, '- ');
  text = text.replace(/<[^>]+>/g, ' ');

  // Decode HTML entities
  text = text.replace(/&#x2F;/g, '/');
  text = text.replace(/&#x27;/g, "'");
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/&amp;/g, '&');
  text = text.replace(/&nbsp;/g, ' ');
  text = text.replace(/&[a-z]+;/gi, ' ');

  // Clean whitespace
  text = text.replace(/[ \t]+/g, ' ');
  text = text.replace(/\n\s*\n\s*\n/g, '\n\n');
  text = text.trim();

  // Extract structured data
  const location = extractField(text, [
    /Location[:\s]+([^\n]+)/i,
    /الموقع[:\s]+([^\n]+)/i,
    /Governorate[:\s]+([^\n]+)/i,
    /City[:\s]+([^\n]+)/i,
  ]);

  const postedDate = extractField(text, [
    /Posted[:\s]+([^\n]+)/i,
    /تاريخ النشر[:\s]+([^\n]+)/i,
    /Publication Date[:\s]+([^\n]+)/i,
    /Date Posted[:\s]+([^\n]+)/i,
  ]);

  const deadline = extractField(text, [
    /Deadline[:\s]+([^\n]+)/i,
    /آخر موعد[:\s]+([^\n]+)/i,
    /Closing Date[:\s]+([^\n]+)/i,
    /Application Deadline[:\s]+([^\n]+)/i,
    /Last Date[:\s]+([^\n]+)/i,
  ]);

  // Extract relevant content
  const lines = text.split('\n');
  const cleanedLines: string[] = [];
  let inContent = false;

  for (let line of lines) {
    line = line.trim();

    if (!line && cleanedLines.length === 0) continue;

    // Start capturing when we find job-related content
    if (
      line.includes('Job Description') ||
      line.includes('الوصف الوظيفي') ||
      line.includes('Vacancy id') ||
      line.includes('Job title') ||
      line.includes('Posted:') ||
      line.includes('Deadline:')
    ) {
      inContent = true;
    }

    // Skip unwanted lines
    if (line.match(/^(CTG Logo|Back to Jobs|New|Sign in to Track|Track Your Application|Keep track of your job)$/)) {
      continue;
    }

    if (inContent) {
      cleanedLines.push(line);
    }
  }

  let cleanedText = cleanedLines.join('\n');

  // Clean up pipe separators
  cleanedText = cleanedText.replace(/\|\s*\|/g, '');
  cleanedText = cleanedText.replace(/^\|\s*/gm, '');
  cleanedText = cleanedText.replace(/\s*\|$/gm, '');
  cleanedText = cleanedText.trim();

  return {
    description: cleanedText || 'No description available',
    location: location || undefined,
    postedDate: postedDate || undefined,
    deadline: deadline || undefined,
  };
}

function extractField(text: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      return match[1].trim();
    }
  }
  return null;
}
