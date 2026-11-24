# Vici Property Lookup – install guide

Adds **ZILLOW · REALTOR · HOMES.COM · TRULIA** tabs next to SCRIPT 2 on the Vici agent screen.
When a call comes in, each tab shows that home's photos, value, sale, tax, mortgage and ownership history, and home details.

Takes about 3 minutes. Do this once in **Microsoft Edge**.

## 1. Install Tampermonkey

1. In Edge, open the Tampermonkey page in the Edge Add-ons store:
   https://microsoftedge.microsoft.com/addons/detail/tampermonkey/iikmkjmpaadaobahmlepeloendndfphd
2. Click **Get**, then **Add extension**.

## 2. Allow it to run scripts (required)

Edge blocks user scripts until you allow them. Without this step nothing will show.

1. Right-click the Tampermonkey icon in the Edge toolbar (if you don't see it, click the puzzle-piece icon first).
2. Choose **Manage extension**.
3. Turn on **Allow User Scripts**.
   - Don't see that switch? Go to `edge://extensions` and turn on **Developer mode** instead.
4. Close and reopen Edge.

## 3. Install the script

1. Open this link in Edge:
   **https://raw.githubusercontent.com/midnight-batman-4827/vici-scripts/main/vici-property-lookup.user.js**
2. Tampermonkey opens an install page. Click **Install**.

## 4. Allow pop-ups for Vici (required for the Homes.com tab)

The Homes.com tab opens a small Homes.com window that looks up the home and closes itself.

1. In Edge, go to `edge://settings/content/popups`.
2. Next to **Allow**, click **Add**.
3. Type `[*.]talkitpro.com` and click **Add**.

Without this, the lookup runs in a background tab instead, which is much slower.

## 5. First call

1. Log in to Vici as usual. The tabs appear next to SCRIPT 2 once you're on the agent screen.
2. The first time a lead loads, Tampermonkey asks to allow connections to **zillow.com**, **zillowstatic.com**, **trulia.com**, **realtor.com** and **moveaws.com**. Click **Always allow domain** for each.
3. The first time you open the **Homes.com** tab, Tampermonkey may ask again for **homes.com**. Click **Always allow domain**.
4. When the Homes.com window pops up with **"Gathering Homes.com info for Vici. Please wait."**, leave it open. It closes by itself in a few seconds.

### No exact match?
If a site can't find the lead's exact address, the tab lists close matches in the same State and ZIP. Click the right one. All the other tabs switch to that home too. A banner reminds you it's a close match, so confirm the address with the borrower.

### What the tab dots mean
- **Green** – info loaded, click the tab.
- **Orange** – the site couldn't be read automatically. The tab shows public records and an **Open on…** button.

### Troubleshooting
- **No tabs at all:** redo step 2 (Allow User Scripts), then press **Ctrl+F5** on Vici.
- **Homes.com tab keeps loading or says it couldn't load:** check step 4 (pop-ups), and don't close the small Homes.com window.
- **Tab says it hit a bot check:** click **Open on Zillow** (or Trulia), complete the check once, and the next lead fills in.

### Updates
Nothing to do. Tampermonkey installs new versions on its own (about once a day), and they show up the next time Vici loads. Agents never need to open Tampermonkey.
