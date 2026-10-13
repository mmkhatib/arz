import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import ChatMarkdown from "@/components/ChatMarkdown";

const render = (text: string, streaming = false) =>
  renderToStaticMarkup(<ChatMarkdown text={text} streaming={streaming} onFileOpen={() => {}} />);

describe("ChatMarkdown", () => {
  it("highlights fenced code", () => {
    const html = render("```python\ndef f():\n    return 1\n```");
    expect(html).toContain("hljs-keyword");
    expect(html).toContain("python");
  });

  it("renders diff fences as a diff card", () => {
    const html = render("```diff\n--- a/x.py\n+++ b/x.py\n-old\n+new\n```");
    expect(html).toContain("x.py");
    expect(html).toContain("+1");
  });

  it("links bare paths with line refs", () => {
    const html = render("see src/app.py:42 for details");
    expect(html).toContain("src/app.py:42");
    expect(html).toContain("Open src/app.py:42");
  });

  it("adds a caret only while streaming", () => {
    expect(render("hello", true)).toContain("animate-pulse");
    expect(render("hello")).not.toContain("animate-pulse");
  });

  it("holds an open mermaid fence while streaming", () => {
    const html = render("intro\n\n```mermaid\ngraph TD\nA-->B", true);
    expect(html).toContain("drawing diagram");
    expect(html).not.toContain("graph TD");
  });
});
