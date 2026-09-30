import type { Dialect } from "../../normalize/clean";

export interface Fixture {
  readonly raw: string;
  readonly text: string;
  readonly identifiers: readonly string[];
}

/** Doc comments as they appear in real code, per dialect, with the prose each should become. */
export const FIXTURES: Record<Dialect, readonly Fixture[]> = {
  jsdoc: [
    {
      raw: [
        "/**",
        " * Returns the user with the given id, or `null` if none exists.",
        " *",
        " * @param {string} id - The user's unique id.",
        " * @returns {Promise<User | null>} The user, if found.",
        " */",
      ].join("\n"),
      text: [
        "Returns the user with the given id, or null if none exists.",
        "The user's unique id.",
        "The user, if found.",
      ].join("\n"),
      identifiers: ["id", "null"],
    },
    {
      raw: [
        "/**",
        " * Parses the header block.",
        " * <p>",
        " * Uses {@link HeaderParser} internally; see {@link #reset()} for reuse.",
        " *",
        " * @param input the raw bytes",
        " * @return the parsed {@code Header}",
        " * @throws IOException if the stream ends early",
        " * @since 2.1",
        " */",
      ].join("\n"),
      text: [
        "Parses the header block.",
        "Uses header parser internally; see reset for reuse.",
        "the raw bytes",
        "the parsed header",
        "if the stream ends early",
      ].join("\n"),
      identifiers: ["input", "IOException", "HeaderParser", "reset", "Header"],
    },
    {
      raw: [
        "/**",
        " * Debounces {@link Emitter.emit | emit calls} by `waitMs` milliseconds.",
        " *",
        " * @typeParam T - The event payload type.",
        " * @example",
        " * ```ts",
        " * const d = debounce(fn, 100);",
        " * ```",
        " * @public",
        " */",
      ].join("\n"),
      text: ["Debounces emit calls by wait ms milliseconds.", "The event payload type."].join("\n"),
      identifiers: ["T", "waitMs"],
    },
    {
      raw: [
        "/**",
        " * Caches results of getUserById for MAX_AGE seconds.",
        " * See https://example.com/docs/cache for details.",
        " */",
      ].join("\n"),
      text: "Caches results of get user by id for max age seconds. See for details.",
      identifiers: ["getUserById", "MAX_AGE"],
    },
    {
      raw: [
        "/**",
        " * Adds an item to the cart.",
        " *",
        " * @param string $sku  The product SKU.",
        " * @param int    $qty  How many to add.",
        " * @return void",
        " */",
      ].join("\n"),
      text: ["Adds an item to the cart.", "The product SKU.", "How many to add."].join("\n"),
      identifiers: ["$sku", "$qty"],
    },
    {
      raw: [
        "/**",
        " * Retries [block] up to [times] times with exponential backoff.",
        " *",
        " * @param times how many attempts to make",
        " * @throws IllegalStateException when every attempt fails",
        " */",
      ].join("\n"),
      text: [
        "Retries block up to times times with exponential backoff.",
        "how many attempts to make",
        "when every attempt fails",
      ].join("\n"),
      identifiers: ["times", "IllegalStateException", "block"],
    },
    {
      raw: [
        "/**",
        " * \\brief Computes the CRC-32 of a buffer.",
        " * \\param[in] data Pointer to the bytes.",
        " * \\param[in] len  Number of bytes.",
        " * \\return The checksum.",
        " */",
      ].join("\n"),
      text: [
        "Computes the CRC-32 of a buffer.",
        "Pointer to the bytes.",
        "Number of bytes.",
        "The checksum.",
      ].join("\n"),
      identifiers: ["data", "len"],
    },
  ],
  markdown: [
    {
      raw: [
        "/// Returns the number of elements in the vector.",
        "///",
        "/// # Examples",
        "///",
        "/// ```",
        "/// let v = vec![1, 2, 3];",
        "/// assert_eq!(v.len(), 3);",
        "/// ```",
      ].join("\n"),
      text: "Returns the number of elements in the vector.",
      identifiers: [],
    },
    {
      raw: [
        "/// Converts a [`Path`] into an owned [`PathBuf`].",
        "///",
        "/// See [std::fs::canonicalize] and the [module docs](crate::fs) for details.",
      ].join("\n"),
      text: [
        "Converts a path into an owned path buf.",
        "See std fs canonicalize and the module docs for details.",
      ].join("\n"),
      identifiers: ["Path", "PathBuf", "std::fs::canonicalize"],
    },
    {
      raw: [
        "//! A **fast** JSON parser.",
        "//!",
        "//! Based on <https://www.json.org/json-en.html>; handles *most* inputs.",
      ].join("\n"),
      text: ["A fast JSON parser.", "Based on; handles most inputs."].join("\n"),
      identifiers: [],
    },
    {
      raw: [
        "/// Reads a value without bounds checks.",
        "///",
        "/// # Safety",
        "///",
        "/// - `index` must be less than `self.len()`.",
        "/// - The buffer must be initialized.",
      ].join("\n"),
      text: [
        "Reads a value without bounds checks.",
        "index must be less than self len.",
        "The buffer must be initialized.",
      ].join("\n"),
      identifiers: ["index", "self.len"],
    },
  ],
  python: [
    {
      raw: [
        '"""Fetch rows from the table.',
        "",
        "    Args:",
        "        table_name (str): Name of the table to read.",
        "        limit: Maximum number of rows.",
        "",
        "    Returns:",
        "        list[dict]: The rows, newest first.",
        "",
        "    Raises:",
        "        KeyError: If the table does not exist.",
        '    """',
      ].join("\n"),
      text: [
        "Fetch rows from the table.",
        "Name of the table to read.",
        "Maximum number of rows.",
        "The rows, newest first.",
        "If the table does not exist.",
      ].join("\n"),
      identifiers: ["table_name", "limit", "KeyError"],
    },
    {
      raw: [
        '"""Open a connection to :class:`~db.Pool`.',
        "",
        ":param str dsn: Connection string such as ``postgres://host/db``.",
        ":param timeout: Seconds to wait.",
        ":type timeout: float",
        ":returns: A live :class:`Connection`.",
        ":rtype: Connection",
        ":raises ConnectionError: When the server is unreachable.",
        '"""',
      ].join("\n"),
      text: [
        "Open a connection to pool.",
        "Connection string such as.",
        "Seconds to wait.",
        "A live connection.",
        "When the server is unreachable.",
      ].join("\n"),
      identifiers: ["dsn", "timeout", "ConnectionError", "Pool", "Connection"],
    },
    {
      raw: [
        '"""',
        "    Resample the series to a new frequency.",
        "",
        "    Parameters",
        "    ----------",
        "    rule : str",
        '        Target frequency, like ``"1H"``.',
        "    how, fill : str, optional",
        "        Aggregation and fill methods.",
        "",
        "    Returns",
        "    -------",
        "    Series",
        "        The resampled data.",
        "",
        "    Examples",
        "    --------",
        '    >>> s.resample("1H")',
        '    """',
      ].join("\n"),
      text: [
        "Resample the series to a new frequency.",
        "Target frequency, like.",
        "Aggregation and fill methods.",
        "The resampled data.",
      ].join("\n"),
      identifiers: ["rule", "how", "fill"],
    },
    {
      raw: ["'''Return the square of x.", "", "    >>> square(3)", "    9", "    '''"].join("\n"),
      text: "Return the square of x.",
      identifiers: [],
    },
  ],
  xmldoc: [
    {
      raw: [
        "/// <summary>",
        '/// Gets the <see cref="T:Shop.Order"/> with the given <paramref name="orderId"/>.',
        "/// </summary>",
        '/// <param name="orderId">The order\'s database id.</param>',
        '/// <returns>The order, or <see langword="null"/> when missing.</returns>',
        '/// <exception cref="System.ArgumentException">Thrown when <c>orderId</c> is negative.</exception>',
      ].join("\n"),
      text: [
        "Gets the shop order with the given order id.",
        "The order's database id.",
        "The order, or null when missing.",
        "Thrown when order id is negative.",
      ].join("\n"),
      identifiers: ["Shop.Order", "orderId", "System.ArgumentException"],
    },
    {
      raw: [
        "/// <summary>Formats the total for display.</summary>",
        "/// <remarks>",
        "/// <para>Uses the current culture.</para>",
        "/// <example>",
        "/// <code>var s = FormatTotal(order);</code>",
        "/// </example>",
        "/// </remarks>",
      ].join("\n"),
      text: ["Formats the total for display.", "Uses the current culture."].join("\n"),
      identifiers: [],
    },
    {
      raw: [
        '/// <summary>A cache keyed by <typeparamref name="TKey"/>. See <see href="https://example.com">the guide</see>.</summary>',
        '/// <typeparam name="TKey">The key type.</typeparam>',
      ].join("\n"),
      text: ["A cache keyed by t key. See the guide.", "The key type."].join("\n"),
      identifiers: ["TKey"],
    },
  ],
  godoc: [
    {
      raw: [
        '// ParseDuration parses a duration string such as "300ms" or "2h45m".',
        "// Units are case-sensitive; see [time.Duration] for the range.",
        "//",
        "// Example:",
        "//",
        '//\td, err := ParseDuration("1h15m")',
        "//\tif err != nil {",
        "//\t\tlog.Fatal(err)",
        "//\t}",
      ].join("\n"),
      text: [
        'parse duration parses a duration string such as "300ms" or "2h45m". Units are case-sensitive; see time duration for the range.',
        "Example:",
      ].join("\n"),
      identifiers: ["time.Duration", "ParseDuration"],
    },
    {
      raw: "// Deprecated: Use [NewClient] instead.",
      text: "Deprecated: Use new client instead.",
      identifiers: ["NewClient"],
    },
    {
      raw: [
        "// Options control retries:",
        "//   - MaxRetries caps attempts (see https://go.dev/issue/1234).",
        "//   - Backoff sets the delay.",
      ].join("\n"),
      text: [
        "Options control retries:",
        "max retries caps attempts (see).",
        "Backoff sets the delay.",
      ].join("\n"),
      identifiers: ["MaxRetries"],
    },
  ],
  plain: [
    {
      raw: "// TODO(jan): handle the retryCount overflow case",
      text: "TODO(jan): handle the retry count overflow case",
      identifiers: ["retryCount"],
    },
    {
      raw: [
        "# Keep in sync with `settings.MAX_WORKERS`.",
        "# Values above 64 thrash the scheduler.",
      ].join("\n"),
      text: "Keep in sync with settings max workers. Values above 64 thrash the scheduler.",
      identifiers: ["settings.MAX_WORKERS"],
    },
    {
      raw: "/* Fall back to the slow path when the cache is cold. */",
      text: "Fall back to the slow path when the cache is cold.",
      identifiers: [],
    },
    {
      raw: "-- see http://lua.org for details",
      text: "see for details",
      identifiers: [],
    },
    {
      raw: "<!-- Hero banner: keep the h1 first for SEO -->",
      text: "Hero banner: keep the h1 first for SEO",
      identifiers: [],
    },
  ],
};
