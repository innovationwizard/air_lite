# Critical Concerns / Second Round of Questions

**1. Holding Cost Rate**

The storage savings calculation needs a holding cost rate (% of inventory value per month). Industry standard for plastics/disposables in tropical climates is ~25-30% annually (~2.0-2.5% monthly). Do you know PLASTICENTRO's actual warehousing costs (rent, insurance, utilities, shrinkage)? If not, I'll use 25% annually as a conservative estimate and clearly label it as an assumption in the backtest output.
→ Surface this to the user in the clearest way possible, for example: "I'm using a holding cost rate of 25% because..." line break, and "Input your real holding cost rate here to re-calculate for your specific case: "

**2. Python Runtime on Vercel/Supabase**
The backtest engine requires Python (Prophet, pandas, numpy). Two options:

Option A: Supabase Edge Functions (Python runtime) — keeps everything in one platform

Option B: Vercel Serverless Functions with Python runtime — proven, 300s max execution time

Option C: A small separate Python service (e.g., Railway, Fly.io) — more ops, but no execution time limits

Prophet model training on 3-6 months of daily data for ~1,654 products could take 1-10 minutes depending on how many products qualify. Vercel's 300s limit could be tight. Do you have a preference, or should I design for Option C as fallback?

→ Railway because no execution time limits is of critical importance. 

**3. Historical Inventory Reconstruction Accuracy**
We have a point-in-time stock.quant snapshot (2026-03-03) and ~967K stock.move records. I'll reconstruct daily inventory by working backwards from the snapshot. However, the reconstruction is only as accurate as the stock.move data — if any moves are missing or miscoded (wrong location), the historical levels will drift. I plan to build a validation step that cross-checks the reconstruction against the snapshot. Is this acceptable, or do you have additional inventory validation data?
→ I do not have any additional information. Do the best with what we have. 

**4. The account.move.line_2026.xlsx File**
All other data is CSV, but the 2026 accounting entries are in Excel format. I need to decide: convert it to CSV manually, or add an Excel parser to the ingestion pipeline. Should I add xlsx support, or will you export it as CSV from Odoo?
→ Convert it to csv with the most reliable python tools.

**5. Minimum Viable Backtest**
With data starting Oct 2024, the first backtest cycle trains on Oct-Dec 2024 (3 months) and predicts Jan 2025. That's only ~90 days of training data. For many products, that won't be enough observations for a reliable Prophet model. My plan handles this by:

Requiring >= 30 non-censored daily observations per product
Falling back to category-level aggregate models for products with insufficient data
Reporting coverage metrics transparently
Is this approach acceptable? The alternative is requiring more training months before the first prediction, which would reduce the total number of backtest cycles available.
→ The real use by real people in real life, the model will be trained with all the data available in real_data/ , thus the real reliability of the app is not at great risk. 
→ For the backtest, it's not required to have all the products in scope. We can actually run the backtest on a selected reduced number of products that best qualify for training. For example, order all products by top product, and select the first 100 products that have sufficient observations for a reliable Prophet model, and surface clearly to the user which products are being included AND WHY. 

**6. Feature Scoping — ABC Classification**
The research shows ABC classification is one of the most requested features by Odoo users. I've included it in air_lite. ABC by revenue contribution is straightforward. Should I also include XYZ (demand variability), or defer that to air_prime? XYZ needs more data to be statistically meaningful.
→ Include XYZ, clearly surfacing to the user how statistically meaningful the displayed result is, based on the available data. 