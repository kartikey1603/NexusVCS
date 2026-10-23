// Shared "is this a code/text file" check. Used both for in-browser preview/edit eligibility
// and for enforcing the tighter MAX_CODE_FILE_SIZE_MB ceiling on uploads -- kept as a single
// source of truth so the two never quietly drift apart.
const CODE_TEXT_EXTENSION_RE = /\.(md|txt|js|jsx|ts|tsx|css|html|json|xml|yml|yaml|py|java|c|cpp|h|hpp|sql|sh)$/i;

export function isCodeOrTextFile(name, mimeType) {
  if (mimeType?.startsWith('text/')) return true;
  return CODE_TEXT_EXTENSION_RE.test(String(name || ''));
}
