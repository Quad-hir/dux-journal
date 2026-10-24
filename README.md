# The Dux Journal — v0.2

A mobile-friendly, manual-first trading journal web app. It is built around a six-qualifying-closed-trade experiment with a minimum 1:3 planned reward-to-risk ratio (higher ratios such as 1:3.5 also qualify) and a 1% risk cap calculated from the fixed starting balance.

## Features in this build
- Onboarding and account baseline setup.
- Fixed starting-balance risk base and visible 1% cash risk cap.
- Editable trading watchlist (preloaded with XAUUSD, XAGUSD, EURAUD, GBPUSD, EURUSD, AUDUSD and USDCHF).
- Setup form with LONG/SHORT, MARKET/LIMIT/STOP, timeframe, entry, SL, TP, cash risk, rationale and pre-trade checklist.
- Calculated RR and validation for price structure, risk cap, minimum 1:3 RR requirement, rationale and checklist completion.
- Manual lifecycle: PLANNED → VALIDATED → PENDING → OPEN → CLOSED, plus CANCELLED/EXPIRED.
- Manual confirmed fill, actual initial cash risk, floating P/L snapshots, closing price, gross P/L, costs, net P/L and close reason.
- Event history and rule-breach feedback.
- Account ledger: starting balance, realised balance, equity, return, floating P/L, realised R, win rate, expectancy, compliance and observed drawdown.
- Daily journal with emotional state, missed setups, lessons and next-session plan.
- Six qualifying closed trades trigger a required review; old trades remain in the journal when a new cycle starts.
- JSON backup/restore and CSV trade export.
- Responsive desktop and mobile layouts; browser local-storage persistence.

## Run locally
Requires Node.js 20+ and npm.

```bash
npm install
npm run dev
```

Open the local URL printed by Vite. To verify and build for deployment:

```bash
npm test
npm run build
npm run preview
```

## Data and safety notes
- Data is stored in the current browser's local storage. Use JSON backup regularly; clearing browser data can delete the local journal.
- This version has no user authentication, cloud sync, live market data, broker integration or automatic price monitoring.
- Trade fills and P/L are entered manually. Do not mark a limit order as filled just because price touched the entry; confirm the execution in your broker first.
- Position size is recorded, not calculated generically. Instrument contract specifications, tick value, account currency, and broker rules must be known before reliable automated sizing can be added.
- A planned RR of at least 1:3 does not guarantee +3R after fees, slippage, partial exits or manual closes.
- The 1% cap applies to planned cash risk against the original fixed starting balance. Actual realised outcomes can differ.
- Six trades are a small process experiment, not evidence of long-term profitability.


## Local sign-in and creator branding

The app now starts with an interactive sign-in/create-account screen. Each locally registered email gets a separate browser-local journal store; signing out and back in restores that profile on the same browser. The journal starts blank for a new profile, and the user enters their own starting balance and daily journal entries. A Gothic-style “Created by Dux” watermark and WhatsApp contact link (09150538944, Kogi) are shown in the interface.

**Authentication limitation:** this is a frontend prototype, not production multi-user authentication. Profile records and journal data remain in the browser's local storage and do not sync to another device or provide server-side account security. For a public multi-user release, connect a backend such as Supabase/Firebase or a custom API with server-side password hashing, authorization, and per-user database rows before collecting real user accounts.
