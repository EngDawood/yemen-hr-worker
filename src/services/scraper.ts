export async function scrapeJobPage(url: string): Promise<string> {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml',
      },
    });

    if (!response.ok) {
      console.error(`Scrape failed for ${url}: ${response.status}`);
      return '';
    }

    return await response.text();
  } catch (error) {
    console.error(`Error scraping ${url}:`, error);
    return '';
  }
}
