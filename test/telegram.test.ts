/**
 * Tests for Telegram service.
 * Run with: npm test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { sendTextMessage, sendPhotoMessage } from '../src/services/telegram';

const BOT_TOKEN = 'test-bot-token';
const CHAT_ID = '-123456789';

describe('sendTextMessage', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should return true on success', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 })
    );

    const result = await sendTextMessage(BOT_TOKEN, CHAT_ID, 'Hello World');

    expect(result).toBe(true);
    expect(fetch).toHaveBeenCalledWith(
      `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: CHAT_ID,
          text: 'Hello World',
          disable_web_page_preview: false,
        }),
      }
    );
  });

  it('should return false on API error', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({ ok: false, description: 'Bad Request: chat not found' }),
        { status: 200 }
      )
    );

    const result = await sendTextMessage(BOT_TOKEN, CHAT_ID, 'Hello World');

    expect(result).toBe(false);
  });

  it('should return false on network error', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error('Network error'));

    const result = await sendTextMessage(BOT_TOKEN, CHAT_ID, 'Hello World');

    expect(result).toBe(false);
  });
});

describe('sendPhotoMessage', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should return true on success', async () => {
    // Mock image fetch
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response(new Blob(['fake-image-data'], { type: 'image/jpeg' }), { status: 200 })
      )
      // Mock Telegram API call
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 })
      );

    const result = await sendPhotoMessage(
      BOT_TOKEN,
      CHAT_ID,
      'https://example.com/image.jpg',
      'Photo caption'
    );

    expect(result).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(2);

    // First call should be to fetch the image
    expect(fetch).toHaveBeenNthCalledWith(1, 'https://example.com/image.jpg', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });

    // Second call should be to Telegram API with FormData
    const secondCall = vi.mocked(fetch).mock.calls[1];
    expect(secondCall[0]).toBe(`https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`);
    expect(secondCall[1]?.method).toBe('POST');
  });

  it('should fall back to text on image fetch failure', async () => {
    // Mock image fetch failure
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response('Not Found', { status: 404 }))
      // Mock fallback text message
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 })
      );

    const result = await sendPhotoMessage(
      BOT_TOKEN,
      CHAT_ID,
      'https://example.com/missing.jpg',
      'Photo caption'
    );

    expect(result).toBe(true);
    // Should have called sendTextMessage as fallback
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenLastCalledWith(
      `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
      expect.any(Object)
    );
  });

  it('should fall back to text on Telegram API error', async () => {
    // Mock successful image fetch
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response(new Blob(['fake-image-data']), { status: 200 })
      )
      // Mock Telegram photo API error
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ ok: false, description: 'Bad Request: PHOTO_INVALID_DIMENSIONS' }),
          { status: 200 }
        )
      )
      // Mock fallback text message success
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 })
      );

    const result = await sendPhotoMessage(
      BOT_TOKEN,
      CHAT_ID,
      'https://example.com/invalid.jpg',
      'Photo caption'
    );

    expect(result).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('should fall back to text on network error', async () => {
    // Mock network error on image fetch, then successful text message
    vi.mocked(fetch)
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 })
      );

    const result = await sendPhotoMessage(
      BOT_TOKEN,
      CHAT_ID,
      'https://example.com/image.jpg',
      'Photo caption'
    );

    expect(result).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('should return false if both photo and text fallback fail', async () => {
    // Mock network error on image fetch
    vi.mocked(fetch)
      .mockRejectedValueOnce(new Error('Network error'))
      // Mock fallback text message failure
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: false, description: 'Forbidden' }), { status: 200 })
      );

    const result = await sendPhotoMessage(
      BOT_TOKEN,
      CHAT_ID,
      'https://example.com/image.jpg',
      'Photo caption'
    );

    expect(result).toBe(false);
  });
});
