# Picapool laptop intent form

A single screen mobile web form that collects laptop buying intent from FOT DU
freshers, so the batch can aggregate demand and negotiate as one buyer instead
of thirty individuals. Responses land in a Google Sheet.

Live at [laptop.picapool.tech](https://laptop.picapool.tech).

## Stack

None. No build step, no bundler, no dependencies, no `package.json`. Three
static files served as they are:

| File | What it is |
| --- | --- |
| `index.html` | 22 lines. Loads the font, the stylesheet and the script. |
| `app.js` | The whole application. One IIFE, ES5 syntax, no framework. |
| `styles.css` | All styling. Plain CSS, no preprocessor. |
| `google-sheet.gs` | Apps Script that receives posts and writes the sheet. Not served, pasted into the Sheet's script editor. |
| `vercel.json` | Static hosting config plus the catch all rewrite. |
| `test-*.js` | Node test scripts. Dev only, never served. |

ES5 (`var`, no arrow functions, no template literals) is deliberate. The
audience is students on cheap Android phones with old WebViews.

## Running it

```bash
python -m http.server 4173
```

Then open `http://localhost:4173`. There is nothing to install or compile.

Note that the python server has no SPA fallback, so campaign paths like
`/whatsapp` will 404 locally. They work in production because Vercel rewrites
them. Test those against a deployment, not locally.

## Tests

```bash
node test-catalog.js   # catalog invariants, source path parsing, app wiring
node test-sheet.js     # google-sheet.gs against a mock Sheets API
```

Both are plain Node with no dependencies and exit non zero on failure.

`test-catalog.js` evaluates the `CATALOG` literal straight out of `app.js` and
asserts the invariants that are easy to break by hand: unique ids, exactly three
spec pills, every price ending in `999`, no `mrp` below its `price`, no empty
purpose and band combination, no rupee figure or em dash in card copy, every
`data-action` in the markup having a matching `case` in the click handler, and
no price formatter reaching the markup.

`test-sheet.js` runs `google-sheet.gs` inside a `vm` context against a mock
`SpreadsheetApp`, which is the only way to exercise Apps Script without
deploying it. It covers append versus update by `leadId`, `Submitted at` being
preserved across an update, routing between the four tabs, batch event writes,
the generated Funnel formulas being well formed, the Read me tab landing first
and staying free of jargon, secret rejection, and malformed input not throwing.

Neither replaces clicking through the form in a browser. Focus retention,
the auto capture timer and layout are not covered.

## How the app works

A state machine rendered by string concatenation. `state` holds everything,
`setState` merges a patch and calls `render`, and `render` replaces
`#phone.innerHTML` wholesale. There is no virtual DOM and no diffing.

```
landing -> purpose -> budget -> picks -> timeline -> intent -> contact -> done
```

Two consequences worth knowing before editing:

- **Every keystroke re renders the entire screen.** `render` saves the focused
  element's id and caret position before overwriting the DOM and restores them
  after. Any new `<input>` needs a stable `id` or focus will be lost on typing.
- **Click handlers are delegated** from `#phone` and dispatch on
  `data-action`. Buttons are matched with `closest('[data-action]')`, so an
  element re rendered mid interaction cannot go stale. Two `.click()` calls in
  the same tick will not both register, because the first re render detaches the
  second element. Only matters in tests.

## Catalog

`CATALOG` in `app.js` is grouped by purpose (`game`, `code`, `bal`, `des`).
A laptop may appear under several purposes with different `id`s and different
copy. `ALL_LAPTOPS` flattens them for cart lookups, so **ids must be globally
unique**.

```js
{ id: 'g1', src: 'guide', brand: 'Lenovo', model: 'LOQ',
  c: ['RTX 3050 6GB', 'Ryzen 5 7235HS', '144Hz 100% sRGB'],
  why: 'The batch favourite...', price: 57999, lid: K }
```

- `c` must have exactly three entries. The card renders `c[0]`, `c[1]`, `c[2]`.
- `price` is never shown to students. It decides which budget band the laptop
  appears in, and it goes to the sheet so whoever negotiates knows the ballpark.
- `price` must end in `999`. `pretty()` enforces the same shape on pool prices.
- `band` is derived from `price` by `bandFor()`, not stored. A card can never
  sit in a bracket its own price contradicts.
- `src` records provenance: `guide` for the FOT DU Laptop Group Buy Guide 2026
  (verified 8 and 9 Aug 2026), `prior` for rows carried over from the earlier
  catalog, `added` for rows requested by name. **Anything not tagged `guide`
  needs a live price recheck before a campaign.**
- `img` is optional and layers a product photo over the SVG illustration. It
  removes itself via `onerror` if the CDN blocks hotlinking.

Changing `BAND_MAX` reshuffles every laptop automatically. Check afterwards that
no purpose ends up with an empty band, or students hit the empty state.

### No prices on screen

Deliberate. Prices in India move weekly and the whole premise is that the group
negotiates the price afterwards, so quoting one up front is a claim the project
cannot stand behind. Card copy must not name a figure either. Budget band labels
stay, because that is the student's own budget rather than a claim about a
laptop.

## Google Sheet integration

`SHEET_ENDPOINT` at the top of `app.js` is an Apps Script web app URL. Setup
steps are in the header comment of `google-sheet.gs`.

Posts are `text/plain` with `mode: 'no-cors'`. Plain text keeps it a simple
request so the browser skips the preflight Apps Script cannot answer. The
response is therefore opaque: a rejected promise (offline, DNS, blocked) is the
only failure the client can detect, and those bodies queue in `localStorage`
under `pp_sheet_queue` and retry on the next visit.

Leaving `SHEET_ENDPOINT` empty is safe. The form works end to end and logs each
payload to the console instead.

Three payload shapes, discriminated by `type`:

| `type` | Written to | When |
| --- | --- | --- |
| absent | `Responses` | On reaching the pool screen |
| `tap` | `Taps` | Once per browser session, on load |
| `events` | `Events` | Batched, eight at a time |

### Idempotent responses

Each device mints a `leadId`. On a repeat post the script finds the row by
`leadId` and overwrites it, preserving the original `Submitted at`. So editing
picks and returning updates one row instead of appending a second. Sorting the
sheet does not break this, since lookup is by value not position.

### Sheet tabs

`Read me first` (plain English guide for non technical users), `Responses`,
`Taps`, `Events`, `Funnel`. The Funnel tab is entirely live formulas, so it
recalculates on its own: the overall eight step funnel in `A1:D9`, the same
funnel split per campaign link in `A11:L27`, and demand queries at `N1` and
`Q1`. The link column is a spilling `UNIQUE` over `Events`, so a new tag appears
by itself the first time somebody uses it; the other columns are written down
`MAX_SOURCES` rows and guarded with `IF($A13="","",...)` so unused rows stay
blank.

Step counts are `COUNTA(UNIQUE(FILTER(...)))` rather than `COUNTIF`, because
pressing back re enters a screen and fires `step_viewed` again. Counting rows
instead of distinct sessions would inflate every number.

`setupSheets()` creates every tab immediately. `rebuildFunnel()` and
`rebuildReadme()` recreate those two if their layout changes.

**After editing `google-sheet.gs` you must redeploy**: Deploy, Manage
deployments, pencil icon, New version, Deploy. The URL stays the same. Editing
the script alone changes nothing. Verify with a GET on the `/exec` URL, which
names the tabs the deployed version knows about.

## Campaign links

The first path segment is the source tag. `laptop.picapool.tech/whatsapp` tags
every response and tap from that link as `whatsapp`; a bare visit is `direct`.
No configuration, any single word works.

This needs the catch all rewrite in `vercel.json`:

```json
{ "source": "/(.*)", "destination": "/" }
```

The destination is `/` and not `/index.html` because `cleanUrls: true` makes
`/index.html` a 308 to `/`, and a rewrite pointing at a redirect resolves to a
404. Vercel checks the filesystem before rewrites, so `/app.js` and
`/styles.css` still serve themselves. Asset paths in `index.html` are absolute
for the same reason.

## Event tracking

Stands in for a product analytics tool. `track(event, detail)` buffers against
an anonymous `sessionStorage` session id; the buffer flushes at eight events, on
joining the pool, and via `sendBeacon` on `pagehide` and `visibilitychange`, so
somebody who abandons halfway still has their steps recorded.

`trackOnce(key, ...)` deduplicates per session, which is what stops a student
toggling a laptop on and off from inflating demand counts.

| Event | Detail |
| --- | --- |
| `step_viewed` | Screen name. Fired from `setState` on any screen change. |
| `chose_use`, `chose_budget`, `chose_week`, `chose_readiness` | The label picked |
| `laptop_interest` | Brand and model. Once per laptop per session. |
| `own_model` | Free text a student typed. Once per distinct value. |
| `stretched_budget`, `skipped_picks`, `started_contact`, `joined_pool`, `restarted` | |

**Never log a name or a phone number here.** `started_contact` records that
somebody began typing, with no value attached. Personal data belongs in
`Responses` only.

## Deploying

Vercel, connected to `main`. Pushing deploys. There is no build.

## Known gaps

- Prices tagged `prior` and `added` in the catalog predate the guide and are
  unverified.
- `SHEET_ENDPOINT` is in client side JavaScript, which is unavoidable for a
  static site. Anyone reading the source can post rows. `SHARED_SECRET` raises
  the bar against scrapers but is not real auth, since the client must know it
  too.
- No session replay. A spreadsheet cannot record a screen, so the Funnel tells
  you where people leave but never why.
