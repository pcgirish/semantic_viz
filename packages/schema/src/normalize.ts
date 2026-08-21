/**
 * Text normalization for semantic hashes.
 *
 * A semantic hash answers "did the meaning change?", so it must not react to things that carry no
 * meaning: encoding, case, incidental whitespace, a trailing period the model added this run and
 * not the last. Without this, every re-analysis would report renames nobody made.
 */

/** The semantics fields that contribute to a semantic hash, in the fixed order they serialize in. */
const SEMANTIC_FIELDS = ["what", "how", "when", "where", "why"] as const;

/** Field separator: a unit separator cannot appear in normalized text, so fields cannot bleed. */
const FIELD_SEPARATOR = "\x1f";

export type SemanticFields = Partial<Record<(typeof SEMANTIC_FIELDS)[number], string | null>>;

/**
 * NFC → lowercase → collapse whitespace → trim → strip trailing punctuation.
 *
 * `toLocaleLowerCase("en")` rather than `toLowerCase()`: the latter is locale-sensitive in a way
 * that makes a hash depend on the machine that computed it — Turkish locales map "I" to "ı".
 */
export function normalizeText(value: string): string {
  return value
    .normalize("NFC")
    .toLocaleLowerCase("en")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[\p{P}\p{S}]+$/u, "")
    .trim();
}

/**
 * The exact string a semantic hash is computed over: the unit's name plus its semantics, each
 * field normalized, absent fields rendered as empty strings so the arity is fixed. Fixed arity is
 * what keeps a unit with only `what` set from serializing identically to one with only `why`.
 */
export function semanticHashInput(name: string, semantics: SemanticFields | null | undefined): string {
  const fields = SEMANTIC_FIELDS.map((field) => normalizeText(semantics?.[field] ?? ""));
  return [normalizeText(name), ...fields].join(FIELD_SEPARATOR);
}
