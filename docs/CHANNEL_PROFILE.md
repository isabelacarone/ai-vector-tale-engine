# Channel profile

`channel/channel.json` is the versioned description of the channel: its name, language, series, audience, the
presenter's persona, and the defaults every episode starts from (style pack, line style, voice, presenter). The schema
is `ChannelProfile` in `packages/core/src/channel.ts`.

The file is not read directly. Import it into the asset store once, and again after every change:

```bash
pnpm ys channel import            # reads channel/channel.json → settings/channel.json in the store
pnpm ys channel import path.json  # another file
pnpm ys channel                   # shows the imported profile
```

What the profile changes:

- `persona` and `audience` are appended to the story-architect, screenwriter and script-doctor instructions
  (`personaBlock` in `packages/agents/src/agents.ts`). They never override the writing rules, the length budget or
  the research policy.
- `lang`, `series`, `stylePack`, `lineStyle`, `voiceId` and `presenter` are the defaults of `pnpm ys episode new`
  when the matching flag (`--lang`, `--series`, `--style-pack`, `--line`, `--voice`, `--presenter`) is not given.
  Flags always win. The Studio form is not affected.

`presenter` is the character-bank id printed by `pnpm ys bank add` / `pnpm ys bank list`. Leave it out until the
presenter exists; the episode then runs without a fixed presenter. Bank characters force their pack and line style on
the episode, so keep `stylePack` and `lineStyle` equal to the presenter's.
