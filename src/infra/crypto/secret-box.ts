import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const version = 'v1';

export function createSecretBox(base64Key: string) {
  const key = Buffer.from(base64Key, 'base64');

  if (key.length !== 32) {
    throw new Error('Encryption key must be 32 bytes');
  }

  return {
    encrypt: (plaintext: string): string => {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      const data = Buffer.concat([
        cipher.update(plaintext, 'utf8'),
        cipher.final(),
      ]);

      return [version, iv, cipher.getAuthTag(), data]
        .map((part) =>
          typeof part === 'string' ? part : part.toString('base64'),
        )
        .join(':');
    },
    decrypt: (sealed: string): string => {
      const [prefix, iv, tag, data] = sealed.split(':');

      if (
        prefix !== version ||
        iv === undefined ||
        tag === undefined ||
        data === undefined
      ) {
        throw new Error('Unrecognised secret format');
      }

      const decipher = createDecipheriv(
        'aes-256-gcm',
        key,
        Buffer.from(iv, 'base64'),
      );

      decipher.setAuthTag(Buffer.from(tag, 'base64'));

      return Buffer.concat([
        decipher.update(Buffer.from(data, 'base64')),
        decipher.final(),
      ]).toString('utf8');
    },
  };
}

export type SecretBox = ReturnType<typeof createSecretBox>;
