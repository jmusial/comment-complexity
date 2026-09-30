import { describe, expect, it } from "vitest";
import { redundancy } from "../../metrics/redundancy";

describe("redundancy", () => {
  it.each<[text: string, symbol: string | undefined, redundant: boolean, overlap: number]>([
    // Restating the name, word for word or nearly.
    ["Gets the user", "getUser", true, 1],
    ["Returns the user.", "getUser", true, 1],
    ["Gets the user with the given id.", "getUserById", true, 1],
    ["Sets the timeout.", "setTimeout", true, 1],
    ["Creates a new session.", "createSession", true, 1],
    ["Loads all users.", "loadUsers", true, 1],
    ["Maximum number of retries.", "MAX_RETRIES", true, 1],
    ["Parse the config file.", "parse_config_file", true, 1],
    ["Parsed the configuration.", "parseConfig", true, 1],
    ["Processes the batches.", "processBatches", true, 1],
    // "status" is not a plural of "statu".
    ["Returns the status.", "getStatus", true, 1],
    // Descriptive: most of the words add something the name does not say.
    [
      "Gets the user from the cache, falling back to the database on a miss.",
      "getUser",
      false,
      0.29,
    ],
    ["Is the connection open?", "isOpen", false, 0.5],
    ["The user's unique id.", "id", false, 0.33],
    ["Retries with exponential backoff.", "fetchWithRetry", false, 0.33],
    // Nothing to compare.
    ["", "getUser", false, 0],
    ["The.", "getUser", false, 0],
    ["Gets the user", undefined, false, 0],
  ])("%j above %s → %s", (text, symbol, redundant, overlap) => {
    expect(redundancy(text, symbol)).toMatchObject({ redundant, overlap });
  });

  it("names the symbol in the reason", () => {
    expect(redundancy("Gets the user", "getUser")).toEqual({
      redundant: true,
      overlap: 1,
      reason: 'Restates the name "getUser"',
    });
  });

  it("gives no reason for a descriptive comment", () => {
    expect(
      redundancy("Retries with exponential backoff.", "fetchWithRetry").reason,
    ).toBeUndefined();
  });
});
