import { resolve } from "node:path";
import { importChannelFile, loadChannelProfile } from "@ys/pipeline";
import type { AssetStore } from "@ys/storage";

export const CHANNEL_FILE = "channel/channel.json";

export interface ChannelDeps {
  store: AssetStore;
  print: (line: string) => void;
}

/**
 * Channel profile (docs/CHANNEL_PROFILE.md):
 *   channel                 shows the imported profile
 *   channel import [path]   imports channel/channel.json (or the given file) into settings/channel.json
 */
export async function channelCommand(deps: ChannelDeps, sub: string | undefined, path: string | undefined): Promise<void> {
  switch (sub ?? "show") {
    case "show": {
      const profile = await loadChannelProfile(deps.store);
      if (!profile) {
        deps.print(`No channel profile imported. Run: pnpm ys channel import  (reads ${CHANNEL_FILE})`);
        return;
      }
      deps.print(JSON.stringify(profile, null, 2));
      return;
    }
    case "import": {
      const file = resolve(path ?? CHANNEL_FILE);
      const profile = await importChannelFile(deps.store, file);
      deps.print(`Channel profile "${profile.name}" imported from ${file}`);
      return;
    }
    default:
      throw new Error(`Unknown channel command: ${sub} (use: channel [show|import [path]])`);
  }
}
