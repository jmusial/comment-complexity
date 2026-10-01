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
};

export const log = {
  info: vi.fn<(message: string) => void>(),
  error: vi.fn<(message: string, error: unknown) => void>(),
  dispose: vi.fn<() => void>(),
};

export const window = { createOutputChannel: vi.fn<() => typeof log>(() => log) };

interface StubUri {
  readonly path: string;
}

export const Uri = {
  joinPath: (base: { fsPath: string }, ...segments: string[]) => ({
    fsPath: [base.fsPath, ...segments].join("/"),
  }),
};

export const workspace = {
  textDocuments: [] as unknown[],
  onDidOpenTextDocument: events.open.event,
  onDidChangeTextDocument: events.change.event,
  onDidCloseTextDocument: events.close.event,
  onDidSaveTextDocument: events.save.event,
  onDidDeleteFiles: events.delete.event,
  onDidRenameFiles: events.rename.event,
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
