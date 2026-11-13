// Which files a person must approve. Everything runs on people's machines, tells the model what to do, or is a check
// itself, except the documents below: the READMEs, MAINTAINING.md and LICENSE.md. Paths are repo-relative, with forward
// slashes, as git prints them. .github/CODEOWNERS lists the same exceptions.
export const GUARD_LABEL = 'runs-on-machines';

const documents = /^(?:README\.md|MAINTAINING\.md|LICENSE\.md|plugins\/[^/]+\/README\.md)$/;

export const isGuarded = (path) => !documents.test(path);
