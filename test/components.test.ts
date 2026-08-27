import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import CreatedView from "@/components/CreatedView";
import RevealView from "@/components/RevealView";

// Both pages read the decryption key from the URL fragment, which does not
// exist during server rendering. These render on the server exactly as Next
// does, with no DOM present — so any stray `window` access surfaces as a
// ReferenceError here rather than as a 500 in production.
//
// This covers the server half of the contract. Hydration behaviour in a real
// browser is not exercised.

const ID = "98854c5b-a2af-4d9e-bc5f-931e13863380";

test("no global `window` exists in this environment", () => {
  // Guards the premise of every assertion below.
  assert.equal(typeof globalThis.window, "undefined");
});

test("RevealView server-renders without touching window", () => {
  const html = renderToStaticMarkup(createElement(RevealView, { id: ID }));
  assert.match(html, /Loading/);
});

test("CreatedView server-renders without touching window", () => {
  const html = renderToStaticMarkup(createElement(CreatedView, { id: ID }));
  assert.match(html, /Loading/);
});

test("the server render leaks neither an id-derived URL nor a key", () => {
  // The fragment is client-only by design; the server must not attempt to
  // reconstruct a share URL it cannot know.
  const html = renderToStaticMarkup(createElement(CreatedView, { id: ID }));
  assert.equal(html.includes("#"), false, "no fragment should appear in server markup");
  assert.equal(html.includes(`/s/${ID}`), false);
});

test("neither component renders an error state on the server", () => {
  // Before the refactor the first client render flashed "missing decryption
  // key" / "opened without a decryption key" before the effect ran. The
  // server snapshot is deliberately distinct from "absent" to avoid that.
  const reveal = renderToStaticMarkup(createElement(RevealView, { id: ID }));
  const created = renderToStaticMarkup(createElement(CreatedView, { id: ID }));

  for (const [name, html] of [["RevealView", reveal], ["CreatedView", created]] as const) {
    assert.equal(html.includes("missing decryption key"), false, `${name} flashed an error`);
    assert.equal(
      html.includes("without a decryption key"),
      false,
      `${name} flashed an error`
    );
    assert.equal(html.includes("not found or expired"), false, `${name} flashed an error`);
  }
});

test("rendering is stable across repeated server renders", () => {
  // useSyncExternalStore requires a cached, stable server snapshot; an
  // unstable one causes infinite re-render loops in React.
  const first = renderToStaticMarkup(createElement(RevealView, { id: ID }));
  const second = renderToStaticMarkup(createElement(RevealView, { id: ID }));
  assert.equal(first, second);
});
