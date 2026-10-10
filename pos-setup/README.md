# Setting up a BladeOS till (Licon all-in-one and similar Windows terminals)

About 20 minutes per till. Everything below is done once.

## What's supported

| Device | How it connects | Notes |
|---|---|---|
| Receipt printer (80 mm or 58 mm thermal) | USB with its Windows driver (most common) | Prints silently through the launcher |
| Receipt printer on a COM port | USB-serial, RS-232 or Bluetooth (shows as COMx) | BladeOS sends ESC/POS itself: auto-cut, QR code, drawer kick |
| Cash drawer | RJ11 cable into the receipt printer | Opens through the printer (driver setting, or ESC/POS mode) |
| Barcode scanner (1D/2D, USB or Bluetooth) | Acts as a keyboard | No driver. Enter, Tab or no suffix all work |
| Label scale (prints barcode stickers) | Not connected | Scan its labels: EAN-13 starting with 2 (PLU + weight or price) |
| Counter scale on USB/COM | Web Serial | Optional; weight appears in the weigh screen |
| Customer screen (second display) | HDMI / built-in second panel | Shows items, total and change |

Not supported from a browser: network (LAN/Wi-Fi IP) receipt printers without a Windows driver. Install the maker's Windows driver for those and use the Windows-printer mode.

## 1. Windows

1. Install **Google Chrome** (Microsoft Edge also works).
2. Install the receipt printer's Windows driver from the maker's CD or website (Licon terminals usually ship an Xprinter-type 80 mm printer; use the driver in the box).
3. **Settings → Bluetooth & devices → Printers & scanners**: turn **off** "Let Windows manage my default printer", then set the receipt printer as **default**.
4. Printer **Printing preferences**:
   - Paper: **80 mm × receipt** (or 72 mm × 297 mm), margins 0.
   - **Cash drawer: Open before printing** (Drawer 1 / pin 2). On some drivers this is under *Device settings* or *Peripheral*.
   - Cutter: cut after each page.
5. **Settings → Display**: note the main screen's resolution (e.g. 1366 × 768). The customer screen should be arranged to the **right** of the main screen.

## 2. Launcher

1. Copy `BladeOS-POS.bat` to the till (e.g. the Desktop).
2. Right-click → **Edit**: set `BLADEOS_URL` to your BladeOS address and `PRIMARY_WIDTH` to the main screen's width.
3. Double-click it. The till opens full screen and the customer screen opens on the second display.
4. To install it: open Command Prompt in that folder and run `BladeOS-POS.bat install`. This adds a **BladeOS POS** icon
   on the Desktop and in the Start menu, and starts BladeOS with Windows.
5. Sign in as the cashier. (Press **Alt+F4** to close the till window.)
6. Each cashier sets an **Offline PIN** once on this till: account menu (top right) → *Offline PIN (this till)*.
7. POS → **Devices**: set the **Till number** (1, 2, …) — it starts the receipt numbers used offline (T1-000123).

Back-office PCs, laptops and phones don't need the launcher: open BladeOS in Chrome or Edge and use the account menu →
**Install BladeOS app** (or the install icon in the address bar; on a phone, *Add to Home screen*).

## 3. In BladeOS (POS → Devices)

1. **Receipt printer**: *Windows printer*, 80 mm, *Print automatically* on → **Print test page**. It must print without a dialog and cut. If a dialog appears, BladeOS wasn't started from the launcher.
2. For a COM-port printer instead: choose *ESC/POS on a COM port* → **Choose COM port** → **Print test page** → **Open cash drawer**.
3. **Barcode scanner**: click the test box and scan any product. It should say *Scanner detected*. Scan a scale label: it should name the product and weight.
4. **Customer screen**: if it didn't open on its own, press *Customer screen* on the POS, allow window placement, or drag it to the second display and press F11.
5. Business Setup → Products: scan each packed product's barcode into its **Barcode** box. Business Setup → Receipt & Till: address, phone, TIN, and whether your label scale prints **weight** or **price**.

## When the internet goes down

- The till keeps selling: cash, card and transfer sales, receipts, the cash drawer, scanner, scale and customer screen all
  carry on. A yellow bar says **Offline** and how many items are waiting to upload.
- Offline receipts are numbered **T1-000001**, **T1-000002**, … (T + till number). Each one becomes a normal ORD number
  when it uploads.
- Also saved for upload: cleared tickets, temperature readings and food-safety checklists. Tickets can be held and recalled.
- Needs the internet: manager-approved discounts, pay-later, new customers, refunds, approvals, reports, closing the till.
- If the till restarts without internet, sign in with the **Offline PIN**. Five wrong tries remove the PIN.
- After **24 hours** offline the bar turns red; after **72 hours** selling pauses until the till uploads.
- When the internet is back, sign in normally: everything uploads by itself. A manager signing in on the till also uploads
  sales left by a cashier who has gone home.
- Uploaded sales keep the time they were made and the price the customer paid. If the system had less stock than was
  sold, or a price had changed, the sale is still recorded and managers see a "check" note on the order.
- **Never clear the browser data on a till** while the bar shows items waiting. To be safe before reinstalling Windows,
  tap the bar → *Save a copy (file)*.

## 4. Check before opening

- A cash sale prints one receipt, cuts, and opens the drawer.
- A card or transfer sale prints and does **not** open the drawer (ESC/POS mode; in Windows-printer mode the driver opens it on every receipt unless you pick "Cash only" where the driver offers it).
- The customer screen shows each item, the total, and the change.
- Close the till and print the Z report.
- Unplug the network cable (or turn off Wi-Fi), make a sale, plug it back in, sign in: the bar should say everything uploaded.

## Troubleshooting

| Problem | Fix |
|---|---|
| Print dialog appears | Start BladeOS with the launcher. Close all Chrome windows first. |
| Receipt prints tiny or on A4 | Receipt printer isn't the default, or paper size isn't set to 80 mm in Printing preferences |
| Drawer doesn't open | Drawer cable must go into the printer's DK/RJ11 port; enable "open cash drawer" in the driver |
| Scanner types into the wrong box | Click the POS search box once, or close any open dialog; scanned codes always go to the search box when nothing else is focused |
| Scale labels say "bad check digit" | Clean the label or scanner window; reprint the label |
| Scale labels give the wrong weight | Business Setup → Receipt & Till → *Scale labels carry*: weight or price |
| Customer screen blank | It shows "Welcome" when no sale is in progress. It must be opened from the same till (same launcher) |
