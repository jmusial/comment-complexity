import { describe, expect, it } from "vitest";
import { isLicenseText } from "../../extract/comments";

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
