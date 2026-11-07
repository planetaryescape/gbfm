// Version 1 equality for explicit artist aliases, not fuzzy identity resolution.
// Keep accents and punctuation; canonical composition and whitespace do not
// create separate names. Shared by alias writes and primary-name collision checks.
export const musicFactNameKey = (value: string): string =>
  value.normalize('NFC').trim().replace(/\s+/gu, ' ').toLowerCase().normalize('NFC')
