import { describe, it, expect, beforeEach } from "vitest";
import { resolveSourcePos, findCoords } from "@/utils/sourcePos";

describe("findCoords", () => {
  it("locates first occurrence on line 1", () => {
    expect(findCoords("hello world", "world")).toEqual({ line: 1, column: 7 });
  });

  it("locates substring mid-document", () => {
    const c = "alpha\nbeta\ngamma delta\nfoo";
    expect(findCoords(c, "delta")).toEqual({ line: 3, column: 7 });
  });

  it("first char of line", () => {
    expect(findCoords("a\nb\nc", "c")).toEqual({ line: 3, column: 1 });
  });

  it("returns undefined when anchor absent", () => {
    expect(findCoords("a\nb\nc", "missing")).toBeUndefined();
  });

  it("handles empty selection", () => {
    expect(findCoords("a\nb", "")).toBeUndefined();
  });
});

describe("resolveSourcePos", () => {
  let root: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = "";
    root = document.createElement("div");
    document.body.appendChild(root);
  });

  function selectInside(node: Node, start: number, end: number): Range {
    const r = document.createRange();
    r.setStart(node, start);
    r.setEnd(node, end);
    return r;
  }

  it("resolves selection inside a paragraph to source line/col", () => {
    // Source: line 1 = "Hello **bold** world"
    // Rendered: <p>Hello <strong>bold</strong> world</p>
    // p covers source 1:1-1:21, child strong covers 1:7-1:15.
    const content = "Hello **bold** world";
    const p = document.createElement("p");
    p.setAttribute("data-sourcepos", "1:1-1:21");
    p.innerHTML = "Hello <strong data-sourcepos=\"1:7-1:15\">bold</strong> world";
    root.appendChild(p);

    // Click into the second char of "world" — rendered offset = 13
    // ("Hello bold wo|rld" — 13 chars before cursor).
    const tail = p.childNodes[2] as Text; // " world"
    const range = selectInside(tail, 2, 3); // selects "o" in "world"
    const coord = resolveSourcePos(range, root, content);
    // "world" begins at source col 16 (1-indexed), "o" at col 17.
    expect(coord).toEqual({ line: 1, column: 17 });
  });

  it("returns undefined when no data-sourcepos ancestor exists", () => {
    const div = document.createElement("div");
    div.innerHTML = "<span>plain</span>";
    root.appendChild(div);
    const text = (div.firstChild as HTMLElement).firstChild as Text;
    const range = selectInside(text, 1, 2);
    expect(resolveSourcePos(range, root, "irrelevant")).toBeUndefined();
  });

  it("respects data-block-start for streaming-split blocks", () => {
    // Block starts at file line 10. Inner p is at block-relative 1:1-1:6.
    const wrap = document.createElement("div");
    wrap.setAttribute("data-block-start", "10");
    const p = document.createElement("p");
    p.setAttribute("data-sourcepos", "1:1-1:6");
    p.textContent = "hello";
    wrap.appendChild(p);
    root.appendChild(wrap);

    const text = p.firstChild as Text;
    const range = selectInside(text, 0, 1);
    // Source needs at least 10 lines because block-start re-bases the
    // line number into whole-file coordinates.
    const content = "x\n".repeat(9) + "hello";
    const coord = resolveSourcePos(range, root, content);
    expect(coord?.line).toBe(10);
    expect(coord?.column).toBe(1);
  });

  it("falls back to span-start when offset exceeds rendered length", () => {
    const p = document.createElement("p");
    p.setAttribute("data-sourcepos", "5:3-5:10");
    p.textContent = "hi";
    root.appendChild(p);
    const text = p.firstChild as Text;
    const range = selectInside(text, 2, 2);
    expect(resolveSourcePos(range, root, "x\nx\nx\nx\nxxhi xxx")).toEqual({ line: 5, column: 3 });
  });
});
