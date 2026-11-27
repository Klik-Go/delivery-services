// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Button } from "./button";

afterEach(cleanup);

describe("Button", () => {
  it("renders a native button with at least a 44px tap target by default", () => {
    render(<Button>Place order</Button>);
    const button = screen.getByRole("button", { name: "Place order" });
    expect(button.tagName).toBe("BUTTON");
    expect(button.className).toContain("min-h-tap");
    expect(button.className).toContain("rounded-control");
    expect(button.className).toContain("bg-action");
    expect(button.getAttribute("type")).toBe("button");
  });

  it("exposes a denser desk size without losing the control radius", () => {
    render(
      <Button size="control" variant="secondary">
        Save
      </Button>,
    );
    const button = screen.getByRole("button", { name: "Save" });
    expect(button.className).toContain("min-h-control");
    expect(button.className).toContain("bg-sheet");
  });

  it("can render as a link while keeping button styling", () => {
    render(
      <Button asChild variant="secondary">
        <a href="/orders">My orders</a>
      </Button>,
    );
    const link = screen.getByRole("link", { name: "My orders" });
    expect(link.getAttribute("href")).toBe("/orders");
    expect(link.className).toContain("bg-sheet");
  });

  it("offers a destructive variant with seal colour", () => {
    render(<Button variant="destructive">Cancel</Button>);
    expect(screen.getByRole("button", { name: "Cancel" }).className).toContain("text-seal");
  });
});
