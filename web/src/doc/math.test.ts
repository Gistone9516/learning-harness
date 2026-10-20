// @vitest-environment jsdom
//
// CP-1: "$$" blocks and inline "\( \)" are typeset as MathML; a single "$" stays literal.
import { describe, it, expect } from "vitest";
import { parseFlatBlocks, renderBlock } from "./doc";
import { mathSettled } from "./math";

function render(md: string): HTMLElement {
  const root = document.createElement("div");
  for (const b of parseFlatBlocks(md)) root.appendChild(renderBlock(b));
  return root;
}

describe("formula typesetting", () => {
  it("shows the raw TeX first, then MathML for a $$ block", async () => {
    const root = render(["$$", "R = \\frac{v}{\\omega}", "$$"].join("\n"));
    const box = root.querySelector<HTMLElement>(".lh-cp-formula")!;
    expect(box.textContent).toBe("R = \\frac{v}{\\omega}");
    await mathSettled();
    expect(box.classList.contains("lh-math--done")).toBe(true);
    expect(box.querySelector("math mfrac")).toBeTruthy();
    expect(box.querySelector("math")!.getAttribute("display")).toBe("block");
  });

  it("typesets inline \\( \\) and leaves a single $ as text", async () => {
    const root = render("반지름은 \\(R = v / \\omega\\) 이고 요금은 $0.0116 이다.");
    await mathSettled();
    expect(root.querySelector(".lh-math math")).toBeTruthy();
    expect(root.textContent).toContain("$0.0116");
  });

  it("keeps Korean inside \\text and does not throw on bad TeX", async () => {
    const root = render("$$ \\text{주소 개수} = 2^{32 - \\text{접두사 길이}} $$\n\n$$ \\frac{1 $$");
    await mathSettled();
    const boxes = root.querySelectorAll(".lh-cp-formula");
    expect(boxes[0].textContent).toContain("주소 개수");
    expect(boxes[1].classList.contains("lh-math--done")).toBe(true);
  });
});
