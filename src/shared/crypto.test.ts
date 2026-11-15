import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createSecretBox } from './crypto.js';

describe('createSecretBox', () => {
  const box = createSecretBox(randomBytes(32).toString('base64'));

  it('round-trips without leaking the plaintext', () => {
    const sealed = box.encrypt('api-key-123');
    expect(sealed).not.toContain('api-key-123');
    expect(box.encrypt('api-key-123')).not.toBe(sealed);
    expect(box.decrypt(sealed)).toBe('api-key-123');
  });

  it('refuses tampered values and other keys', () => {
    const sealed = box.encrypt('api-key-123');
    const parts = sealed.split(':');
    const tampered = [
      ...parts.slice(0, 3),
      Buffer.from('x').toString('base64'),
    ].join(':');
    expect(() => box.decrypt(tampered)).toThrow();
    expect(() =>
      createSecretBox(randomBytes(32).toString('base64')).decrypt(sealed),
    ).toThrow();
    expect(() => createSecretBox('short')).toThrow('32 bytes');
  });
});
