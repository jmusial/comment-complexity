# Comment Complexity

[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/jmusial/comment-complexity/badge)](https://scorecard.dev/viewer/?uri=github.com/jmusial/comment-complexity)


VS Code extension that scores how hard code comments are to read.

> Early development. Scaffold only, no scoring yet.

## Supported languages (planned)

JavaScript, TypeScript (incl. JSX/TSX), Python, Go, Rust, Java, Kotlin, Swift, C, C++, C#, Ruby, PHP, Bash, Lua, SQL, YAML, CSS/SCSS, HTML.

## Development

Requires Node and pnpm.

```bash
pnpm install
```

| Command                 | What it does                                  |
| ----------------------- | --------------------------------------------- |
| `pnpm build`            | Type-check and bundle to `dist/` (production) |
| `pnpm watch`            | Rebuild on change                             |
| `pnpm lint`             | Lint with oxlint                              |
| `pnpm fmt`              | Format with oxfmt (`--check` to verify only)  |
| `pnpm test`             | Unit tests (vitest)                           |
| `pnpm test:integration` | Integration tests inside VS Code              |

Press **F5** in VS Code to launch an Extension Development Host with the extension loaded.

## License

[MIT](LICENSE.md)
