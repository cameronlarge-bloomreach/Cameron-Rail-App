# Right Time

A free iPhone app that shows a train **live on a map**, like following a journey on Google Maps, along with how early or late it's running. It was built so a train driver's train can be followed while she works, and so she can keep a record of her punctuality.

It's a Progressive Web App (PWA): it installs from Safari onto the home screen, opens full-screen like a normal app, and needs no App Store.

## What it does

**Map**
- The train appears as a moving marker labelled with its headcode. The part of the route already run is solid and the rest is dashed. Railway lines are drawn on the map.
- Each station is coloured once the train has called there: blue for early, grey for on time, red for late. Tap a station for its booked and actual times.
- A bottom panel shows where the train is ("Between York and Malton"), how early or late it is, and the next stop with its expected time. It refreshes every 30 seconds.
- **Stops**: every calling point with booked, actual and expected times.
- **Share**: sends a link that opens the same live train on another phone.
- **Save run**: saves the run to her stats. If she only drove part of the train, she picks where she took over and handed over, and the times fill in.
- **Try a demo** shows a pretend train moving, so you can see how it works before setting anything up.

**Find**: search any station (name or 3-letter code), choose a date, and optionally type the headcode. Tap a train to track it.

**Stats and Runs**: % early or on time, early/on-time/late counts, average, streak, most early and most late, total minutes, a chart of recent runs, reasons for being late, and how each route does. Runs can be added by hand, edited, exported (JSON backup or CSV) and restored.

## How the live data works

Live data comes from the **[Realtime Trains next-generation API](https://github.com/realtimetrains/api-specification)** (`data.rtt.io`). It replaced the old `api.rtt.io` service, which shut down on 30 September 2026. The data originally comes from Network Rail's train reporting and signalling systems.

How the app places the train, most precise first:
1. **Live signalling status.** Near stations, Realtime Trains reports *approaching*, *arriving*, *at platform*, *ready to depart* and *departing*. These come from the signalling system, so the map and panel show them directly (for example "Approaching Malton").
2. **Actual reports.** Each time the train is recorded at a station or timing point, the app uses that exact time and delay.
3. **Between reports.** The app moves the marker along the line using the timetable and the current delay, every 5 seconds. It never places the train beyond a timing point the train hasn't reported at yet.

It's not GPS, and no public UK source offers train GPS. The marker moves in straight lines between stations rather than along the exact curve of the track. With **detailed mode** (a paid Realtime Trains plan), you also get working-timetable times (what drivers actually run to) and passing points between stations. Those give many more reports per journey, so the position is noticeably more precise. The app and relay use detailed mode automatically if the token includes it.

**Refresh rate.** Free tokens allow 100 requests an hour and 1,000 a day (Realtime Trains, October 2026). So the app fetches fresh data once a minute while tracking, and moves the marker locally in between. The relay shares each answer between phones for 45 seconds. If the limit is hit, it shows the last good data and says so.

Realtime Trains requires that tokens are **never put inside an app**; they must be kept on a server. So the app talks to Realtime Trains through a tiny **relay** you run for free on Cloudflare. It takes about 10 minutes, once.

### 1. Get a free Realtime Trains API token
1. Go to <https://api-portal.rtt.io> and register. This needs a Realtime Trains account, and it's free for personal use.
2. Request a token. The portal tells you whether it's a **refresh token** (most likely) or a **long-life access token**. Keep it private.

### 2. Set up the relay (Cloudflare Workers, free)
1. Create a free account at <https://dash.cloudflare.com/sign-up>.
2. Go to **Workers & Pages → Create → Create Worker**, name it something like `right-time`, and click **Deploy**.
3. Click **Edit code**, delete what's there, paste in the contents of [`relay/worker.js`](relay/worker.js), and click **Deploy**.
4. Back on the Worker's page, open **Settings → Variables and Secrets** and add one **Secret**:
   - `RTT_REFRESH_TOKEN`: your token, if the portal called it a refresh token, **or**
   - `RTT_ACCESS_TOKEN`: if it's a long-life access token. If your plan includes detailed mode, also add a plain variable `RTT_DETAILED` = `true`.
5. Copy the Worker's address. It looks like `https://right-time.<your-name>.workers.dev`.

### 3. Connect the app
In the app, open **Settings → Live train data**, paste the relay address, and tap **Save & test**. It reports whether it's connected and whether detailed mode is on. When you share a train from one phone, the link carries this address, so the other phone is set up automatically.

## Putting the app on an iPhone

The app is plain static files, so any free static host works. Choose one:

- **GitHub Pages**: free only for **public** repos. The code holds no personal data (the relay login lives in Cloudflare, and saved runs stay on the phone), so making this repo public is safe. Go to **Settings → General → Change visibility → Public**, then **Settings → Pages → Deploy from a branch**, pick the branch and `/ (root)`, and save. It'll be at `https://cameronlarge-bloomreach.github.io/Cameron-Rail-App/`.
- **Netlify Drop** (keeps the repo private): download the repo as a ZIP, unzip it, and drag the folder onto <https://app.netlify.com/drop>.

Then on each iPhone: open the address in **Safari**, tap **Share → Add to Home Screen**, then open **Right Time** from the home screen.

## Good to know
- Drivers shouldn't touch their phones in the cab. The app doesn't need her phone at all while she drives: tracking comes from the railway's own data, so she can save the run once she's finished.
- **Even more precise tracking** would mean reading Network Rail's raw signalling feed ("Train Describer") directly, which reports the train moving from one signal section to the next. That needs a server running 24/7 and a map of signal sections to locations that isn't publicly available for the whole network. It's a much bigger project, and Realtime Trains already uses that feed for its approaching/at platform/departing statuses.
- Empty stock or freight moves may not appear in station searches.
- Saved runs live only on that phone. Use **Settings → Export backup** now and then.
- To try it on a computer: run `python3 -m http.server` in this folder and open <http://localhost:8000>.

## Credits
Live data: Realtime Trains. Station locations: [uk-railway-stations](https://github.com/davwheat/uk-railway-stations) (ODbL). Map: © OpenStreetMap contributors, © CARTO, © OpenRailwayMap. Map library: Leaflet (BSD-2).
