import { z } from "zod";
import { LanguageCode } from "./schemas.ts";
import { LineStyle } from "./vector.ts";

/**
 * Channel profile: the one place that says who the channel is. It is versioned in the repository (`channel/channel.json`)
 * and imported into the asset store (`settings/channel.json`) so the CLI and the Studio read the same copy. `persona`
 * and `audience` go into the story, screenwriter and script-doctor instructions; the other fields are the defaults
 * `episode new` uses when a flag is not given, so every episode of the channel starts from the same pack, line style,
 * voice and presenter.
 */
export const ChannelProfile = z.object({
  name: z.string().trim().min(1).max(80),
  lang: LanguageCode.optional(),
  series: z.string().trim().min(1).max(80).optional(),
  audience: z.string().trim().min(1).max(200).optional(),
  /** English, free text: who the presenter is, how they talk, what every episode must do. */
  persona: z.string().trim().min(1).max(4000).optional(),
  stylePack: z.string().trim().min(1).max(40).optional(),
  lineStyle: LineStyle.optional(),
  voiceId: z.string().trim().min(1).max(80).optional(),
  /** Character-bank id of the on-screen presenter. */
  presenter: z.string().trim().min(1).max(80).optional(),
});
export type ChannelProfile = z.infer<typeof ChannelProfile>;

/** A valid profile or undefined: a missing or broken file never stops an episode, the defaults simply do not apply. */
export function cleanChannelProfile(raw: unknown): ChannelProfile | undefined {
  const parsed = ChannelProfile.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}
