export type SecretBox = {
  encrypt: (plaintext: string) => string;
  decrypt: (sealed: string) => string;
};
