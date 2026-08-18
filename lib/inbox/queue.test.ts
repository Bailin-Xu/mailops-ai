import { describe, expect, it } from "vitest";

import { inboxHref, parseInboxFilters, selectInboxItem } from "@/lib/inbox/queue";

describe("mock inbox filters", () => {
  it("validates status and selected thread input", () => {
    expect(parseInboxFilters({ status: "bad", selected: "bad", q: "  Artsy  " })).toEqual({
      status: "ALL",
      selected: undefined,
      q: "Artsy",
    });
  });

  it("builds stable inbox links", () => {
    const filters = parseInboxFilters({ status: "NEEDS_ACTION", q: "payment" });
    const selected = "4beedb6b-7ff3-4d3c-b97f-cb9f0ca5acbf";
    expect(inboxHref(filters, { selected })).toContain("status=NEEDS_ACTION");
    expect(inboxHref({ ...filters, selected }, { status: "ALL", q: "" })).toContain("selected=");
  });

  it("does not silently process the first thread when a selected thread is unavailable", () => {
    const items = [{ id: "first" }, { id: "second" }];

    expect(selectInboxItem(items)).toEqual({ id: "first" });
    expect(selectInboxItem(items, "second")).toEqual({ id: "second" });
    expect(selectInboxItem(items, "missing")).toBeNull();
  });
});
