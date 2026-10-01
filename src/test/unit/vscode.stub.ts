import { vi } from "vitest";

/**
 * The slice of the `vscode` API that `extension.ts` uses, for unit tests. vitest aliases the
 * `vscode` module to this file; tests import it to fire events and inspect calls.
 */

function emitter<T>() {
  const listeners = new Set<(value: T) => void>();
  return {
    event: (listener: (value: T) => void) => {
      listeners.add(listener);
      return { dispose: () => listeners.delete(listener) };
    },
    fire: (value: T) => {
      for (const listener of listeners) {
        listener(value);
      }
    },
    get listeners() {
      return listeners.size;
    },
  };
}

export const events = {
  open: emitter<unknown>(),
  change: emitter<unknown>(),
  close: emitter<unknown>(),
  save: emitter<unknown>(),
  delete: emitter<unknown>(),
  rename: emitter<unknown>(),
  configuration: emitter<{ affectsConfiguration(section: string): boolean }>(),
};

/** `commentComplexity.*` values, by key; tests set them, then fire `events.configuration`. */
export const configuration: Record<string, unknown> = {};

export const log = {
  info: vi.fn<(message: string) => void>(),
  error: vi.fn<(message: string, error: unknown) => void>(),
  dispose: vi.fn<() => void>(),
};

export const window = {
  createOutputChannel: vi.fn<() => typeof log>(() => log),
  /** Set by tests; `undefined` when no editor is open. */
  activeTextEditor: undefined as unknown,
  showInformationMessage: vi.fn<(message: string) => Promise<undefined>>(async () => undefined),
  showQuickPick: vi.fn<(items: readonly unknown[], options: object) => Promise<unknown>>(
    async () => undefined,
  ),
  showTextDocument: vi.fn<(document: unknown, options: object) => Promise<unknown>>(
    async () => undefined,
  ),
};

/** Registered command handlers, by id. */
export const registeredCommands = new Map<string, (...args: unknown[]) => unknown>();

export const commands = {
  registerCommand: (id: string, handler: (...args: unknown[]) => unknown) => {
    registeredCommands.set(id, handler);
    return { dispose: () => registeredCommands.delete(id) };
  },
};

interface StubUri {
  readonly path: string;
}

export const Uri = {
  joinPath: (base: { fsPath: string }, ...segments: string[]) => ({
    fsPath: [base.fsPath, ...segments].join("/"),
  }),
};

export class EventEmitter<T> {
  private readonly emitter = emitter<T>();
  readonly event = this.emitter.event;
  fire(value: T): void {
    this.emitter.fire(value);
  }
  dispose(): void {}
}

export class Position {
  constructor(
    readonly line: number,
    readonly character: number,
  ) {}
}

export class Range {
  readonly start: Position;
  readonly end: Position;
  constructor(start: Position, end: Position);
  constructor(startLine: number, startCharacter: number, endLine: number, endCharacter: number);
  constructor(...args: [Position, Position] | [number, number, number, number]) {
    if (args.length === 2) {
      [this.start, this.end] = args;
    } else {
      this.start = new Position(args[0], args[1]);
      this.end = new Position(args[2], args[3]);
    }
  }
  contains({ line, character }: Position): boolean {
    const after =
      line > this.start.line || (line === this.start.line && character >= this.start.character);
    const before =
      line < this.end.line || (line === this.end.line && character <= this.end.character);
    return after && before;
  }
}

export class CodeLens {
  constructor(
    readonly range: Range,
    readonly command: { title: string },
  ) {}
}

export class MarkdownString {
  constructor(readonly value: string) {}
}

export class Hover {
  constructor(
    readonly contents: MarkdownString,
    readonly range: Range,
  ) {}
}

/** Registered providers, by kind. */
type Selector = readonly { language: string }[];
const registered = () => ({ dispose: () => {} });
export enum DiagnosticSeverity {
  Error = 0,
  Warning = 1,
  Information = 2,
  Hint = 3,
}

export class Diagnostic {
  source?: string;
  constructor(
    readonly range: Range,
    readonly message: string,
    readonly severity: DiagnosticSeverity,
  ) {}
}

/** Diagnostics by URI string, as the collection last set them. */
export const diagnostics = new Map<string, readonly Diagnostic[]>();

export const languages = {
  createDiagnosticCollection: () => ({
    set: (uri: { toString(): string }, items: readonly Diagnostic[]) =>
      diagnostics.set(uri.toString(), items),
    delete: (uri: { toString(): string }) => diagnostics.delete(uri.toString()),
    dispose: () => diagnostics.clear(),
  }),
  registerCodeLensProvider:
    vi.fn<(selector: Selector, provider: unknown) => { dispose(): void }>(registered),
  registerHoverProvider:
    vi.fn<(selector: Selector, provider: unknown) => { dispose(): void }>(registered),
};

export const workspace = {
  textDocuments: [] as unknown[],
  onDidOpenTextDocument: events.open.event,
  onDidChangeTextDocument: events.change.event,
  onDidCloseTextDocument: events.close.event,
  onDidSaveTextDocument: events.save.event,
  onDidDeleteFiles: events.delete.event,
  onDidRenameFiles: events.rename.event,
  onDidChangeConfiguration: events.configuration.event,
  getConfiguration: (section: string) => ({
    get: (key: string): unknown => configuration[`${section}.${key}`],
  }),
  findFiles: vi.fn<(include: string, exclude: string, maxResults: number) => Promise<StubUri[]>>(
    async () => [],
  ),
  fs: {
    readFile: vi.fn<(uri: StubUri) => Promise<Uint8Array>>(async () => new Uint8Array()),
  },
  getWorkspaceFolder: vi.fn<(uri: StubUri) => object | undefined>(() => undefined),
  asRelativePath: vi.fn<(uri: StubUri, includeWorkspaceFolder: boolean) => string>((uri) =>
    uri.path.replace(/^\/ws\//, ""),
  ),
};
