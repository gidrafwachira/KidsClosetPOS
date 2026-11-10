# Shop Stock & Sales

A phone app for a small clothes shop: tag every piece with its own number and QR code, scan to sell, and run stock counts to catch missing items. It runs in the phone's browser and needs no computer.

The owner's phone and the shop phone share the same records live. A sale on the shop phone shows on the owner's phone within seconds.

Built for Kidsclosetbydee.

## What it does

- **Tag** (owner): enter category, size, buying price and tag price. Each piece gets a unique number (for example `10017`) and a printable QR label. The date is recorded automatically.
- **Sell** (owner and sales people): scan the tags the customer is buying, enter the selling prices, choose Cash or M-Pesa, and complete the sale. The date, time and sales person are recorded and the items become "sold".
- **Count** (owner): scan everything on the racks. The app lists what should be there but was not found, sold items that are still on the rack, and tags it does not know.
- **Reports** (owner): sales, cost and profit for any period, split by payment, sales person and category. Sales below the tag price and cancelled sales are listed for checking.
- **Logins**: the owner has one login. Each sales person gets a login from the owner that can only scan, sell and see today's sales.
- **No internet in the shop?** Selling carries on. Sales are kept on the phone and upload when the connection returns. Tagging new stock needs internet.

## One-time setup (about 10 minutes)

The shared records live in Google Firebase, on its free plan. You need a Google account; no payment card is asked for. Menu names in the Firebase console may differ slightly from these.

### A. Create the online records

1. Go to <https://console.firebase.google.com> and sign in with your Gmail.
2. **Create a project.** Name it, for example, `kidscloset-pos`. Google Analytics is not needed.
3. In the left menu open **Build > Authentication**, press **Get started**, choose **Email/Password**, switch it on, and save.
4. Still in Authentication, open **Settings > Authorized domains** and add `gidrafwachira.github.io`.
5. In the left menu open **Build > Firestore Database**, press **Create database**, pick a location (any near you, for example `europe-west`), and choose **production mode**.
6. In Firestore open the **Rules** tab. Delete what is there, paste the whole of [`firestore.rules`](firestore.rules) from this repository, and press **Publish**.
7. Open **Project settings** (the gear icon) **> General > Your apps**, press the **</>** (web) icon, give the app a name, and register it. Copy the block that starts with `const firebaseConfig = {`.

### B. Put the app online

1. In this repository on GitHub, open **Settings > Pages**, choose **Deploy from a branch**, branch `main`, folder `/ (root)`, and save.
2. After a minute the app is at `https://gidrafwachira.github.io/KidsClosetPOS/`.

### C. Connect the phones

1. **Owner's phone:** open the address in Chrome. Tap **Owner, first time? Create the owner account**, choose your email and a password, then **Create shop**.
2. Still on the owner's phone: **Settings (gear) > Sales people > Add a sales person**. Give a name, an email to use as the login name, and a password.
3. **Shop phone:** open the same address and sign in with the sales person's email and password.
4. On each phone use the browser menu and choose **Add to Home screen**. Allow the camera when asked.

The shop's Firebase settings are already in [`firebase-config.js`](firebase-config.js), so the phones connect on their own. Those values identify the project and are not passwords.

## Daily use

1. New stock: owner taps **Tag**, then **Print labels**, attaches them, and the items go on the rack. No tag, no rack.
2. Sales person: scans and sells on the shop phone.
3. Owner: checks **Reports > Today** from anywhere, and compares it with the cash and M-Pesa received.
4. Weekly or monthly: owner runs **Count** in the shop. Counting one category at a time is fine.

## Labels

Labels print from the phone's print window on A4 sticker sheets (24 or 40 per sheet), on plain paper with cutting lines, or on a 50 x 30 mm or 40 x 30 mm label printer roll. Set margins to "None" and scale to 100%, and test on plain paper first. If you cannot print, write the tag number on the tag by hand; it can be typed in at the till.

## Things to know

- **What a sales login can do** is enforced by the rules in `firestore.rules`, not only by hiding screens: it can read items and mark an in-stock item as sold under its own name. It cannot tag, edit, delete, cancel a sale, or read the activity log.
- **Buying prices** are not shown on the sales screens, but they are stored in the same item record a sales login can read. A technically skilled person could find them.
- **Free plan limits**: Firebase's free plan allows 50,000 record reads and 20,000 writes a day. The app only keeps current stock and today's sales loaded, which keeps a small shop far below that.
- Scanning reads the QR code on the shop's own labels, not manufacturer barcodes.
- The tag number's last digit is a check digit, so a mistyped number is rejected.
- Sales made by two phones on the same item while both are offline: the first to upload wins and the other phone is told its sale was not saved.

## Files

- `index.html`, `style.css`: the page and its look
- `js/core.js`: the rules for stock, sales, counts and reports
- `js/app.js`: the screens and the online sync
- `js/scanner.js`: the camera scanner
- `firebase-config.js`: optional place for your Firebase settings
- `firestore.rules`: who may read and change what; paste into the Firebase console
- `vendor/`: libraries ([qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator), MIT; [jsQR](https://github.com/cozmo/jsQR), Apache-2.0; [Firebase JS SDK](https://github.com/firebase/firebase-js-sdk), Apache-2.0)
- `tests/core.test.js`: checks for the rules. Run with `node tests/core.test.js`
