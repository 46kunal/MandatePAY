# eval/

Owner: B. A small labelled set of dispute cases (mandate, cart, dispute text, tracking, expected fault and action)
used to measure the analyst. Report accuracy in the README and the demo video.

## Files

- `cases.json`: 28 labelled cases. Each has the dispute reason, tracking, amount, messages, the mandate constraints, the cart, and `expect` (`fault`, a list of acceptable `action`s, and optionally `needs_human`).
- `run.ts`: scores them. `npm run eval` prints the summary and the failures; `npm run eval -- --verbose` lists every case.

## Labelling rules

Labels say what the right answer is, not what any model outputs. Do not edit a label to make a run pass. Add a case instead.

- `merchant`: not delivered, damaged, counterfeit, or a different item from the cart was shipped.
- `agent`: the cart fitted the mandate but was the wrong product, or the cart contradicted the mandate.
- `buyer_regret`: delivered, matches the listing and the mandate, buyer just changed their mind or disputes a signed purchase.
- `unclear`: the ledger cannot settle it. These must also set `needs_human`.
