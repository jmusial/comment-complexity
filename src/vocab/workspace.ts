import type { Parser } from "@vscode/tree-sitter-wasm";
import type { GrammarLoader } from "../extract/treeSitter";
import {
  LANGUAGE_BY_EXTENSION,
  MAX_WORDS,
  Vocabulary,
  identifierWords,
  languageForPath,
} from "./vocabulary";

/** What the vocabulary needs of a file URI; `vscode.Uri` fits. */
export interface FileUri {
  readonly path: string;
  toString(): string;
}

export interface Disposable {
  dispose(): void;
}

/** Structural subset of `vscode.TextDocument`. */
export interface SavedDocument<U extends FileUri> {
  readonly uri: U;
  getText(): string;
}

/** Structural subset of `vscode.FileRenameEvent`; entries may be files or folders. */
export interface RenameEvent<U extends FileUri> {
  readonly files: readonly { readonly oldUri: U; readonly newUri: U }[];
}

/**
 * The parts of the VS Code workspace API the vocabulary uses, so tests can pass fakes and this
 * module stays free of a runtime `vscode` import.
 */
export interface WorkspaceHost<U extends FileUri> {
  findFiles(include: string, exclude: string, maxResults: number): PromiseLike<readonly U[]>;
  readFile(uri: U): PromiseLike<Uint8Array>;
  /** Path relative to its workspace folder, or `undefined` outside the workspace. */
  relativePath(uri: U): string | undefined;
  onDidSaveTextDocument(listener: (document: SavedDocument<U>) => void): Disposable;
  /** Entries may be files or folders. */
  onDidDeleteFiles(listener: (event: { readonly files: readonly U[] }) => void): Disposable;
  onDidRenameFiles(listener: (event: RenameEvent<U>) => void): Disposable;
}

export interface Limits {
  /** Most files read. */
  readonly maxFiles: number;
  /** Larger files are skipped: usually generated or minified, and slow to parse. */
  readonly maxFileBytes: number;
  /** Most words kept (see `Vocabulary`). */
  readonly maxWords: number;
}

export const DEFAULT_LIMITS: Limits = {
  maxFiles: 5_000,
  maxFileBytes: 1_000_000,
  maxWords: MAX_WORDS,
};

/** Dependencies and build output are not the project's own words. */
const EXCLUDED_FOLDERS = new Set([
  "node_modules",
  "bower_components",
  "vendor",
  "dist",
  "out",
  "build",
  "target",
  "coverage",
  ".git",
  ".venv",
  "venv",
  "__pycache__",
]);

const SOURCE_FILES = `*.{${[...LANGUAGE_BY_EXTENSION.keys()].join(",")}}`;

export const INCLUDE = `**/${SOURCE_FILES}`;
export const EXCLUDE = `**/{${[...EXCLUDED_FOLDERS].join(",")}}/**`;

/** `INCLUDE` limited to one workspace-relative folder, its glob characters escaped. */
export function includeUnder(relativeFolder: string): string {
  const escaped = relativeFolder.replace(/[[\]{}*?]/g, "[$&]");
  return `${escaped}/**/${SOURCE_FILES}`;
}

/** The same rules as `INCLUDE` and `EXCLUDE`, for a path relative to the workspace folder. */
export function isScanned(relativePath: string): boolean {
  const folders = relativePath.split("/").slice(0, -1);
  return (
    languageForPath(relativePath) !== undefined &&
    !folders.some((folder) => EXCLUDED_FOLDERS.has(folder))
  );
}

/** Whether `key` is `root` itself or lies under it, on a path boundary (`a/b` is not under `a/bc`). */
const isWithin = (key: string, root: string): boolean => key === root || key.startsWith(`${root}/`);

/**
 * The workspace's identifier vocabulary. Built on first use from the workspace's source files,
 * then kept in memory and updated as files are saved, renamed or deleted, by the same rules.
 */
export class WorkspaceVocabulary<U extends FileUri> implements Disposable {
  private readonly vocabulary: Vocabulary;
  /** Files in the vocabulary: URI string to workspace-relative path. */
  private readonly tracked = new Map<string, string>();
  /**
   * Bumped by every read and invalidation of a file. A read records its words only if its
   * generation is still current, so a file deleted or re-saved meanwhile is not resurrected.
   */
  private readonly generations = new Map<string, number>();
  private readonly parsers = new Map<string, Promise<Parser | undefined>>();
  private readonly listeners: Disposable[];
  private building: Promise<void> | undefined;
  private built = false;
  /** What `current` gives until the build is done: nothing, or a vocabulary restored from before. */
  private initial: ReadonlySet<string> = new Set();
  private readonly buildListeners = new Set<(words: ReadonlySet<string>) => void>();

  constructor(
    private readonly host: WorkspaceHost<U>,
    private readonly loader: Pick<GrammarLoader, "createParser">,
    private readonly onError: (uri: string, error: unknown) => void,
    private readonly limits: Limits = DEFAULT_LIMITS,
  ) {
    this.vocabulary = new Vocabulary(limits.maxWords);
    this.listeners = [
      host.onDidSaveTextDocument((document) => {
        // Before the first build there is nothing to update; the build reads the saved file.
        if (this.building !== undefined) {
          this.update(document.uri, () => new TextEncoder().encode(document.getText())).catch(
            (error: unknown) => this.onError(document.uri.toString(), error),
          );
        }
      }),
      host.onDidDeleteFiles((event) => {
        for (const uri of event.files) {
          this.forgetWithin(uri.toString());
        }
      }),
      host.onDidRenameFiles((event) => {
        for (const { oldUri, newUri } of event.files) {
          this.move(oldUri, newUri);
        }
      }),
    ];
  }

  /** Lower-cased identifier words. The first call builds the vocabulary; later ones share it. */
  async words(): Promise<ReadonlySet<string>> {
    this.building ??= this.startBuild();
    await this.building;
    return this.vocabulary.words();
  }

  /**
   * The words available now, without waiting: the built vocabulary, or until it is built the one
   * from `restore` (empty by default). Starts the build in the background; `onDidBuild` tells when
   * it is done. The set stays the same object until the build ends, so results cached against it
   * stay valid while files are read.
   */
  current(): ReadonlySet<string> {
    if (this.building === undefined) {
      this.building = this.startBuild();
      this.building.catch((error: unknown) => this.onError("workspace", error));
    }
    return this.built ? this.vocabulary.words() : this.initial;
  }

  /** Words to use until the first build is done, such as the vocabulary saved last session. */
  restore(words: Iterable<string>): void {
    this.initial = new Set(words);
  }

  /** Calls `listener` with the words each time a build finishes. */
  onDidBuild(listener: (words: ReadonlySet<string>) => void): Disposable {
    this.buildListeners.add(listener);
    return { dispose: () => this.buildListeners.delete(listener) };
  }

  dispose(): void {
    for (const listener of this.listeners) {
      listener.dispose();
    }
    for (const parser of this.parsers.values()) {
      void parser.then((p) => p?.delete());
    }
    this.parsers.clear();
  }

  /** Builds the vocabulary; a failed build is forgotten, so the next request tries again. */
  private async startBuild(): Promise<void> {
    try {
      await this.scan(INCLUDE);
    } catch (error) {
      this.building = undefined;
      throw error;
    }
    this.built = true;
    const words = this.vocabulary.words();
    for (const listener of this.buildListeners) {
      listener(words);
    }
  }

  /** Reads every file `include` finds; `update` applies the scan rules and the file limit. */
  private async scan(include: string): Promise<void> {
    const uris = await this.host.findFiles(include, EXCLUDE, this.limits.maxFiles);
    for (const uri of uris) {
      try {
        await this.update(uri, () => this.host.readFile(uri));
      } catch (error) {
        this.onError(uri.toString(), error);
      }
    }
  }

  /**
   * Records a file's identifiers if it passes the scan rules; a tracked file that no longer passes
   * them is dropped. `content` is read only for files that pass.
   */
  private async update(uri: U, content: () => PromiseLike<Uint8Array> | Uint8Array): Promise<void> {
    const key = uri.toString();
    const generation = this.invalidate(key);
    const relative = this.host.relativePath(uri);
    const languageId = relative === undefined ? undefined : languageForPath(relative);
    if (relative === undefined || languageId === undefined || !isScanned(relative)) {
      this.drop(key);
      return;
    }
    if (!this.tracked.has(key) && this.tracked.size >= this.limits.maxFiles) {
      return;
    }
    const stale = () => this.generations.get(key) !== generation;
    const bytes = await content();
    if (stale()) {
      return;
    }
    if (bytes.byteLength > this.limits.maxFileBytes) {
      this.drop(key);
      return;
    }
    const parser = await this.parserFor(languageId);
    if (stale()) {
      return;
    }
    const tree = parser?.parse(new TextDecoder().decode(bytes));
    if (!tree) {
      return;
    }
    try {
      this.vocabulary.set(key, identifierWords(tree));
      this.tracked.set(key, relative);
    } finally {
      tree.delete();
    }
  }

  /** Moves the words of a renamed file, or of every file in a renamed folder, then re-checks them. */
  private move(oldUri: U, newUri: U): void {
    const oldKey = oldUri.toString();
    const newKey = newUri.toString();
    const oldRelative = this.host.relativePath(oldUri);
    const newRelative = this.host.relativePath(newUri);
    const moved = [...this.tracked].filter(([key]) => isWithin(key, oldKey));
    this.forgetWithin(oldKey, false);
    for (const [key, relative] of moved) {
      const target = newKey + key.slice(oldKey.length);
      this.invalidate(target);
      // The part below the renamed item keeps its place: "billing/a.ts" under "accounts".
      const targetRelative =
        newRelative === undefined || oldRelative === undefined
          ? undefined
          : newRelative + relative.slice(oldRelative.length);
      if (targetRelative !== undefined && isScanned(targetRelative)) {
        this.vocabulary.rename(key, target);
        this.tracked.set(target, targetRelative);
      } else {
        this.vocabulary.remove(key);
      }
    }
    // Untracked items may now qualify: a file like notes.txt renamed to notes.ts, or a folder like
    // vendor/ renamed to lib/, whose files are then found and read.
    if (moved.length === 0 && this.building !== undefined && newRelative !== undefined) {
      const read =
        languageForPath(newRelative) === undefined
          ? this.scan(includeUnder(newRelative))
          : this.update(newUri, () => this.host.readFile(newUri));
      read.catch((error: unknown) => this.onError(newKey, error));
    }
  }

  /**
   * Stops tracking `root` and everything under it, and invalidates reads in flight there.
   * `removeWords` is false when the caller moves the words instead.
   */
  private forgetWithin(root: string, removeWords = true): void {
    const keys = new Set([...this.tracked.keys(), ...this.generations.keys()]);
    for (const key of keys) {
      if (isWithin(key, root)) {
        this.invalidate(key);
        this.tracked.delete(key);
        if (removeWords) {
          this.vocabulary.remove(key);
        }
      }
    }
  }

  private drop(key: string): void {
    this.tracked.delete(key);
    this.vocabulary.remove(key);
  }

  /** Starts a new generation for `key`, making reads in flight stale. */
  private invalidate(key: string): number {
    const generation = (this.generations.get(key) ?? 0) + 1;
    this.generations.set(key, generation);
    return generation;
  }

  /** One parser per language, reused across files; a failed load is retried next time. */
  private parserFor(languageId: string): Promise<Parser | undefined> {
    let parser = this.parsers.get(languageId);
    if (parser === undefined) {
      parser = this.loader.createParser(languageId).catch((error: unknown) => {
        this.parsers.delete(languageId);
        throw error;
      });
      this.parsers.set(languageId, parser);
    }
    return parser;
  }
}
