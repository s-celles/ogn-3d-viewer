// Markdown files imported as raw text (`import md from '…/x.md' with { type: 'text' }`).
// Bun's bundler inlines the file contents as a string.
declare module '*.md' {
  const content: string;
  export default content;
}
