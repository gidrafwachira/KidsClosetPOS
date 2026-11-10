# Shop Stock & Sales

A phone app for a small clothes shop: tag every piece with its own number and QR code, scan to sell, and run stock counts to catch missing items. It runs in the phone's browser, needs no computer, and works without internet once opened.

Built for Kidsclosetbydee.

## What it does

- **Tag**: enter category, size, buying price and tag price. Each piece gets a unique number (for example `10017`) and a printable QR label. The date is recorded automatically.
- **Sell**: scan the tags the customer is buying, enter the selling prices, choose Cash or M-Pesa, and complete the sale. The date, time and sales person are recorded and the items become "sold".
- **Count**: scan everything on the racks. The app lists what should be there but was not found, sold items that are still on the rack, and tags it does not know.
- **Reports**: sales, cost and profit for any period, split by payment, sales person and category. Sales below the tag price and cancelled sales are listed for checking.
- **Two modes**: without the owner PIN the phone can only scan, sell and see today's sales. Buying prices, profit, tagging, counts and settings need the PIN.

## Putting it on the phone

1. In this repository on GitHub, open **Settings > Pages**, choose **Deploy from a branch**, branch `main`, folder `/ (root)`, and save.
2. After a minute the app is at `https://<your-username>.github.io/<repository-name>/`.
3. Open that address in Chrome on the shop phone. Use the browser menu and choose **Add to Home screen**.
4. Set the shop name and owner PIN. Write down the recovery code it shows.
5. Allow the camera when the app first asks.

## Daily use

1. New stock: **Tag**, then **Print labels**, attach, put on the rack. No tag, no rack.
2. Sales person: stays in sales mode, scans and sells.
3. End of day: owner unlocks, checks **Reports > Today** against the cash and M-Pesa received.
4. Weekly or monthly: **Count**. Counting one category at a time is fine.
5. Weekly: **Settings > Save a backup file** and keep it off the phone.

## Labels

Labels print from the phone's print window on A4 sticker sheets (24 or 40 per sheet), on plain paper with cutting lines, or on a 50 × 30 mm or 40 × 30 mm label printer roll. Set margins to "None" and scale to 100%, and test on plain paper first. If you cannot print, write the tag number on the tag by hand; it can be typed in at the till.

## Things to know

- **All records are stored on the one phone that runs the app.** They are not on GitHub and not shared with other phones. If the phone is lost or its browser data is cleared, the records go with it, so back up regularly.
- The owner PIN keeps casual users out of owner screens. It is not strong protection against someone technical with the unlocked phone in hand.
- Scanning reads the QR code on the shop's own labels, not manufacturer barcodes.
- The tag number's last digit is a check digit, so a mistyped number is rejected.

## Files

- `index.html`, `style.css`: the page and its look
- `js/core.js`: the rules for stock, sales, counts and reports
- `js/app.js`: the screens
- `js/scanner.js`: the camera scanner
- `vendor/`: QR code libraries ([qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator), MIT; [jsQR](https://github.com/cozmo/jsQR), Apache-2.0)
- `tests/core.test.js`: checks for the rules. Run with `node tests/core.test.js`
