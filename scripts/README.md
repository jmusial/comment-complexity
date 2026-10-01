# Scripts

| Command               | What it does                                                            |
| --------------------- | ----------------------------------------------------------------------- |
| `node build-zipf.mjs` | Regenerates `data/zipf-en.json` from wordfreq (see `data/README.md`)    |
| `pnpm calibrate`      | Fits the composite weights to `data/calibration/` (see its README)      |
| `pnpm smoke <folder>` | Scores every supported file under a folder, the way the extension would |

## Smoke runs

`pnpm smoke` finds crashes, slow files and odd scores on real code. It builds the workspace
vocabulary from the folder, then opens and scores each file, and prints:

- vocabulary size and build time (the wait before the first lens in a new window);
- files and comments scored, with the share labeled easy, ok and hard;
- failures, per language counts, the slowest files and the highest-scoring comments.

It is not run in CI: cloning large repositories is slow and their contents change. Compare runs
on the same tags:

| Repository                                                      | Tag                   | Why                                                           |
| --------------------------------------------------------------- | --------------------- | ------------------------------------------------------------- |
| [microsoft/vscode](https://github.com/microsoft/vscode)         | `1.140.0`             | Large TypeScript codebase, past the 5,000-file vocabulary cap |
| [apache/arrow](https://github.com/apache/arrow)                 | `apache-arrow-25.0.1` | C, C++, Python and Ruby (other languages moved out, see #51)  |
| [microsoft/TypeScript](https://github.com/microsoft/TypeScript) | `v7.0.2`              | Thousands of odd and invalid test files                       |

```bash
git clone --depth 1 --branch 1.140.0 https://github.com/microsoft/vscode /tmp/vscode
pnpm smoke /tmp/vscode
```

Until #44 is fixed, `tests/cases/fourslash/reallyLargeFile.ts` in TypeScript hangs the run; move
it aside first.

vscode stores some files with Git LFS; without `git-lfs` installed, clone with
`GIT_LFS_SKIP_SMUDGE=1` so the checkout does not stop halfway.
