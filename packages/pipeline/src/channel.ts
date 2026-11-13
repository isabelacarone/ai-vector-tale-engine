import { readFile } from "node:fs/promises";
import { ChannelProfile, cleanChannelProfile } from "@ys/core";
import { getJson, putJson, type AssetStore } from "@ys/storage";

export const CHANNEL_KEY = "settings/channel.json";

/** The imported channel profile, or undefined when none was imported or the stored copy is broken. */
export async function loadChannelProfile(store: AssetStore): Promise<ChannelProfile | undefined> {
  return cleanChannelProfile(await getJson(store, CHANNEL_KEY));
}

/** Validates and stores the profile; an invalid profile is an error (the caller passed it on purpose). */
export async function saveChannelProfile(store: AssetStore, raw: unknown): Promise<ChannelProfile> {
  const profile = ChannelProfile.parse(raw);
  await putJson(store, CHANNEL_KEY, profile);
  return profile;
}

/** Imports the repository's versioned profile (`channel/channel.json`) into the store. */
export async function importChannelFile(store: AssetStore, path: string): Promise<ChannelProfile> {
  return saveChannelProfile(store, JSON.parse(await readFile(path, "utf8")));
}
