import { describe, it, expect } from 'vitest';
import { parseCommand } from '../src/services/commands';
import type { TelegramUpdate } from '../src/types/telegram';

describe('parseCommand', () => {
  const createUpdate = (text: string, userId = 123, chatId = 123, chatType = 'private'): TelegramUpdate => ({
    update_id: 1,
    message: {
      message_id: 1,
      from: {
        id: userId,
        is_bot: false,
        first_name: 'Test',
      },
      chat: {
        id: chatId,
        type: chatType as 'private' | 'group' | 'supergroup' | 'channel',
      },
      date: Date.now(),
      text,
    },
  });

  it('should parse simple command', () => {
    const update = createUpdate('/help');
    const result = parseCommand(update);

    expect(result).toEqual({
      command: 'help',
      args: [],
      chatId: 123,
      userId: 123,
    });
  });

  it('should parse command with arguments', () => {
    const update = createUpdate('/job abc123');
    const result = parseCommand(update);

    expect(result).toEqual({
      command: 'job',
      args: ['abc123'],
      chatId: 123,
      userId: 123,
    });
  });

  it('should parse command with multiple arguments', () => {
    const update = createUpdate('/search software engineer');
    const result = parseCommand(update);

    expect(result).toEqual({
      command: 'search',
      args: ['software', 'engineer'],
      chatId: 123,
      userId: 123,
    });
  });

  it('should handle command with bot username', () => {
    const update = createUpdate('/help@mybot');
    const result = parseCommand(update);

    expect(result?.command).toBe('help');
  });

  it('should return null for non-command messages', () => {
    const update = createUpdate('hello world');
    const result = parseCommand(update);

    expect(result).toBeNull();
  });

  it('should return null for empty message', () => {
    const update: TelegramUpdate = {
      update_id: 1,
      message: {
        message_id: 1,
        from: { id: 123, is_bot: false, first_name: 'Test' },
        chat: { id: 123, type: 'private' },
        date: Date.now(),
        // no text
      },
    };
    const result = parseCommand(update);

    expect(result).toBeNull();
  });

  it('should return null for update without message', () => {
    const update: TelegramUpdate = {
      update_id: 1,
      // no message
    };
    const result = parseCommand(update);

    expect(result).toBeNull();
  });

  it('should lowercase command', () => {
    const update = createUpdate('/HELP');
    const result = parseCommand(update);

    expect(result?.command).toBe('help');
  });
});
