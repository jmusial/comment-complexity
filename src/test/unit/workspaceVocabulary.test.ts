import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GrammarLoader } from "../../extract/treeSitter";
import {
  DEFAULT_LIMITS,
  EXCLUDE,
  type FileUri,
  INCLUDE,
  type Limits,
  type RenameEvent,
  type SavedDocument,
  type WorkspaceHost,
  WorkspaceVocabulary,
  includeUnder,
  isScanned,
} from "../../vocab/workspace";

const wasmDir = path.resolve("node_modules/@vscode/tree-sitter-wasm/wasm");

const uri = (filePath: string): FileUri => ({
  path: filePath,
  toString: () => `file://${filePath}`,
});

/** In-memory stand-in for `vscode.workspace`, rooted at /ws; anything else is outside it. */
class FakeWorkspace implements WorkspaceHost<FileUri> {
  /** Path to contents; `undefined` contents fail to read. */
  readonly files = new Map<string, string | undefined>();
  /** Reads of these paths wait until the promise settles. */
  readonly gates = new Map<string, Promise<void>>();
  readonly reads: string[] = [];
  /** Lists every file for a workspace-wide include, or the files under a folder-scoped one. */
  readonly findFiles = vi.fn<WorkspaceHost<FileUri>["findFiles"]>(
    async (include, _exclude, maxResults) => {
      const folder = include.startsWith("**/") ? "" : include.slice(0, include.indexOf("/**/"));
      return [...this.files.keys()]
        .filter((file) => folder === "" || file.startsWith(`/ws/${folder}/`))
        .slice(0, maxResults)
        .map(uri);
    },
  );
  private readonly saveListeners = new Set<(document: SavedDocument<FileUri>) => void>();
  private readonly deleteListeners = new Set<(event: { files: readonly FileUri[] }) => void>();
  private readonly renameListeners = new Set<(event: RenameEvent<FileUri>) => void>();

  get listeners(): number {
    return this.saveListeners.size + this.deleteListeners.size + this.renameListeners.size;
  }

  async readFile(file: FileUri): Promise<Uint8Array> {
    // The bytes are taken first, as a real read would have them before a delete lands.
    const text = this.files.get(file.path);
    this.reads.push(file.path);
    await this.gates.get(file.path);
    if (text === undefined) {
      throw new Error(`Cannot read ${file.path}`);
    }
    return new TextEncoder().encode(text);
  }

  relativePath(file: FileUri): string | undefined {
    return file.path.startsWith("/ws/") ? file.path.slice("/ws/".length) : undefined;
  }

  onDidSaveTextDocument(listener: (document: SavedDocument<FileUri>) => void) {
    this.saveListeners.add(listener);
    return { dispose: () => this.saveListeners.delete(listener) };
  }

  onDidDeleteFiles(listener: (event: { files: readonly FileUri[] }) => void) {
    this.deleteListeners.add(listener);
    return { dispose: () => this.deleteListeners.delete(listener) };
  }

  onDidRenameFiles(listener: (event: RenameEvent<FileUri>) => void) {
    this.renameListeners.add(listener);
    return { dispose: () => this.renameListeners.delete(listener) };
  }

  save(filePath: string, text: string): void {
    this.files.set(filePath, text);
    for (const listener of this.saveListeners) {
      listener({ uri: uri(filePath), getText: () => text });
    }
  }

  /** Deletes a file, or a folder with everything under it, reporting only the given path. */
  delete(filePath: string): void {
    // Deleting the current entry while iterating a Map is safe.
    for (const file of this.files.keys()) {
      if (file === filePath || file.startsWith(`${filePath}/`)) {
        this.files.delete(file);
      }
    }
    for (const listener of this.deleteListeners) {
      listener({ files: [uri(filePath)] });
    }
  }

  /** Renames a file or folder, reporting only the given paths. */
  rename(from: string, to: string): void {
    // Collected first: adding keys while iterating would visit the moved files again.
    const moved = [...this.files].filter(([file]) => file === from || file.startsWith(`${from}/`));
    for (const [file, text] of moved) {
      this.files.delete(file);
      this.files.set(to + file.slice(from.length), text);
    }
    for (const listener of this.renameListeners) {
      listener({ files: [{ oldUri: uri(from), newUri: uri(to) }] });
    }
  }
}

function setup(limits: Limits = DEFAULT_LIMITS) {
  const workspace = new FakeWorkspace();
  const loader = new GrammarLoader(wasmDir, wasmDir);
  const errors: [string, unknown][] = [];
  const vocabulary = new WorkspaceVocabulary(
    workspace,
    loader,
    (file, error) => errors.push([file, error]),
    limits,
  );
  return { workspace, loader, errors, vocabulary };
}

const sorted = async (vocabulary: WorkspaceVocabulary<FileUri>) =>
  [...(await vocabulary.words())].toSorted();

afterEach(() => {
  vi.restoreAllMocks();
});

describe("isScanned", () => {
  it.each([
    ["src/ledger.ts", true],
    ["vendor/lib.ts", false],
    ["packages/app/node_modules/x/index.js", false],
    // Only folders are excluded; a file may be called anything.
    ["src/build.ts", true],
    ["README.md", false],
  ])("%s → %s", (relative, scanned) => {
    expect(isScanned(relative)).toBe(scanned);
  });
});

describe("includeUnder", () => {
  it("scopes the include to a folder", () => {
    expect(includeUnder("src/billing")).toBe(INCLUDE.replace("**/", "src/billing/**/"));
  });

  it("escapes glob characters in the folder name", () => {
    expect(includeUnder("odd[1]{x}?*")).toMatch(
      /^odd\[\[\]1\[\]\]\[\{\]x\[\}\]\[\?\]\[\*\]\/\*\*\//,
    );
  });
});

describe("WorkspaceVocabulary", () => {
  it("builds from files that pass the scan rules", async () => {
    const { workspace, vocabulary } = setup({ ...DEFAULT_LIMITS, maxFiles: 10, maxFileBytes: 100 });
    workspace.files.set("/ws/src/ledger.ts", "const ledgerEntry = 1;");
    workspace.files.set("/ws/lib/store.rb", "class Store\nend\n");
    workspace.files.set("/ws/notes.md", "# Heading words");
    workspace.files.set("/ws/vendor/lib.ts", "const zanzibarHelper = 1;");
    workspace.files.set("/outside/other.ts", "const outsideWord = 1;");
    workspace.files.set("/ws/gen/bundle.ts", `const hugeValue = 1;${" ".repeat(200)}`);

    expect(await sorted(vocabulary)).toEqual(["entry", "ledger", "store"]);
    expect(workspace.findFiles).toHaveBeenCalledWith(INCLUDE, EXCLUDE, 10);
    vocabulary.dispose();
  });

  it("builds once, lazily, and caches the result", async () => {
    const { workspace, vocabulary } = setup();
    workspace.files.set("/ws/a.ts", "const invoiceTotal = 0;");
    expect(workspace.findFiles).not.toHaveBeenCalled();

    const [first, second] = await Promise.all([vocabulary.words(), vocabulary.words()]);
    expect(first).toBe(second);
    expect(await vocabulary.words()).toBe(first);
    expect(workspace.findFiles).toHaveBeenCalledTimes(1);
    expect(workspace.findFiles).toHaveBeenCalledWith(INCLUDE, EXCLUDE, DEFAULT_LIMITS.maxFiles);
    vocabulary.dispose();
  });

  describe("on save", () => {
    it("waits for the first build, then applies the scan rules", async () => {
      const { workspace, vocabulary } = setup();
      // Saved before the first build: the build reads it from disk instead.
      workspace.save("/ws/early.ts", "const earlyBird = 1;");
      expect(workspace.findFiles).not.toHaveBeenCalled();
      expect(await sorted(vocabulary)).toEqual(["bird", "early"]);

      workspace.save("/ws/vendor/lib.ts", "const zanzibarHelper = 1;");
      workspace.save("/outside/other.ts", "const outsideWord = 1;");
      workspace.save("/ws/late.ts", "const lateBloomer = 1;");
      await vi.waitFor(async () => expect((await vocabulary.words()).has("bloomer")).toBe(true));
      expect(await sorted(vocabulary)).toEqual(["bird", "bloomer", "early", "late"]);
      vocabulary.dispose();
    });

    it("drops a file that grows past the size limit", async () => {
      const { workspace, vocabulary } = setup({ ...DEFAULT_LIMITS, maxFileBytes: 50 });
      workspace.files.set("/ws/a.ts", "const alphaValue = 1;");
      expect(await sorted(vocabulary)).toEqual(["alpha", "value"]);

      workspace.save("/ws/a.ts", `const alphaValue = 1;${" ".repeat(100)}`);
      await vi.waitFor(async () => expect(await sorted(vocabulary)).toEqual([]));
      vocabulary.dispose();
    });

    it("adds no files past the file limit, but keeps updating tracked ones", async () => {
      const { workspace, vocabulary } = setup({ ...DEFAULT_LIMITS, maxFiles: 1 });
      workspace.files.set("/ws/a.ts", "const alphaValue = 1;");
      await vocabulary.words();

      workspace.save("/ws/b.ts", "const betaValue = 1;");
      workspace.save("/ws/a.ts", "const gammaValue = 1;");
      await vi.waitFor(async () => expect(await sorted(vocabulary)).toEqual(["gamma", "value"]));
      vocabulary.dispose();
    });
  });

  describe("on delete", () => {
    it("forgets a file", async () => {
      const { workspace, vocabulary } = setup();
      workspace.files.set("/ws/a.ts", "const alphaValue = 1;");
      await vocabulary.words();

      workspace.delete("/ws/a.ts");
      expect(await sorted(vocabulary)).toEqual([]);
      vocabulary.dispose();
    });

    it("forgets everything in a deleted folder, but not a folder sharing its prefix", async () => {
      const { workspace, vocabulary } = setup();
      workspace.files.set("/ws/billing/ledger.ts", "const ledgerEntry = 1;");
      workspace.files.set("/ws/billing-old/archive.ts", "const archiveItem = 1;");
      await vocabulary.words();

      workspace.delete("/ws/billing");
      expect(await sorted(vocabulary)).toEqual(["archive", "item"]);
      vocabulary.dispose();
    });

    it("does not let a read in flight bring a deleted file back", async () => {
      const { workspace, vocabulary } = setup();
      workspace.files.set("/ws/slow.ts", "const slowPoke = 1;");
      let release!: () => void;
      workspace.gates.set(
        "/ws/slow.ts",
        new Promise<void>((resolve) => {
          release = resolve;
        }),
      );

      const building = vocabulary.words();
      await vi.waitFor(() => expect(workspace.reads).toContain("/ws/slow.ts"));
      // The delete lands while the read is in flight; its result must be thrown away.
      workspace.delete("/ws/slow.ts");
      release();

      expect([...(await building)]).toEqual([]);
      vocabulary.dispose();
    });

    it("discards a read that went stale while its grammar loaded", async () => {
      const { workspace, loader, vocabulary } = setup();
      workspace.files.set("/ws/slow.ts", "const slowPoke = 1;");
      const createParser = loader.createParser.bind(loader);
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const loading = vi.spyOn(loader, "createParser").mockImplementationOnce(async (id) => {
        await gate;
        return createParser(id);
      });

      const building = vocabulary.words();
      await vi.waitFor(() => expect(loading).toHaveBeenCalled());
      workspace.delete("/ws/slow.ts");
      release();

      expect([...(await building)]).toEqual([]);
      vocabulary.dispose();
    });
  });

  describe("on rename", () => {
    it("moves a renamed file's words, without leaving a copy behind", async () => {
      const { workspace, vocabulary } = setup();
      workspace.files.set("/ws/a.ts", "const alphaValue = 1;");
      await vocabulary.words();

      workspace.rename("/ws/a.ts", "/ws/b.ts");
      expect(await sorted(vocabulary)).toEqual(["alpha", "value"]);
      // Deleting the new name removes the words: nothing was left under the old one.
      workspace.delete("/ws/b.ts");
      expect(await sorted(vocabulary)).toEqual([]);
      vocabulary.dispose();
    });

    it("moves every file of a renamed folder", async () => {
      const { workspace, vocabulary } = setup();
      workspace.files.set("/ws/billing/ledger.ts", "const ledgerEntry = 1;");
      workspace.files.set("/ws/billing/tax/rate.ts", "const taxRate = 1;");
      await vocabulary.words();

      workspace.rename("/ws/billing", "/ws/accounts");
      expect(await sorted(vocabulary)).toEqual(["entry", "ledger", "rate", "tax"]);
      workspace.delete("/ws/accounts");
      expect(await sorted(vocabulary)).toEqual([]);
      vocabulary.dispose();
    });

    it("drops files moved where they would not be scanned", async () => {
      const { workspace, vocabulary } = setup();
      workspace.files.set("/ws/src/a.ts", "const alphaValue = 1;");
      workspace.files.set("/ws/b.ts", "const betaValue = 1;");
      await vocabulary.words();

      workspace.rename("/ws/src", "/ws/vendor/src");
      workspace.rename("/ws/b.ts", "/outside/b.ts");
      expect(await sorted(vocabulary)).toEqual([]);
      vocabulary.dispose();
    });

    it("reads an untracked file renamed into scope", async () => {
      const { workspace, vocabulary } = setup();
      workspace.files.set("/ws/notes.txt", "const noteTitle = 1;");
      expect(await sorted(vocabulary)).toEqual([]);

      workspace.rename("/ws/notes.txt", "/ws/notes.ts");
      await vi.waitFor(async () => expect(await sorted(vocabulary)).toEqual(["note", "title"]));
      vocabulary.dispose();
    });

    it("scans an untracked folder renamed into scope", async () => {
      const { workspace, vocabulary } = setup();
      workspace.files.set("/ws/vendor/lib.ts", "const zanzibarHelper = 1;");
      workspace.files.set("/ws/vendor/deep/util.ts", "const quokkaUtil = 1;");
      expect(await sorted(vocabulary)).toEqual([]);

      workspace.rename("/ws/vendor", "/ws/lib");
      await vi.waitFor(async () =>
        expect(await sorted(vocabulary)).toEqual(["helper", "quokka", "util", "zanzibar"]),
      );
      expect(workspace.findFiles).toHaveBeenLastCalledWith(
        includeUnder("lib"),
        EXCLUDE,
        DEFAULT_LIMITS.maxFiles,
      );
      vocabulary.dispose();
    });

    it("respects the file limit when scanning a renamed folder", async () => {
      const { workspace, vocabulary } = setup({ ...DEFAULT_LIMITS, maxFiles: 2 });
      workspace.files.set("/ws/a.ts", "const alphaValue = 1;");
      workspace.files.set("/ws/vendor/b.ts", "const betaValue = 1;");
      workspace.files.set("/ws/vendor/c.ts", "const gammaValue = 1;");
      await vocabulary.words();

      workspace.rename("/ws/vendor", "/ws/lib");
      // One slot was left: only one of the two files gets in.
      await vi.waitFor(async () => expect((await vocabulary.words()).size).toBe(3));
      vocabulary.dispose();
    });

    it("waits for the first build before reading renamed files", async () => {
      const { workspace, vocabulary } = setup();
      workspace.files.set("/ws/notes.txt", "const noteTitle = 1;");
      workspace.rename("/ws/notes.txt", "/ws/notes.ts");
      expect(workspace.reads).toEqual([]);
      expect(await sorted(vocabulary)).toEqual(["note", "title"]);
      vocabulary.dispose();
    });
  });

  it("reports unreadable files and failed grammars, and keeps going", async () => {
    const { workspace, loader, errors, vocabulary } = setup();
    workspace.files.set("/ws/broken.ts", undefined);
    workspace.files.set("/ws/store.rb", "class Store\nend\n");
    workspace.files.set("/ws/ok.ts", "const okValue = 1;");
    const createParser = vi.spyOn(loader, "createParser");
    createParser.mockRejectedValueOnce(new Error("no ruby"));

    expect((await vocabulary.words()).has("ok")).toBe(true);
    expect(errors.map(([file]) => file)).toEqual(["file:///ws/broken.ts", "file:///ws/store.rb"]);

    // The failed grammar is retried on the next Ruby file.
    workspace.save("/ws/store.rb", "class Store\nend\n");
    await vi.waitFor(async () => expect((await vocabulary.words()).has("store")).toBe(true));

    // A save that fails is reported too, and so is a rename that cannot be read.
    createParser.mockRejectedValueOnce(new Error("no go"));
    workspace.save("/ws/main.go", "package main\n");
    await vi.waitFor(() => expect(errors.at(-1)?.[0]).toBe("file:///ws/main.go"));
    workspace.files.set("/ws/gone.txt", undefined);
    workspace.rename("/ws/gone.txt", "/ws/gone.ts");
    await vi.waitFor(() => expect(errors.at(-1)?.[0]).toBe("file:///ws/gone.ts"));
    vocabulary.dispose();
  });

  it("skips a language whose grammar yields no parser, and stops listening when disposed", async () => {
    const { workspace, loader, vocabulary } = setup();
    vi.spyOn(loader, "createParser").mockResolvedValueOnce(undefined);
    workspace.files.set("/ws/a.py", "alpha_value = 1\n");
    workspace.files.set("/ws/b.ts", "const betaValue = 1;");
    expect(await sorted(vocabulary)).toEqual(["beta", "value"]);
    expect(workspace.listeners).toBe(3);

    vocabulary.dispose();
    expect(workspace.listeners).toBe(0);
    workspace.save("/ws/c.ts", "const gammaValue = 1;");
    expect((await vocabulary.words()).has("gamma")).toBe(false);
  });
});
