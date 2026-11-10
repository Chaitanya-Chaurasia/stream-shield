# Stream Shield test report, totalsportekl.is (2026-11-09)

Harness: Puppeteer driving real Google Chrome 157 with the extension installed via the
extension-install API (the --load-extension flag no longer works in branded Chrome).
Path tested: match page -> click a stream row -> stream host page -> click the player 4 times.

## Baseline (no extension)
- First click on the match page: pop-under to snowflint.com (adcash).
- Clicking the "Hadcrack" row: stream opened AND a pop-under (snowflint.com / browserpro.online).
- On hadcrak.cyou, 2 of 4 player clicks spawned tabs: budgetezy.org -> chaturbate.com / cam4.com.
- One run: the host tab itself was redirected to strix45ql.com -> adblockeraio.pro (fake ad blocker).
- Off-site tabs left open: 3.

## v1 (the build you had)
- window.open pop-unders on totalsportekl.is were blocked.
- BUT the legitimate stream link was blocked too (all cross-site new-tab links were treated as ads).
- The stream hosts (hadcrak.cyou etc.) were never protected because you only listed totalsportekl.is.
  Every pop-under on those hosts went through. This is why you still saw explicit sites.

## Fixes made
1. Follow mode: a real click on a visible top-level link to another site opens it through the
   extension and protects that site for the session. Pop-unders on the same click are still blocked.
2. Links inside iframes are never treated as intent (ads live in iframes).
3. Guards are injected into third-party ad iframes and about:blank frames.
4. Tabs opened with no opener (rel=noopener) are tied to the last click on a protected tab and closed.
5. Protected tabs redirected to another site without a click are sent back.

## v4 result (3 runs, 2 different stream hosts)
- Stream link opens normally.
- Pop-unders blocked at window.open: budgetezy.org, hai8g.com, uplcm.com, wildcasinoaffiliate.ag, bufingarribes.com.
- Ad iframe overlay (mxap-*) hidden on hadcrak.cyou.
- Link-based pop-under from inside an ad iframe blocked: hooliredir.com.
- Off-site tabs left open: 0 in all three runs.

## Known gaps
- Protection on third-party ad iframes starts a few ms after the frame loads; a script that
  stashes window.open instantly could slip through. The tab-closer backstop catches that.
- The redirect guard uses history back, which fails if the redirect was the first entry in a tab.
- The overlay heuristic is untested on sites that put a real player under the overlay.
