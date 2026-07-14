import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Home } from "./index";

describe("Home", () => {
  afterEach(cleanup);

  it("renders the current application shell content", () => {
    render(<Home />);

    expect(screen.getByText("hello world!")).toBeDefined();
  });
});
