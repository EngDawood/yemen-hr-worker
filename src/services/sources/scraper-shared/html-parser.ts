/**
 * Utilities wrapping node-html-parser for HTML scraping.
 * Provides querySelector/querySelectorAll API on parsed HTML strings.
 */

import { parse, HTMLElement } from 'node-html-parser';

/**
 * Parse an HTML string into a queryable document.
 */
export function parseHTML(html: string): HTMLElement {
  return parse(html);
}

/**
 * Get trimmed text content from an element, optionally via a CSS selector.
 * Returns null if element or selector match not found.
 */
export function extractText(element: HTMLElement, selector?: string): string | null {
  const target = selector ? element.querySelector(selector) : element;
  if (!target) return null;
  const text = target.textContent?.trim();
  return text || null;
}

/**
 * Get an attribute value from an element matched by CSS selector.
 * Resolves relative URLs against baseUrl when provided.
 */
export function extractAttr(
  element: HTMLElement,
  selector: string,
  attr: string,
  baseUrl?: string
): string | null {
  const target = element.querySelector(selector);
  if (!target) return null;
  let value = target.getAttribute(attr);
  if (!value) return null;
  value = value.trim();

  // Resolve relative URLs
  if (baseUrl && (attr === 'href' || attr === 'src') && value && !value.startsWith('http')) {
    const base = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
    value = value.startsWith('/') ? `${base}${value}` : `${base}/${value}`;
  }

  return value;
}
