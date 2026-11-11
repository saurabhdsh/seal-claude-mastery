function hashNorm(norm: string) {
  let h = 2166136261;
  for (let i = 0; i < norm.length; i++) {
    h ^= norm.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `fp_${(h >>> 0).toString(16)}`;
}

export function fingerprintQuestion(text: string, scenario: string) {
  const norm = `${text}\n${scenario}`
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return hashNorm(norm);
}

/**
 * Near-duplicate key used during sitting assembly.
 * Strips module codes (F01…) and quoted names so templated seed stems
 * that only differ by module label collapse to one family.
 */
export function familyFingerprint(text: string, _scenario = "") {
  // Trainee-visible sameness is the question stem. Ignore module scenario wrappers
  // so the same catalog stem under F01 vs F02 cannot appear twice in one sitting.
  void _scenario;
  const norm = text
    .toLowerCase()
    .replace(/\(module context:.*?\)/g, " ")
    .replace(/\b[fpaex]\d{2}\b/g, "module")
    .replace(/"[^"]{2,120}"/g, "name")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return hashNorm(norm);
}

export function tokenOverlap(a: string, b: string) {
  const ta = new Set(a.toLowerCase().split(/\W+/).filter((t) => t.length > 3));
  const tb = new Set(b.toLowerCase().split(/\W+/).filter((t) => t.length > 3));
  if (!ta.size || !tb.size) return 0;
  let n = 0;
  for (const t of ta) if (tb.has(t)) n++;
  return n / Math.min(ta.size, tb.size);
}
