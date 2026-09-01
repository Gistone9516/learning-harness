// The highlighter moved to src/highlight so every part can use it (codeproj needs it for whole
// files, conceptprob for fenced blocks). Kept as a re-export so this part's imports and its tests
// stay put.
export { highlightCode, normLang, type Lang } from "../../src/highlight/highlight";
