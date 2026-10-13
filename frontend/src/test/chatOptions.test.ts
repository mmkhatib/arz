import { describe, it, expect } from "vitest";
import { extractOptions, segmentMessage, stripPartialOptions } from "@/utils/segments";

describe("extractOptions", () => {
  it("pulls a trailing OPTIONS line off the visible reply", () => {
    const { cleanedText, choices } = extractOptions(
      "Ready to ship. Which branch?\n[OPTIONS: main | staging | hold]",
    );
    expect(cleanedText).toBe("Ready to ship. Which branch?");
    expect(choices).toEqual(["main", "staging", "hold"]);
  });

  it("leaves a reply with no OPTIONS line untouched", () => {
    const text = "Just prose, and a [bracket] that isn't a choice list.";
    expect(extractOptions(text)).toEqual({ cleanedText: text, choices: [] });
  });

  it("ignores an OPTIONS line that isn't last — mid-reply text is prose", () => {
    const text = "[OPTIONS: a | b]\nand then more to say";
    expect(extractOptions(text).choices).toEqual([]);
  });

  it("caps runaway choice lists at ten", () => {
    const many = Array.from({ length: 20 }, (_, i) => `c${i}`).join(" | ");
    expect(extractOptions(`pick\n[OPTIONS: ${many}]`).choices).toHaveLength(10);
  });

  it("drops empty slots so a stray pipe cannot render a blank button", () => {
    expect(extractOptions("pick\n[OPTIONS: yes | | no ]").choices).toEqual(["yes", "no"]);
  });

  it("matches a line the model wrapped in markdown", () => {
    expect(extractOptions("pick\n**`[OPTIONS: ship it | hold]`**").choices).toEqual([
      "ship it",
      "hold",
    ]);
  });

  it("keeps a goal chip that trails the options line", () => {
    const { cleanedText, choices } = extractOptions(
      'Done.\n[OPTIONS: commit | keep going]\n<goal-marker variant="done" />',
    );
    expect(choices).toEqual(["commit", "keep going"]);
    expect(cleanedText).toContain("<goal-marker");
    expect(cleanedText).not.toContain("OPTIONS");
    expect(cleanedText.startsWith("Done.")).toBe(true);
  });

  it("drops per-choice markdown and case-duplicate suggestions", () => {
    expect(extractOptions("pick\n[OPTIONS: **Run it** | run it | _wait_]").choices).toEqual([
      "Run it",
      "wait",
    ]);
  });

  it("strips the tail before segmenting, so a widget reply keeps both", () => {
    const { cleanedText, choices } = extractOptions(
      'Here:\n<arzwidget title="T">x</arzwidget>\n[OPTIONS: keep | drop]',
    );
    const segs = segmentMessage(cleanedText);
    expect(choices).toEqual(["keep", "drop"]);
    expect(segs.some((s) => s.kind === "widget")).toBe(true);
    expect(cleanedText).not.toContain("OPTIONS");
  });
});

describe("extractOptions — model tics", () => {
  it("accepts the singular [OPTION:] form", () => {
    expect(extractOptions("pick\n[OPTION: yes | no]").choices).toEqual(["yes", "no"]);
  });

  it("accepts a full-width closer", () => {
    expect(extractOptions("pick\n[OPTIONS: yes | no\u3011").choices).toEqual(["yes", "no"]);
  });

  it("tolerates the repeated tic some models append after the closer", () => {
    expect(extractOptions("pick\n[OPTIONS: a | b](OPTIONS)").choices).toEqual(["a", "b"]);
  });

  it("falls back to commas when the model used no pipes", () => {
    expect(extractOptions("pick\n[OPTIONS: run it, wait]").choices).toEqual(["run it", "wait"]);
  });

  it("leaves a mid-sentence mention alone — only a final line is a marker", () => {
    const text = "Use [OPTIONS: A | B] to offer choices, as documented.";
    expect(extractOptions(text).choices).toEqual([]);
  });
});

describe("stripPartialOptions", () => {
  it("hides a marker still being typed", () => {
    expect(stripPartialOptions("Done.\n[OPTIONS: Commit it | Show me the d")).toBe("Done.");
  });

  it("hides a half-typed head", () => {
    expect(stripPartialOptions("Done.\n[OPTI")).toBe("Done.");
    expect(stripPartialOptions("Done.\n[")).toBe("Done.");
  });

  it("hides a head behind a markdown wrapper", () => {
    expect(stripPartialOptions("Done.\n**`[OPTIONS: Commit")).toBe("Done.");
  });

  it("keeps an array index — a bracket glued to a word is prose", () => {
    const text = "the value is arr[0";
    expect(stripPartialOptions(text)).toBe(text);
  });

  it("keeps a closed marker followed by real prose", () => {
    const text = "Use [OPTIONS: A | B] to offer choices, as documented.";
    expect(stripPartialOptions(text)).toBe(text);
  });

  it("keeps text with no bracket at all", () => {
    expect(stripPartialOptions("just prose")).toBe("just prose");
  });
});
