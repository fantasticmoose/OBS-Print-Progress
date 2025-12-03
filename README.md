# OBS Print Progress Overlays

Single browser source that targets any printer via a query param and `printers.json`.

## Files
- `printer.html` — the only HTML you load in OBS (`?printer=<id>` selects the printer)
- `printers.json` — array of printer configs (id, ip, camera, flips, etc.)
- `print-progress.css` — shared styling
- `print-progress.js` — shared logic (polls printer + updates overlays)
- `start-server.bat` — Windows helper to run a local server (and optionally launch OBS)

Keep everything in the same folder.

## Configure printers
1) Copy `printers.json.example` to `printers.json` (this file is git-ignored; keep your real IPs out of source control).
2) Edit `printers.json`:
   - `id`: value used in the query param
   - `name`: Friendly printer name shown on the overlay
   - `ip`: Printer API host (e.g., `printer1.local` or `192.168.x.x`)
   - `camera`: Optional; leave blank to auto-build `http://<ip>/webcam/?action=stream` so the IP is only entered once
   - `flipHorizontal` / `flipVertical`: Optional booleans to mirror/flip the camera stream if the raw feed is reversed
   - `showChamber`: `true` to show chamber temp if your config exposes a chamber temperature sensor (e.g., `temperature_sensor chamber` or `heater_generic chamber`)
   - `updateInterval`: Poll rate in ms (default 2000)
   - `debug`: `true` to show debug info, `false` to hide

Moonraker/Mainsail CORS (needed for browser/OBS access):
Add this to `mainsail.cfg` (or your main `moonraker.conf`), adjusting the IPs to match your OBS/desktop machine:
```
[server]
cors_domains:
  http://localhost
  http://127.0.0.1
  http://localhost:8000
  http://<your-obs-ip>:8000
  http://192.168.x.x   # your OBS/desktop IP
  null                 # allows file access
```

Camera orientation tips:
- Check the raw stream (same URL the overlay uses). If it's mirrored or upside down compared to Mainsail's preview, set `flipHorizontal: true` and/or `flipVertical: true` in `printers.json`.
- In OBS you can also right-click the Browser source → Transform → Flip to adjust per-source.

## Select a printer in OBS
1) Start a local server:
   - Windows: double-click `start-server.bat`
   - macOS/Linux: run `./start-server.sh` (ensure it’s executable: `chmod +x start-server.sh`)
2) In OBS, add a **Browser** source and set the URL to `http://localhost:8000/printer.html?printer=<id>` (matching an `id` from `printers.json`).
3) Set the source width/height you want; the overlay will scale to fit.
4) If loading over `file://` fails due to CORS, serve via the local server (above), embed configs inline, or pass everything via query params (`?ip=...&name=...&camera=...&flipX=1&flipY=0&chamber=1`).
5) If the camera doesn't load, confirm the `camera` URL is reachable and supports browser playback (MJPEG/RTSP via OBS).

## Notes
- Debug info renders in a small block at the bottom; leave `debug: false` for clean output.
- If you move the folder, repoint the Browser source(s) to the new path.
