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

Live positions come from **[Realtime Trains](https://www.realtimetrains.co.uk/)**, which reports when each train passes stations and timing points. The map places the train between the last place it was reported and the next one, based on the time. It's not GPS, so the marker moves along a straight line between stations rather than following the exact curve of the track.

Realtime Trains needs a login and blocks direct calls from web pages, so the app talks to it through a tiny **relay** you run for free on Cloudflare. It takes about 10 minutes, once.

### 1. Get a free Realtime Trains API account
1. Go to <https://api.rtt.io> and register. It's free for personal use.
2. Once approved, note the **API username** and **API password** it gives you. These are different from a normal website login.

### 2. Set up the relay (Cloudflare Workers, free)
1. Create a free account at <https://dash.cloudflare.com/sign-up>.
2. Go to **Workers & Pages → Create → Create Worker**, name it something like `right-time`, and click **Deploy**.
3. Click **Edit code**, delete what's there, paste in the contents of [`relay/worker.js`](relay/worker.js), and click **Deploy**.
4. Back on the Worker's page, open **Settings → Variables and Secrets** and add two **Secrets**:
   - `RTT_USERNAME`: your Realtime Trains API username
   - `RTT_PASSWORD`: your Realtime Trains API password
5. Copy the Worker's address. It looks like `https://right-time.<your-name>.workers.dev`.

### 3. Connect the app
In the app, open **Settings → Live train data**, paste the relay address, and tap **Save & test**. When you share a train from one phone, the link carries this address, so the other phone is set up automatically.

## Putting the app on an iPhone

The app is plain static files, so any free static host works. Choose one:

- **GitHub Pages**: free only for **public** repos. The code holds no personal data (the relay login lives in Cloudflare, and saved runs stay on the phone), so making this repo public is safe. Go to **Settings → General → Change visibility → Public**, then **Settings → Pages → Deploy from a branch**, pick the branch and `/ (root)`, and save. It'll be at `https://cameronlarge-bloomreach.github.io/Cameron-Rail-App/`.
- **Netlify Drop** (keeps the repo private): download the repo as a ZIP, unzip it, and drag the folder onto <https://app.netlify.com/drop>.

Then on each iPhone: open the address in **Safari**, tap **Share → Add to Home Screen**, then open **Right Time** from the home screen.

## Good to know
- Drivers shouldn't touch their phones in the cab. The app doesn't need her phone at all while she drives: tracking comes from the railway's own data, so she can save the run once she's finished.
- Data for Realtime Trains comes from Network Rail. Positions update when the train passes reporting points, usually every few minutes.
- Empty stock or freight moves may not appear in station searches.
- Saved runs live only on that phone. Use **Settings → Export backup** now and then.
- To try it on a computer: run `python3 -m http.server` in this folder and open <http://localhost:8000>.

## Credits
Live data: Realtime Trains. Station locations: [uk-railway-stations](https://github.com/davwheat/uk-railway-stations) (ODbL). Map: © OpenStreetMap contributors, © CARTO, © OpenRailwayMap. Map library: Leaflet (BSD-2).
