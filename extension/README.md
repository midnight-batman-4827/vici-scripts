# Mortgageusa Property Lookup – Edge extension

The same tool as the Tampermonkey script, packaged as a Microsoft Edge extension, so it can be installed on every agent's PC with no Tampermonkey and no clicks.

- **Upload file:** `dist/mortgageusa-property-lookup-<version>.zip`
- **Store images:** `extension/store/` (logo and screenshots, sample data only)
- **Privacy policy URL:** https://github.com/midnight-batman-4827/vici-scripts/blob/main/PRIVACY.md

---

## Step 1 – Submit it in Partner Center (one time)

1. Go to https://partner.microsoft.com/dashboard/microsoftedge/overview and click **Create new extension**.
2. **Packages:** upload `mortgageusa-property-lookup-<version>.zip`.
3. **Availability:**
   - **Visibility: Hidden.** Only people with the direct link (or IT policy) can install it. It won't show up in searches.
   - **Markets:** United States.
4. **Properties:**
   - Category: **Productivity**
   - Privacy policy: **Yes**, URL above
   - Website: https://github.com/midnight-batman-4827/vici-scripts
5. **Store listing (English):** paste the text below. Upload `store-logo-300.png` as the logo and the two screenshots.
6. **Submit.** Microsoft's review usually takes a few business days. You'll get an email when it's live.
7. When it's live, copy the **Extension ID** (32 letters) from the extension's page in Partner Center. You need it for step 2.

### Store listing text

**Description**
> Internal tool for Mortgageusa employees, for Mortgageusa's VICIdial system only. It gives the VICIdial agent screen a modern layout with themes, a pitch sheet, an improved disposition screen and an opening animation, and adds a "Property at a glance" card and a Property tab with the lead's home value, sale and tax history and loan-to-value, looked up on Zillow. Loan officers can send a finished pitch sheet as a PDF to their team lead in Microsoft Teams through the company's own Microsoft 365. It also restyles Mortgageusa's VICIdial admin pages. It does nothing on other sites.

**Short description**
> Modern agent screen, pitch sheet and property facts for Mortgageusa's VICIdial system.

### Notes for certification (paste in the "Notes for certification" box)
> This is a hidden, internal tool for Mortgageusa employees. It runs on our VICIdial system at mtgusa.talkitpro.com (login required, so it can't be tried without a Mortgageusa account) and declares www.homes.com only for its address helper. All code is included in the package; nothing is loaded remotely. Host permissions: zillow.com, zillowstatic.com and parser-external.geo.moveaws.com look up the lead's property address; realtor.com and trulia.com are used for address matching and links. powerplatform.com and logic.azure.com are our own Microsoft 365 Power Automate workflow: only when the user clicks "Send to Team Lead", the pitch sheet PDF is sent there, saved in our private SharePoint and posted to the team lead in Teams. The workflow address is set by our IT through Edge policy (managed storage, schema included). No other data is collected or sent anywhere.

---

## Step 2 – Push it to every PC (IT, one time)

Edge policy **"Control which extensions are installed silently"** (`ExtensionInstallForcelist`) installs it for everyone. Agents can't turn it off or remove it, and it updates on its own.

The value is (replace `EXTENSION_ID` with the ID from step 1.7):
```
EXTENSION_ID;https://edge.microsoft.com/extensionwebstorebase/v1/crx
```

**Pick the way your PCs are managed:**

- **Intune:** Devices → Configuration → Create → Windows 10 and later → **Settings catalog** → add **Microsoft Edge → Extensions → Control which extensions are installed silently** → Enabled → add the value above → assign to the agents' device group.
- **Group Policy (domain PCs):** with the Edge administrative templates installed: Computer Configuration → Administrative Templates → Microsoft Edge → Extensions → **Control which extensions are installed silently** → Enabled → Show… → add the value above.
- **No IT management (each PC on its own):** edit `force-install-edge.reg` in this folder (put in the real ID), copy it to each PC, double-click it and approve (needs an admin login). Restart Edge.

Within a few minutes of Edge restarting, the extension appears and the property tabs show on Vici.

### After it's on every PC
- **Pop-ups:** still allow pop-ups for `[*.]talkitpro.com`, for the Homes.com window. IT can do this with the policy **"Allow pop-up windows on specific sites"** (`PopupsAllowedForUrls`) set to `[*.]talkitpro.com`.
- **Tampermonkey:** can be removed. If a PC still has both, the Tampermonkey copy steps aside automatically, so agents never see two sets of tabs.

---

## Updating it later

1. Change `vici-property-lookup.user.js` (that stays the one source of truth).
2. Run `python3 build-extension.py`. It writes a new zip to `dist/` using the script's `@version`.
3. Partner Center → the extension → **Update** → upload the new zip → Submit.
4. After review, every PC picks up the new version on its own (Edge checks every few hours).
