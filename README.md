# Stream Shield

A small Chrome extension I built because free sports streaming sites kept hijacking my clicks.
You hit "play", and instead of a match you get a new tab full of casino ads or worse.

Stream Shield sits between you and those sites. It kills pop-unders before they open, hides the
invisible overlays that steal your clicks, and closes any junk tab that still manages to sneak
through. It only touches sites you tell it to, so the rest of your browsing is left alone.

## Getting it running

There's no store listing. You load it straight from this folder:

1. Download or clone this repo.
2. Open `chrome://extensions` in Chrome.
3. Flip on **Developer mode** in the top right.
4. Click **Load unpacked** and pick the folder.
5. Pin the shield icon from the puzzle-piece menu so it's easy to reach.

Then go to a streaming site, click the shield, hit **Protect this site**, and reload. That's it.

## How it behaves

Most of these sites are just link hubs. You click a stream link and land on some other host, and
that host is where the real trouble lives. So when you click a genuine link on a protected site,
Stream Shield opens it for you and protects the new site too, for the rest of your session. The
pop-under that tries to ride along on that same click gets blocked.

If a protected tab gets yanked to another site without you clicking anything, it's sent back.
A little toast in the corner tells you when something was blocked, and the badge counts it.

## What's inside

- `main-world.js` runs inside the page before the site's own code and makes `window.open` a dud.
- `content.js` watches your clicks, peels off transparent overlays, and sorts real links from ad links.
- `frame-guard.js` gets the guards into third-party ad iframes.
- `background.js` registers everything per site and closes escaped tabs.
- `rules.json` blocks a couple dozen known pop-under ad networks at the network level.

## Testing

`test/` has a Puppeteer harness that drives real Chrome through a match page and reports every
tab that opens. `test/REPORT.md` has the before-and-after numbers from the first site I tried it on.

```
cd test && npm install
node test2.js <match page url>            # with the extension
node test2.js <match page url> --no-ext   # baseline
```

## Caveats

This is a personal tool, tuned on a handful of sites. The overlay heuristic may occasionally hide
something legitimate. If a player stops responding, unprotect the site or open an issue with the
URL. Same-site pop-ups like login windows are also blocked on protected sites.

## Contributing

Issues and pull requests are welcome. The most useful contribution is a site where it fails:
open an issue with the URL and what you clicked. Ad network domains for `rules.json` are also
welcome. MIT licensed.
