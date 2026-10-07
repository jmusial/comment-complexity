import { describe, expect, it } from "vitest";
import { isLicenseText, withoutLicense } from "../../extract/license";

describe("isLicenseText", () => {
  it.each([
    ["an MIT header", "The MIT License (MIT)\n\nCopyright (c) 2015 Howard Hinnant"],
    ["an Apache notice", 'Licensed under the Apache License, Version 2.0 (the "License");'],
    ["an SPDX tag", "SPDX-License-Identifier: BSD-3-Clause"],
    [
      "MIT boilerplate",
      "Permission is hereby granted, free of charge, to any person obtaining a copy",
    ],
    ["a warranty disclaimer", 'THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND'],
    ["a proprietary notice", "Copyright 2020 Acme Inc. All rights reserved."],
    ["a dated notice naming a license", "© 2024 Someone. Released under the BSD-3-Clause license."],
    ["a license named after the word", "Copyright (c) 2024 Someone, license: MIT"],
    ["a notice wrapped across lines", "Copyright (c) 2024 Acme Inc. All rights\nreserved."],
    [
      "a license name wrapped across lines",
      "Copyright (c) 2024 Someone.\nReleased under the MIT\nLicense.",
    ],
    ["wrapped boilerplate", "Permission is hereby\ngranted, free of charge, to any person"],
  ])("recognizes %s", (_, body) => {
    expect(isLicenseText(body)).toBe(true);
  });

  it.each([
    ["prose about licensing", "This file is licensed oddly, but this comment is not a header."],
    ["a copyright mention without a license", "Copyright notices are added by the release script."],
    ["a license mention without a notice", "Checks the MIT license field in package.json."],
    ["an identifier containing a license name", "Copyright (c) is read from MIT_LICENSE_FILE."],
  ])("keeps %s", (_, body) => {
    expect(isLicenseText(body)).toBe(false);
  });
});

const MIT = [
  "Copyright (c) 2024 Someone",
  "",
  "Permission is hereby granted, free of charge, to any person obtaining a copy",
  'of this software and associated documentation files (the "Software"), to deal',
  "in the Software without restriction, including without limitation the rights",
  "",
  'THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR',
  "IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY.",
];

/** Line comments, one line each; returns the kept groups as text. */
const kept = (...lines: string[]) =>
  withoutLicense(lines, (line) => line).map((group) => group.join(" / "));

describe("withoutLicense", () => {
  it("keeps an explanation right below a license line", () => {
    expect(kept("SPDX-License-Identifier: MIT", "Explains the calculation.")).toEqual([
      "Explains the calculation.",
    ]);
  });

  it("cuts a whole multi-paragraph license, keeping prose on either side", () => {
    expect(kept("Settles the ledger.", ...MIT, "Rounds half to even.")).toEqual([
      "Settles the ledger.",
      "Rounds half to even.",
    ]);
  });

  it("keeps prose that only uses legal words", () => {
    const lines = ["The software retries when the network drops.", "Errors are reported once."];
    expect(kept(...lines)).toEqual([lines.join(" / ")]);
  });

  it("leaves a single comment to the caller", () => {
    expect(kept("SPDX-License-Identifier: MIT")).toEqual(["SPDX-License-Identifier: MIT"]);
    expect(withoutLicense([], (line: string) => line)).toEqual([]);
  });
});
