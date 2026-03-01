const ENCRYPTION_KEY = 'smart-office-key-v1';

export function encryptApiKey(apiKey: string): string {
  if (!apiKey) return '';
  try {
    const encoded = btoa(encodeURIComponent(apiKey));
    return encoded;
  } catch {
    return '';
  }
}

export function decryptApiKey(encryptedKey: string): string {
  if (!encryptedKey) return '';
  try {
    const decoded = decodeURIComponent(atob(encryptedKey));
    return decoded;
  } catch {
    return '';
  }
}

export function isValidApiKey(apiKey: string): boolean {
  if (!apiKey) return false;
  return apiKey.startsWith('AIza') && apiKey.length > 30;
}
