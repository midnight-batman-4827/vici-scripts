# PitchPoint – Privacy Policy

_Last updated: November 27, 2026_

PitchPoint is an internal tool for MortgageUSA employees. It runs only on MortgageUSA's VICIdial pages (`mtgusa.talkitpro.com`) and, as an optional helper, on `www.homes.com`.

## What it reads
- The lead open on the VICIdial agent screen: name, phone, property address and loan fields.
- What the user types into PitchPoint's pitch sheet and disposition screen.
- The user's VICIdial user name and ID (used only on screen).

## What it does with it
- **Property lookups:** the lead's property address is sent to Zillow (and Realtor.com's and Move's public address services) to look up and match public property details. Only the address is sent.
- **Send to Team Lead:** only when the user clicks **Send**, the pitch sheet (a PDF and a short summary) is sent to MortgageUSA's own Microsoft 365 workflow (Power Automate), which saves it in MortgageUSA's private SharePoint site and messages the chosen team lead in Microsoft Teams. The SSN and the agent's name are never included. The workflow's run history records which company account sent each sheet.
- **Fallback:** if Teams sending isn't available, the PDF downloads to the user's computer and a Teams chat or Outlook email opens for the user to send.
- **Screen layout:** PitchPoint rearranges and restyles VICIdial screens on the user's own computer.

## Microsoft sign-in
- The user signs in in Microsoft's own window; PitchPoint never sees or stores the password.
- Microsoft issues a sign-in token (about an hour). It's kept only in the browser's memory, inside the extension, and is erased when the browser closes.
- The user's work email is saved on that computer to pre-fill the next sign-in.

## What it stores (on the user's computer only)
- Display choices (theme, view, animation), the last team lead picked, the day's call counts, the current property lookup, and the user's acceptance of these terms.
- The pitch sheet clears on the next call and is not stored.

## What it doesn't do
- No analytics, tracking or advertising. No selling or sharing of data.
- Nothing is sent to the developer or to anyone other than the property sites above and MortgageUSA's own Microsoft 365.
- It doesn't read any other website or any other part of the browser.

## Questions
Contact MortgageUSA management.
