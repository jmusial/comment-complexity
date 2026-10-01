# Calibration dataset

`comments.jsonl` holds 150 code comments labeled by how hard they are to read. `pnpm calibrate`
fits the composite score's weights to them and writes `src/score/weights.json`; the unit tests fail
if that file is out of date.

## Labels

- `easy`: understood on first read.
- `ok`: needs a second look or some domain knowledge.
- `hard`: needs rereading, outside context, or the code itself.

Labels were drafted by Claude and reviewed by a maintainer. Correct any you disagree with, then run
`pnpm calibrate` and update the snapshot (`pnpm test -u`).

## Sources

25 comments from each repository, at the commit in each entry: 15 under 20 words, 10 of 20 to 150.
Test, mock and generated files, and comments with TODO, FIXME or tool directives, were skipped.

| Repository                                                  | Language   | License          |
| ----------------------------------------------------------- | ---------- | ---------------- |
| [microsoft/vscode](https://github.com/microsoft/vscode)     | TypeScript | MIT              |
| [psf/requests](https://github.com/psf/requests)             | Python     | Apache-2.0       |
| [golang/go](https://github.com/golang/go)                   | Go         | BSD-3-Clause     |
| [BurntSushi/ripgrep](https://github.com/BurntSushi/ripgrep) | Rust       | MIT or Unlicense |
| [google/guava](https://github.com/google/guava)             | Java       | Apache-2.0       |
| [Expensify/App](https://github.com/Expensify/App)           | TypeScript | MIT              |

Each comment remains under its repository's license and copyright.
