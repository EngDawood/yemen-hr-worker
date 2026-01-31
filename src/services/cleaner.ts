/**
 * HTML cleaner ported from n8n workflow.
 * Extracts and cleans job description from Yemen HR job pages.
 */
export function cleanJobDescription(html: string): string {
  if (!html) {
    return 'No description available';
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

  return cleanedText || 'No description available';
}
