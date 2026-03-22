import os
import psycopg2
from psycopg2.extras import RealDictCursor
from datetime import datetime, timedelta

def run():
    print("Starting AI Refill aggregation pipeline...")
    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        raise ValueError("DATABASE_URL not set")
    
    # Remove ?schema=public from URL
    if '?schema=' in database_url:
        database_url = database_url.split('?')[0]
    
    conn = psycopg2.connect(database_url)
    cur = conn.cursor(cursor_factory=RealDictCursor)
    
    try:
        # Clear existing data for fresh run
        print("Clearing existing aggregation data...")
        cur.execute("TRUNCATE TABLE recommendations, forecasts, insights, kpis RESTART IDENTITY CASCADE")
        
        # Get date range of actual data
        cur.execute("SELECT MIN(sale_datetime) as min_date, MAX(sale_datetime) as max_date FROM sales_partitioned")
        date_range = cur.fetchone()
        print(f"Processing data from {date_range['min_date']} to {date_range['max_date']}")
        
        # Generate recommendations based on historical averages
        print("Generating recommendations...")
        cur.execute("""
        INSERT INTO recommendations (product_id, sku, recommended_quantity, confidence, reason)
        SELECT 
            p.product_id,
            p.sku,
            GREATEST(COALESCE(AVG(s.quantity)::INTEGER * 1.5, 50), 10) as recommended_qty,
            CASE 
                WHEN COUNT(s.product_id) > 100 THEN 0.95
                WHEN COUNT(s.product_id) > 50 THEN 0.85
                ELSE 0.75
            END as confidence,
            'Based on ' || COUNT(s.product_id) || ' historical sales'
        FROM products p
        LEFT JOIN sales_partitioned s ON s.product_id = p.product_id
        GROUP BY p.product_id, p.sku
        """)
        
        # Generate forecasts using recent 90 days average
        print("Generating forecasts...")
        cur.execute("""
        INSERT INTO forecasts (product_id, sku, forecast_date, predicted_demand)
        SELECT 
            p.product_id,
            p.sku,
            %s::date + interval '1 day' * generate_series(1, 30),
            GREATEST(COALESCE(AVG(s.quantity)::INTEGER, 10), 5)
        FROM products p
        LEFT JOIN sales_partitioned s ON s.product_id = p.product_id
            AND s.sale_datetime >= %s::date - interval '90 days'
        GROUP BY p.product_id, p.sku
        """, (date_range['max_date'], date_range['max_date']))
        
        # Generate insights from actual data patterns
        print("Generating insights...")
        
        # Top selling products
        cur.execute("""
        INSERT INTO insights (insight_type, title, description, value)
        SELECT 
            'top_performer',
            'Top Selling Product',
            p.sku || ' leads with ' || SUM(s.quantity) || ' units sold',
            json_build_object(
                'product_id', p.product_id,
                'sku', p.sku,
                'total_quantity', SUM(s.quantity),
                'total_revenue', SUM(s.quantity * s.unit_price)
            )::jsonb
        FROM sales_partitioned s
        JOIN products p ON p.product_id = s.product_id
        GROUP BY p.product_id, p.sku
        ORDER BY SUM(s.quantity) DESC
        LIMIT 1
        """)
        
        # Sales trend
        cur.execute("""
        WITH monthly_sales AS (
            SELECT 
                DATE_TRUNC('month', sale_datetime) as month,
                SUM(quantity * unit_price) as revenue
            FROM sales_partitioned
            WHERE sale_datetime >= %s::date - interval '2 months'
            GROUP BY 1
            ORDER BY 1 DESC
            LIMIT 2
        )
        INSERT INTO insights (insight_type, title, description, value)
        SELECT 
            'sales_trend',
            'Sales Trend',
            CASE 
                WHEN COUNT(*) = 2 AND MAX(revenue) > MIN(revenue) THEN 
                    'Sales increased ' || ROUND(((MAX(revenue) - MIN(revenue)) / MIN(revenue) * 100)::numeric, 1) || '%% month-over-month'
                ELSE 'Insufficient data for trend analysis'
            END,
            json_build_object(
                'latest_month_revenue', MAX(revenue),
                'previous_month_revenue', MIN(revenue)
            )::jsonb
        FROM monthly_sales
        """, (date_range['max_date'],))
        
        # Generate KPIs from historical data with 0 fallbacks
        print("Generating KPIs...")
        
        # Check if we have cost data
        cur.execute("SELECT COUNT(*) FROM products WHERE cost IS NOT NULL AND cost > 0")
        has_cost_data = cur.fetchone()['count'] > 0
        
        # Gross Margin Percentage
        if has_cost_data:
            cur.execute("""
            WITH margin_data AS (
                SELECT 
                    SUM(s.quantity * s.unit_price) as total_revenue,
                    SUM(s.quantity * COALESCE(p.cost, 0)) as total_cogs
                FROM sales_partitioned s
                JOIN products p ON p.product_id = s.product_id
                WHERE s.sale_datetime >= %s::date - interval '1 year'
            )
            INSERT INTO kpis (kpi_name, kpi_value, period)
            SELECT 
                'gross_margin_percentage',
                CASE 
                    WHEN total_revenue > 0 AND total_cogs > 0 THEN 
                        ROUND(((total_revenue - total_cogs) / total_revenue * 100)::numeric, 2)
                    ELSE 0
                END,
                'annual'
            FROM margin_data
            """, (date_range['max_date'],))
        else:
            print("WARNING: No cost data available - setting gross_margin_percentage to 0")
            cur.execute("""
            INSERT INTO kpis (kpi_name, kpi_value, period)
            VALUES ('gross_margin_percentage', 0, 'no_cost_data')
            """)
        
        # Check if we have inventory snapshots
        cur.execute("SELECT COUNT(*) FROM inventory_snapshots")
        has_inventory_data = cur.fetchone()['count'] > 0
        
        # Inventory Turnover
        if has_cost_data and has_inventory_data:
            cur.execute("""
            WITH cogs_data AS (
                SELECT SUM(s.quantity * COALESCE(p.cost, 0)) as annual_cogs
                FROM sales_partitioned s
                JOIN products p ON p.product_id = s.product_id
                WHERE s.sale_datetime >= %s::date - interval '1 year'
            ),
            inventory_data AS (
                SELECT AVG(i.quantity_on_hand * COALESCE(p.cost, 0)) as avg_inventory_value
                FROM inventory_snapshots i
                JOIN products p ON p.product_id = i.product_id
                WHERE i.snapshot_timestamp >= %s::date - interval '1 year'
            )
            INSERT INTO kpis (kpi_name, kpi_value, period)
            SELECT 
                'inventory_turnover',
                CASE 
                    WHEN avg_inventory_value > 0 THEN 
                        ROUND((annual_cogs / avg_inventory_value)::numeric, 2)
                    ELSE 0
                END,
                'annual'
            FROM cogs_data, inventory_data
            """, (date_range['max_date'], date_range['max_date']))
        else:
            print("WARNING: Missing cost or inventory data - setting inventory_turnover to 0")
            cur.execute("""
            INSERT INTO kpis (kpi_name, kpi_value, period)
            VALUES ('inventory_turnover', 0, 'insufficient_data')
            """)
        
        # Holding Cost
        if has_inventory_data and has_cost_data:
            cur.execute("""
            WITH inventory_value AS (
                SELECT AVG(i.quantity_on_hand * COALESCE(p.cost, 0)) as avg_inventory_value
                FROM inventory_snapshots i
                JOIN products p ON p.product_id = i.product_id
                WHERE i.snapshot_timestamp >= %s::date - interval '1 year'
            )
            INSERT INTO kpis (kpi_name, kpi_value, period)
            SELECT 
                'holding_cost',
                CASE
                    WHEN avg_inventory_value > 0 THEN
                        ROUND((avg_inventory_value * 0.25)::numeric, 2)
                    ELSE 0
                END,
                'annual'
            FROM inventory_value
            """, (date_range['max_date'],))
        else:
            print("WARNING: No inventory or cost data - setting holding_cost to 0")
            cur.execute("""
            INSERT INTO kpis (kpi_name, kpi_value, period)
            VALUES ('holding_cost', 0, 'no_inventory_data')
            """)
        
        conn.commit()
        print("Pipeline completed successfully!")
        
    except Exception as e:
        print(f"Error: {e}")
        conn.rollback()
        raise
    finally:
        cur.close()
        conn.close()

if __name__ == "__main__":
    run()