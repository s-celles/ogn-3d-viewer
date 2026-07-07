// XCSoar/LK8000 `.plr` polar files imported as raw text
// (`import plr from '…/x.plr' with { type: 'text' }`). Bun inlines the contents
// as a string; we parse it at runtime (see polar.ts).
declare module '*.plr' {
  const content: string;
  export default content;
}
