export interface EOIJobDetail {
  description: string; // Cleaned full description text
  descriptionHtml: string; // Raw HTML from detail-adv div
  imageUrl: string | null; // Company logo URL
  deadline: string | null; // Deadline with time if available
  howToApply: string; // How to apply text
  applicationLinks: string[]; // URLs, emails, phones extracted
}

export interface EOIJob {
  id: string;
  title: string;
  company: string;
  category: string;
  location: string;
  postDate: string;
  deadline: string;
  url: string;
}

export interface EOIAPIResponse {
  table_data: string;
  total_data: number;
}
