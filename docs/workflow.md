# Tire Shop Workflow — Agreed Design (v1)

## Customers & vehicles
- Customer: first name and phone are required (the phone is how we call when orders arrive); last name is optional, since walk-ins often give one name. Search matches either name or the phone, case-insensitive. A duplicate phone warns; it does not block (people change numbers).
- Customer can be flagged **has account** (a few business customers).
- A customer has many vehicles. Required: year, make, model. Optional: license plate, VIN, tire size (filters inventory on the quote screen).
- Vehicle: **class** (car | truck), plus checkboxes **lifted/lowered** and **luxury/multi-link suspension**.

## Tickets: quote → work order → invoice
- One record that moves through `quote → declined | work_order → invoiced`. One customer and one vehicle per ticket (two cars = two quotes).
- Work order → quote is allowed only before any work item has started, nothing has been ordered past "needs ordering", and any deposit has been refunded. Invoiced tickets are locked.
- Numbering: `Q-####` for quotes; work orders keep the quote number (`WO-####`); invoices get their own **gap-free** sequence (`INV-####`), assigned only when the invoice is created.
- Prices are **copied onto each line when it's added**. Later catalog or settings price changes never alter existing tickets. Editing a work item keeps each line's price unless what it's priced from changed (a different tire, or a car that's now lifted); "Reset price" refreshes one line from the catalog on purpose.
- Quotes are valid for 7 days (setting). Accepting after that shows a warning only, no automatic price refresh.
- A ticket is made of **work items**: `tires | alignment | mechanic | other`. Each work item holds line items and has a status `pending | completed | not_performed`. Items marked `not_performed` stay on the work order for history but are left off the invoice. Marking a Tires item not performed releases its reserved tires.
- **Finished work can't be changed**: once a work item is done or not performed, its lines can't be added, edited or removed (its stock and orders are settled). Further work goes in a new work item.
- Discounts are **per line**, either `$` or `%`. A discount on a product line lowers the amount that's taxed.
- **Costs are never shown** on the quote, work order or invoice. They appear only on internal screens, including a margin view for the advisor.

## Pricing rules

Every price, rate and time below is a Setting (the `settings` table, edited on the Settings screen). A new database starts them at 0, so a shop enters its own before quoting. The rules are what the app does with them.
| Item | Rule |
|---|---|
| Tax | Tax rate (Setting) on products only (tires, rims, sensors, mechanic parts). Services, labor, disposal fees and valve stems are not taxed. |
| Car vs. truck tire | From tire size: LT- or ST- (trailer) prefixed, or flotation (e.g. `35x12.50R20`) = truck; otherwise car. Override per product. |
| Low-profile | aspect ratio ≤ 45, derived from size |
| Oversized | overall diameter ≥ 33", derived from size (so LT275/70R18 at 33.2" counts) |
| Mount & balance | Car-tire / truck-tire price; plus a surcharge if low-profile or oversized |
| Disposal | Disposal fee per old tire removed (none for bare rims), not taxed |
| Valve stems | Free when tires are bought here (new or used); the customer-supplied stem price each when the customer brings their own tires; trailer stems at their own price, added by hand. Not taxed (an add-on charge) |
| TPMS | Single-sensor price for one sensor; a lower 2+ price each when the car gets 2 or more (counted across the whole ticket, not per line); reset alone with the customer's own sensors has its own price. One universal sensor product, min stock 8. Each sensor line keeps the two prices from when the first sensor went on the ticket, so changing Settings never re-prices an existing ticket. On a quote the price follows the count both ways; once accepted it only goes down: if a sensor job is not performed, the others keep the 2+ price the customer agreed to (the advisor explains the difference). Resetting a hand-entered price gives the standard price for the sensors on the ticket now. |
| Alignment | Car / truck price (by **vehicle** class); plus one surcharge if lifted/lowered or luxury/multi-link (not stacking) |
| Used tires | Default car / truck price per tire, editable per line for condition |
| Mechanic | Labor = hours × shop rate. Parts (on Mechanic or Alignment items, e.g. a camber kit) are free-text lines with internal cost and supplier list price (charged, no markup) |
| Rims / one-offs | Custom taxable line in an Other work item, no inventory |

A Tires work item has a **customer-supplied tires** checkbox (removes tire products, switches valve stems to the customer-supplied stem price, and sets the disposal fee per old tire removed).

## Inventory, reservations & orders
- Stocked items (tires, TPMS sensors) have `condition` (new/used), `stocked`, `min_qty`, and an optional `supplier` that's copied onto pending orders as the vendor.
- The **Inventory** page adds and edits products, records stock received outside an order, and records a shelf count (on hand can't go below what's reserved). Every change is kept in the stock history.
- **Supplier tires**: a tire we don't stock is a catalog product with `stocked = false` (0 on hand). On a quote, "Tire not listed? Add one from a supplier" creates it from the tires form; it's priced by its size like any tire, needs a deposit, and is ordered on acceptance. The tire picker lists every tire, matching sizes first.
- Quote shows availability → **acceptance reserves** → **completing the Tires work item consumes** the stock.
- When stock is short:
  - Stocked item: order `needed + min_qty − available` (e.g. 4 + 4 − 2 = 6), split into a customer portion and a restock portion.
  - Not stocked: order only the shortfall.
- Orders are created automatically when the customer accepts (and when work changes), straight into **Needs ordering**, so nothing depends on the advisor remembering to add them. The accept screen and a notice after accepting say what was added. The sidebar's Orders count includes what still needs ordering (plus customers to call), and Needs ordering shows when each was added, in red once it's older than today.
- **Pending Orders** is one list for tires, rims, sensors and mechanic parts: `needed → ordered → arrived → installed`, with vendor, order date, expected date, and quantity ordered vs. quantity arrived (partial deliveries).
- When items arrive: tires are added to stock and auto-reserved for their ticket. Tires, rims and parts for an alignment (a camber kit) are flagged **call customer**, with a log of each call attempt until the customer is marked notified. A mechanic work item shows **waiting on parts** until all its parts have arrived.
- **Low Stock page**: every stocked new item where available (on hand − reserved) < `min_qty`. Suggested quantity = `min_qty − available − restock already on order`; items fully covered by restock on order are still listed but marked covered. "Add to orders" (one item or the selected ones) adds to the product's open restock row in Pending Orders → Needs ordering. The nav shows a red count of items that still need ordering.
- **Deposits**: required for special orders only: tires we don't stock, and rims. Minimum deposit is a Setting, with an advisor override. A stocked tire that's temporarily out needs no deposit; if the customer walks, it simply becomes shelf stock.
- **Cancelling a supplier order** for a job that's still to be done (the supplier fell through): the job is refilled right away from the shelf, or put back under Needs ordering, so it's never left short. If the customer no longer wants the work, mark the job not performed instead.
- **Customer cancels a special order**:
  - Returnable: return to vendor, charge the return fee from the deposit, refund the rest.
  - Not returnable (rims are never returnable): keep the deposit; the item goes to an **unclaimed special orders** list. It never becomes regular stock.

## Shop floor
- A work order is **checked in** when the vehicle is at the shop (walk-ins are checked in automatically when they accept).
- A job joins its queue only when the car is checked in **and** nothing on that job is still to be ordered or on its way. Alignment also waits until the car's tires and mechanic work have everything in. A job that hasn't started leaves the line if something new has to be ordered for it, and joins the back of the line when the last order arrives.
- **Coming up** (on the Shop floor) lists accepted work that isn't on the floor: cars not here yet, and jobs waiting on orders. It's grouped Overdue / Today / Tomorrow / This week / Later by the **planned date** (optional, set at acceptance or later), or by when the orders are expected. None of it counts toward waits.
- Three queues: **Tires** (2 shared lifts), **Mechanic** (1 lift), **Alignment** (1 rack). A ticket joins the queue for each kind of work it has and holds its place in each.
- The next car taken is the **earliest one that's ready**. A car that isn't ready keeps its place. The advisor can override readiness and manually move a job to another lift.
- Alignment is ready when the car's Tires and Mechanic work items are completed or not performed ("Other" items don't hold it up). If the tech finds it needs a camber kit, the advisor adds the kit as a part on the Alignment item, ordered if needed; the alignment comes off the rack until it arrives, the customer is called, and it rejoins the line. Alignment queue states: `waiting → on_rack → done | removed | suspension_issue`.
- Suspension issue: the alignment work item becomes not performed with the reason recorded. A "follow-up quote" button is available; using it is up to the advisor.
- Whether mechanic work needs an alignment is the advisor's call. Nothing adds it automatically.
- Wait estimates (also shown at quote time), all erring high:
  - Alignment: 30 min × every car ahead.
  - Tires: total minutes ahead ÷ 2 lifts. Each job is 30 min for a car or 40 min for a truck (per 4 tires, one tech), + difficulty 0/10/20 (+10 by default for low-profile or oversized). Fewer tires scale down, never below 15 min.
  - Mechanic: labor hours of the jobs ahead. A job with no labor entered yet counts as 1 hour.
  - Every estimate also adds the time left on cars already on a lift.
- A car can only be on one lift at a time; its other jobs wait until it comes off.
- Done on a Tires job takes its tires and sensors out of stock and marks special-order items installed. A job can't be marked done while anything on it is still on order.
- Not performed releases reserved stock and cancels items not yet ordered. Items already ordered or arrived need a decision on the Orders page (return or unclaimed).
- One **Shop Floor** screen shows every lift and every queue.

## Invoicing & payments
- A work order can be invoiced once every work item is done or not performed and no special order is still open (needed, ordered or arrived without a decision).
- The invoice is created when the customer pays: total + return fees − deposits. Methods: cash, card, other, and a payment can be split across methods.
- The invoice number (`INV-####`, from 5001) is assigned in the same transaction, so a failed checkout never burns a number.
- Extra deposits and refunds can be recorded while the work order is open (e.g. a special order added later). Going back to a quote needs any deposit refunded first.
- When the deposit is more than what's owed (the customer cancelled), the rest is refunded at invoicing. If a special order was left **unclaimed**, the advisor can keep the deposit instead.
- Account customers can use **charge to account** (all of it, or the rest after a partial payment): the invoice stays `unpaid` until payments bring the balance to zero. The **Accounts** page lists what each account customer owes, oldest invoices flagged after 30 days.
- Invoiced tickets are locked.
- Not built yet: appointments beyond the optional planned date.

## Printing (PDF)
- Quotes, work orders and invoices print as a PDF made on the server (`GET /api/tickets/:id/pdf`, `?download=1` to save). The ticket screen has **Print** (opens in a new tab) and **Download PDF**.
- Printed: shop name, address and phone (from Settings), document number and dates, customer, vehicle (plate and VIN), lines grouped by work item with discounts, subtotal, tax and total. Work orders and invoices also show return fees, kept deposits, every deposit/payment/refund and the balance; invoices are stamped PAID or CHARGED TO ACCOUNT. Quotes print the price-guarantee date.
- Never printed: costs, margins, internal notes, and work items marked not performed.
- Shop details live in `settings` (`shop_name`, `shop_address` with line breaks, `shop_phone`, `invoice_footer`).

## Vehicles, tire catalog and comparison (agreed and built Nov 2026)

### Vehicle record
- Required: year, make, model. Optional: trim, drive type (`2WD | AWD | 4WD | unknown`, default unknown), front tire size, rear tire size (staggered setups), plate, VIN.
- Special-tire flags: **EV**, **heavy-duty truck**, **run-flat equipped**, each with optional required load index (or load range for LT) and speed rating, entered from the placard or old tire.
- Blank means unknown. Nothing is filled in automatically, and where a size came from isn't tracked: phone quotes carry the customer's word, and the advisor checks the plate or door when in doubt.
- Exact trim and factory size come from the advisor's own lookups (O'Reilly, supplier site); the app doesn't integrate with them.
- Optional **Decode VIN** button (free NHTSA vPIC web service, called through the API): suggests year, make, model, trim, car/truck, drive type, the EV flag (electric fuel type) and the heavy-duty flag (GVWR class 2H and up, e.g. F-250). Suggestions for blank fields are pre-ticked; anything that would change an entered value starts unticked; nothing is applied until the advisor clicks Apply. If the service can't be reached the form works as usual. vPIC has no tire sizes.
- **New quote** finds the customer, or adds a new customer (first name, phone, optional last name; warns if the phone is already on file) and their vehicle right in the same dialog, or adds another vehicle to an existing customer, then starts the quote.

### Tire catalog
- **Tire line** (brand + model), entered once: tread photo (stored in the database, resized to ~800px on upload), **type** (touring, performance, highway, all-terrain, rugged-terrain, mud-terrain), **season** (all-season, all-weather, summer, winter), warranty miles, road hazard included, run-flat, EV, 3PMSF (severe snow).
- **Per-size product** (existing products table): size, load index, speed rating, load range (LT), XL, and from supplier data: tread depth, UTQG (treadwear, traction, temperature), max load (lb @ psi), sidewall code, the other size name (e.g. 33X12.50R20LT for LT285/55R20, so either finds it), and a warranty when the size's differs from the line's (some brands set warranty by speed rating). Cost and price may be blank, so the catalog holds tires that are neither stocked nor priced yet.
- Entered by hand or imported from a supplier file (below); adding a new size of an existing line pre-fills the line's details (lines are matched by brand + model, ignoring case, and created automatically with the first size). Pasting a sidewall string into Size ("LT265/70R17 121/118S E") fills the size, load indexes, speed rating, load range and XL.
- Inventory has two tabs: **Products & sizes** (opens on "On the shelf"; with a Cost action for today's cost) and **Tire lines** (photo, type, season, warranty, features; renaming a line renames every size).

### Supplier catalog files (built Nov 2026)
- Drop the file in `data/imports/` (not committed to git) and run, in `apps/api`: `npm run import-tires -- data/imports/tire-catalog.csv` to see what would change, then the same with `--apply` to save. `DB_NAME=tireshop` in front for the real database.
- CSV or tab-separated with a header row. Column names are matched loosely; brand, model and size are required. Known columns: type, season, warranty (`60k`, `none`), road hazard, size alt, service index (`121/118Q`), LR/PR (`XL`, `SL`, `E/10`), sidewall, tread depth (`10/32`), max load (`1047@44`), UTQG (`540 A B`). Category is ignored (car or truck comes from the size). Rows it can't read are skipped and listed; cells it can't read are left blank and listed.
- Supplier wording → our fields: Performance → performance; All Season → touring; All-Season Highway → highway; All-Terrain → all-terrain; Rugged-Terrain → rugged-terrain; Mud Terrain → mud-terrain. Season "Snow Traction" = 3PMSF: all-weather on a road tire, all-season + severe snow on a terrain tire.
- Imported sizes are special-order tires with no stock, cost or price. The advisor enters the distributor's cost when quoting.
- Re-importing is safe: lines match by brand + model and sizes by size, so nothing is duplicated. Specs from the file update what's there (blank cells never erase); stock, cost, price, SKU and tickets are never touched; a line's type and season are only filled in when blank, so corrections made in the app stick; the app's spelling of a line name wins.
- A quote refuses a tire that has no price yet; the tires dialog asks for today's cost right there.
- A cost typed while quoting is saved with its date ("last cost $112 · Nov 5"). Price = cost × (1 + markup %), at least cost + minimum profit per tire, rounded up to .99. Markup and minimum profit are Settings and can be overridden on a quote. Stocked tires keep their own cost and price.

### Comparison ("Compare tires" on a quote)
- **Cheap / medium / premium** come only from **tires on the shelf** for the whole job (enough available for the quantity), at their real price: lowest, highest, nearest the middle. Fewer than three: show what there is. Alternate sizes are also shelf tires only.
- Everything else is listed under **Order in** (shelf tires we're short on first, then catalog tires A–Z). Distributor costs go stale, so an ordered-in tire only goes on a card when the advisor types **today's cost** and clicks Add (the last cost and its date are shown as a reminder, never used on their own). A cost entered earlier the same day counts. A shelf tire we're short on can be added at its shelf price. Costs per distributor are deliberately not kept.
- **+ From catalog** searches the whole tire catalog by brand, model or size (any size; 225/50ZR17 and 225/50R17 match the same) and adds the tire with today’s cost, or as it is if it’s on the shelf. A different size shows how much taller or shorter it is. **+ New tire** is for a tire that isn’t in the system yet: it’s saved to the catalog as a special-order tire.
- **Filters** in a column beside the cards that stays in view while scrolling: brand (type a few letters and pick; only brands the catalog has in this size or its similar sizes are suggested; picked brands show as tags), warranty (40k+ … 70k+), season (all-weather counts as all-season), type, load range as a minimum (SL → XL → C → D → E → F; "E" also shows F), max price per tire (only tires with a price), road hazard. Changing one refills the cards from what matches. Size always comes first: when nothing on the shelf meets every filter, the closest tires stay on the cards and each says what it misses ("Doesn't match: other brand"); the order-in list and similar sizes are narrowed the same way.
- **Typed request** above the controls: the advisor types what the customer asked for ("4 215/55r16 road hazard warranty above 40k", "pair of lt245/75r16 10 ply a/t $500 total") and Find tires sets the number of tires, the size, front/rear on staggered cars, and the filters. Plain rules, no AI service: sizes in any common spelling, brands from the catalog, warranty ("40k", "50,000 mi"), load ("LRE", "10 ply", "XL"), season and type words, and a budget per tire or for the set (a total is divided by the number of tires, before install). It shows what it read and lists any words it couldn't place so the advisor sets those by hand; nothing is guessed.
- Used tires on their own line; any slot can be swapped.
- Each card: tread photo, brand/model, size, load index, speed rating, type and season, warranty miles, treadwear (UTQG), tread depth, road hazard, max load and sidewall (advisor only), availability (in stock = same day, or order with the age of the cost), price per tire and **out-the-door total** for the quantity (tires, mount & balance, disposal, valve stems/TPMS, tax). Cost can be entered on the card. A **Customer view** hides costs and internal notes.
- **Alternate sizes**, listed after the exact-size options with the height difference ("+1.8%"): same rim diameter, width ±10 or aspect ±5, within 3% of the original overall diameter. On 2WD vehicles when replacing 2 (same axle) or 4 tires; on AWD/4WD (and unknown drive type) only when replacing all 4; never for a single tire.
- **Staggered** vehicles get a separate cheap/medium/premium per axle.
- **Flagged vehicles**: options that don't meet the required load/speed, or aren't EV-rated / run-flat as needed, get a warning (not hidden). If a flagged vehicle has no required values, a banner says to check the placard before quoting.
- **Pick** puts the tire on the quote's Tires item under the normal pricing and reservation rules.
- **Quoted options**: a Tires item can hold up to three options with prices locked for the quote's 7-day guarantee. The quote screen and PDF show all three with out-the-door totals; Pick chooses one (at the quoted price, even if the catalog has moved); Accept requires a pick. Options are quotes-only.
- Labels: the advisor sees Cheap / Medium / Premium; the Customer view and the PDF say Good / Better / Best.
- Out the door = tires + mount & balance + disposal of the same number of old tires + tax on the tires. TPMS sensors and other add-ons are added on the quote.

## Design system (agreed Nov 5 2026, not built yet)
- Own small system in plain CSS, no new libraries: design tokens as CSS variables (neutral palette, one accent, status colors only for meaning, 4–6px radii, 13–14px base text, a spacing scale) and ~10 shared components: Button, Badge, Table, Panel, PageHeader, Tabs, FormField, Modal, Toolbar, EmptyState.
- Direction: professional shop-management software (Shopmonkey as a reference for workflow, not to copy). Dense tables, clean forms and dialogs, clear hierarchy, responsive. No decorative cards, gradients, illustrations or needless animation.
- Rollout: (1) foundations with no intended visual change: tokens, shared components, and the shared styles moved out of page CSS into one `styles/` layer; (2) app shell: persistent left sidebar with badges, slim top bar, a URL per screen (hash routing) so refresh and Back work; (3) pages one at a time, replacing browser `prompt/confirm/alert` with proper dialogs.

## Status

All eight original build steps are done (Nov 2026), plus inventory management, supplier tires, Coming up, PDF printing, and the fixes from the first code review (with automated tests).

Next, in order:
1. ~~Design foundations, sidebar and URLs~~ (done)
2. ~~Settings screen~~ (done)
3. ~~Quote / work order screen moved to the new components and split into smaller files~~ (done)
4. ~~Vehicle fields and Decode VIN~~ (done, plus adding a customer and vehicle from New quote)
5. ~~Tire catalog (lines, per-size specs, photos, dated costs, cost → price)~~ (done)
6. ~~Comparison tool and quoted options (incl. alternate sizes and the PDF)~~ (done)
7. ~~Remaining pages moved to the new components~~ (done; no browser pop-ups left)
8. ~~Logins for the two service advisors~~ (done; see Logins below)

## Logins (built Nov 2026)
- Everyone signs in with a username and password. The very first visit, while there are no logins, asks for the **admin** login; after that nobody can create one without being an admin.
- Two roles. **Advisor**: everything in the shop (quotes, work orders, invoices, inventory, orders, accounts) and can view Settings. **Admin**: also changes Settings and manages logins (Settings → Logins: add, rename, change role, reset password, turn off). An admin can't remove their own admin access.
- Turning a login off or resetting its password signs that person out everywhere; changing your own password signs you out everywhere except where you changed it. Turned-off logins stay on past tickets by name.
- Sessions last 12 hours from the last thing done (a cookie). 8 wrong passwords for a username from one computer locks that username on that computer for 10 minutes (others, like the real admin at another computer, can still sign in). A wrong username and a wrong password get the same answer in the same time. Expired sessions are cleared whenever someone signs in. Passwords are at least 8 characters, stored as scrypt hashes.
- Every ticket records who **wrote** it, who **accepted** it and who **invoiced** it; every payment, call and stock movement records who did it. The ticket screen shows the names; work done before logins existed shows none.
- Forgot a password: the admin sets a new one. The admin forgot theirs and there's no other admin: on the server, `cd apps/api && DB_NAME=tireshop npm run admin-password -- <username>`.

## Running it for the shop network
1. Create the admin login first, on the server computer (open the app and follow the first-run screen) so nobody else on the network can claim it.
2. Build the web app once: `cd apps/web && npm run build`. The API then serves it, so one server runs everything.
3. Start the API: `cd apps/api && npm run build && HOST=0.0.0.0 DB_NAME=tireshop npm start`. The advisors open `http://<server computer's address>:3000`. Use `npm start` for the shop, not `npm run dev`: dev restarts on every code change, so work in progress would reach the advisors (and a new migration would be missing until it's run on `tireshop`).
4. After every update: stop the server, run new migrations on the real database (`DB_NAME=tireshop npm run migrate`), rebuild the web app (step 2), then step 3 again.
