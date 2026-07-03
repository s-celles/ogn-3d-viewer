// CSV files imported as raw text (`import csv from '…/x.csv' with { type: 'text' }`).
// Bun's bundler inlines the file contents as a string; we parse it at runtime.
declare module '*.csv' {
  const content: string;
  export default content;
}
