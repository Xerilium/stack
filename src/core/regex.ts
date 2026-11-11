/** Regex helpers shared by the scoring engines and the overrides. */

/** The text as a literal regex fragment. */
export const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The phrase as whole words (letters and digits), case-insensitive. @req FR:scoring-engine/overrides.match */
export const wordsRe = (phrase: string): RegExp => new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(phrase)}(?![\\p{L}\\p{N}])`, 'iu');
