import test from "node:test";
import assert from "node:assert/strict";
import { normalizePath, fileNameFromPath } from "../src/utils/path.js";

test("normalizePath accepts nested repository paths", () => {
  assert.equal(normalizePath("src\\models/player.js"), "src/models/player.js");
  assert.equal(normalizePath("assets/player.fbx"), "assets/player.fbx");
});

test("normalizePath rejects traversal and absolute paths", () => {
  assert.throws(() => normalizePath("../secret.txt"), /Unsafe file path/);
  assert.throws(() => normalizePath("/etc/passwd"), /Unsafe file path/);
  assert.throws(() => normalizePath("foo/../../secret"), /Unsafe file path/);
});

test("fileNameFromPath returns the final path component", () => {
  assert.equal(fileNameFromPath("assets/models/player.fbx"), "player.fbx");
});
