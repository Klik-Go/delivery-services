// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Button } from "./button";

afterEach(cleanup);

describe("Button", () => {
  it("renders a native button with at least a 44px tap target", () => {
    render(<Button>Place order</Button>);
    const button = screen.getByRole("button", { name: "Place order" });
    expect(button.tagName).toBe("BUTTON");
    expect(button.className).toContain("min-h-tap");
    expect(button.getAttribute("type")).toBe("button");
  });

  it("can render as a link while keeping button styling", () => {
    render(
      <Button asChild variant="secondary">
        <a href="/orders">My orders</a>
      </Button>,
    );
    const link = screen.getByRole("link", { name: "My orders" });
    expect(link.getAttribute("href")).toBe("/orders");
    expect(link.className).toContain("bg-surface-muted");
  });
});
