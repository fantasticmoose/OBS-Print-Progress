# OBS Print Progress Overlays

One browser-source scene per printer. Drop an HTML file into OBS, update the `PRINTER_CONFIG` block near the top, and you're set.

## Files
- `print-progress.css` - shared styling
- `print-progress.js` - shared logic (polls printer + updates overlays)
- `printer1.html`, `printer2.html` - example per-printer scenes (copy/rename for more printers)

Keep everything in the same folder.

## Configure a printer
### Klipper / Moonraker
Edit the `PRINTER_CONFIG` block in the HTML:
- `name`: Friendly printer name shown on the overlay
- `ip`: Printer API host (e.g., `printer1.local` or `192.168.x.x`)
- `camera`: Optional; leave blank to auto-build `http://<ip>/webcam/?action=stream` so the IP is only entered once
- `flipHorizontal` / `flipVertical`: Optional booleans to mirror/flip the camera stream if the raw feed is reversed
- `updateInterval`: Poll rate in ms (default 2000)
- `debug`: `true` to show debug info, `false` to hide

Moonraker/Mainsail CORS (needed for browser/OBS access):
Add this to `mainsail.cfg` (or your main `moonraker.conf`), adjusting the IPs to match your OBS/desktop machine:
```
[server]
cors_domains:
  http://localhost
  http://127.0.0.1
  http://192.168.x.x   # your OBS/desktop IP
  null                 # allows file access
```

Camera orientation tips:
- Check the raw stream (same URL the overlay uses). If it's mirrored or upside down compared to Mainsail's preview, set `flipHorizontal: true` and/or `flipVertical: true` in the HTML config.
- In OBS you can also right-click the Browser source → Transform → Flip to adjust per-source.

## Add another printer
1) Copy an existing HTML (e.g., `printer1.html` -> `newprinter.html`).
2) Update the `PRINTER_CONFIG` values in that new file.

## Use in OBS
1) Add a **Browser** source in OBS and point it to the HTML file on disk.
2) Set the source width/height you want; the overlay will scale to fit.
3) If the camera doesn't load, confirm the `camera` URL is reachable and supports browser playback (MJPEG/RTSP via OBS).

## Notes
- Debug info renders in a small block at the bottom; leave `debug: false` for clean output.
- If you move the folder, just repoint the Browser source(s) to the new path.
