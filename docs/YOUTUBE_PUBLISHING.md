# YouTube publishing

`pnpm ys episode publish <id>` uploads a finished episode to YouTube through the Data API v3 as a **private** video
(or unlisted/public with `--privacy`), sets the package thumbnail, and records the video id in the episode state.
Nothing is published automatically by the pipeline: publishing is a separate, explicit command.

## One-time Google Cloud setup

Use the channel's own Google account for all of this.

1. Open the [Google Cloud console](https://console.cloud.google.com/), create a project (for example `host-leo-studio`).
2. **APIs & Services → Library**: enable **YouTube Data API v3**.
3. **APIs & Services → OAuth consent screen**: user type **External**, fill in the app name and the support e-mail,
   add the scopes `youtube.upload` and `youtube.force-ssl`, and add the channel's Google account under **Test users**.
   Leave the app in *Testing*: verification is only needed to let other people sign in.
4. **APIs & Services → Credentials → Create credentials → OAuth client ID**: application type **Desktop app**.
   Copy the client id and secret into `.env`:

   ```ini
   YT_CLIENT_ID=....apps.googleusercontent.com
   YT_CLIENT_SECRET=...
   ```

5. Sign in once from the machine that will upload:

   ```bash
   pnpm ys youtube auth
   ```

   The command prints a consent URL, listens on `http://127.0.0.1:8977/callback` (change with `YT_REDIRECT_URI`),
   receives the code after you approve, and prints the refresh token. Paste it into `.env` as `YT_REFRESH_TOKEN`.
   The CLI never writes `.env` itself. A refresh token of an app in *Testing* expires after 7 days of no use; run
   `youtube auth` again when uploads fail with `invalid_grant`.

## Publishing

```bash
pnpm ys episode publish <id>                         # main video, private, with thumbnail
pnpm ys episode publish <id> --privacy unlisted
pnpm ys episode publish <id> --short                 # first vertical Short (#Shorts appended)
pnpm ys episode publish <id> --short --n 2           # second Short
```

Title, description (chapters and credits included) and tags come from the publishing package (`state.package`);
the Short takes its own title. The result is stored in `state.publish` (`main` and `shorts[]`) with the video URL,
privacy and time, and printed. Publishing the same target again uploads a new video; delete the old one in YouTube
Studio if that was not intended.

## Limits worth knowing

- **Quota**: a new project has 10,000 units per day; one upload costs about 1,600, a thumbnail 50. That is six
  uploads a day. The quota resets at midnight Pacific time.
- **Unverified app**: while the OAuth app is not verified by Google, videos uploaded through the API stay **private**
  even if you ask for public. Switch them to public in YouTube Studio, or request verification once the channel is
  established. For a channel that reviews every upload before release this is the intended behaviour.
- **Thumbnails** need a channel with a verified phone number; without it the upload succeeds and the thumbnail step
  is reported as skipped.
- **Made for kids**: every upload declares `selfDeclaredMadeForKids: false`; change `madeForKids` in
  `packages/publisher` if the channel is for children.
