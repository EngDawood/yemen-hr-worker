/**
 * Tests for shared HTML cleaning utilities.
 */

import { describe, it, expect } from 'vitest';
import { decodeHtmlEntities, htmlToText, cleanWhitespace, stripMarkdown } from '../src/utils/html';

describe('decodeHtmlEntities', () => {
  it('should decode common HTML entities', () => {
    expect(decodeHtmlEntities('&amp;')).toBe('&');
    expect(decodeHtmlEntities('&lt;')).toBe('<');
    expect(decodeHtmlEntities('&gt;')).toBe('>');
    expect(decodeHtmlEntities('&quot;')).toBe('"');
    expect(decodeHtmlEntities('&nbsp;')).toBe(' ');
    expect(decodeHtmlEntities('&#x27;')).toBe("'");
    expect(decodeHtmlEntities('&#x2F;')).toBe('/');
  });

  it('should replace unknown entities with space', () => {
    expect(decodeHtmlEntities('&mdash;')).toBe(' ');
    expect(decodeHtmlEntities('&rsquo;')).toBe(' ');
  });

  it('should handle text without entities', () => {
    expect(decodeHtmlEntities('Hello World')).toBe('Hello World');
  });

  it('should handle mixed content', () => {
    expect(decodeHtmlEntities('Tom &amp; Jerry &lt;3')).toBe('Tom & Jerry <3');
  });
});

describe('htmlToText', () => {
  it('should convert br tags to newlines', () => {
    expect(htmlToText('Line 1<br>Line 2<br/>Line 3')).toBe('Line 1\nLine 2\nLine 3');
  });

  it('should convert closing p/div tags to newlines', () => {
    expect(htmlToText('<p>Paragraph 1</p><p>Paragraph 2</p>')).toBe('Paragraph 1\nParagraph 2\n');
  });

  it('should convert list items to bullets', () => {
    expect(htmlToText('<ul><li>Item 1</li><li>Item 2</li></ul>')).toBe('- Item 1\n- Item 2\n');
  });

  it('should convert headings with newlines', () => {
    expect(htmlToText('<h2>Title</h2><p>Content</p>')).toBe('\nTitle\nContent\n');
  });

  it('should strip remaining HTML tags', () => {
    expect(htmlToText('<span class="foo">text</span>')).toBe('text');
    expect(htmlToText('<a href="url">link</a>')).toBe('link');
  });

  it('should decode HTML entities in output', () => {
    expect(htmlToText('<p>Tom &amp; Jerry</p>')).toBe('Tom & Jerry\n');
  });

  it('should handle empty input', () => {
    expect(htmlToText('')).toBe('');
  });
});

describe('cleanWhitespace', () => {
  it('should collapse multiple spaces to single', () => {
    expect(cleanWhitespace('hello    world')).toBe('hello world');
  });

  it('should collapse tabs to spaces', () => {
    expect(cleanWhitespace('hello\t\tworld')).toBe('hello world');
  });

  it('should collapse 3+ newlines to 2', () => {
    expect(cleanWhitespace('a\n\n\n\nb')).toBe('a\n\nb');
  });

  it('should trim leading and trailing whitespace', () => {
    expect(cleanWhitespace('  hello  ')).toBe('hello');
  });

  it('should preserve double newlines', () => {
    expect(cleanWhitespace('a\n\nb')).toBe('a\n\nb');
  });
});

describe('stripMarkdown', () => {
  it('should remove bold markers', () => {
    expect(stripMarkdown('This is **bold** text')).toBe('This is bold text');
  });

  it('should convert markdown links to text: url', () => {
    expect(stripMarkdown('[Click here](https://example.com)')).toBe('Click here: https://example.com');
  });

  it('should remove italic markers', () => {
    expect(stripMarkdown('This is _italic_ text')).toBe('This is italic text');
  });

  it('should handle combined formatting', () => {
    expect(stripMarkdown('**Bold** and _italic_ and [link](url)'))
      .toBe('Bold and italic and link: url');
  });

  it('should handle text without markdown', () => {
    expect(stripMarkdown('Plain text')).toBe('Plain text');
  });
});
