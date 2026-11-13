import { describe, expect, it } from "vitest";
import { ChannelProfile, cleanChannelProfile } from "../src/channel.ts";

describe("channel profile", () => {
  it("trims and keeps valid fields; unknown keys are ignored", () => {
    const p = cleanChannelProfile({ name: " Host Leo Stories ", lang: "en", lineStyle: "outline", persona: " talk to the viewer ", extra: 1 });
    expect(p).toEqual({ name: "Host Leo Stories", lang: "en", lineStyle: "outline", persona: "talk to the viewer" });
  });

  it("returns undefined for a missing or invalid profile", () => {
    expect(cleanChannelProfile(undefined)).toBeUndefined();
    expect(cleanChannelProfile({})).toBeUndefined();
    expect(cleanChannelProfile({ name: "x", lineStyle: "thick" })).toBeUndefined();
    expect(cleanChannelProfile({ name: "x", lang: "English" })).toBeUndefined();
    expect(cleanChannelProfile({ name: "x", presenter: "  " })).toBeUndefined();
  });

  it("schema parses the minimal profile", () => {
    expect(ChannelProfile.parse({ name: "x" })).toEqual({ name: "x" });
  });
});
