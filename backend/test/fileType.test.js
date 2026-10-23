import test from "node:test";
import assert from "node:assert/strict";
import { isCodeOrTextFile } from "../src/utils/fileType.js";

test("isCodeOrTextFile recognizes common code/text extensions", () => {
  assert.equal(isCodeOrTextFile("index.js"), true);
  assert.equal(isCodeOrTextFile("README.md"), true);
  assert.equal(isCodeOrTextFile("styles.CSS"), true); // case-insensitive
  assert.equal(isCodeOrTextFile("notes.txt"), true);
});

test("isCodeOrTextFile treats a text/* mimeType as text even with an unknown extension", () => {
  assert.equal(isCodeOrTextFile("data.unknownext", "text/plain"), true);
});

test("isCodeOrTextFile rejects binary/asset files", () => {
  assert.equal(isCodeOrTextFile("photo.png"), false);
  assert.equal(isCodeOrTextFile("archive.zip"), false);
  assert.equal(isCodeOrTextFile("movie.mp4", "video/mp4"), false);
});
