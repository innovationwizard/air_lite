-- Add AI/ML tables for Dagster pipeline
-- Generated from Prisma schema

-- Create kpis table
CREATE TABLE IF NOT EXISTS "kpis" (
    "kpi_id" SERIAL PRIMARY KEY,
    "kpi_name" VARCHAR(100) NOT NULL,
    "kpi_value" DECIMAL(15, 4) NOT NULL,
    "period" VARCHAR(50) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW()
);

-- Create forecasts table
CREATE TABLE IF NOT EXISTS "forecasts" (
    "forecast_id" SERIAL PRIMARY KEY,
    "product_id" INTEGER NOT NULL,
    "sku" VARCHAR(100),
    "forecast_date" TIMESTAMPTZ(6) NOT NULL,
    "predicted_demand" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW()
);

-- Create recommendations table
CREATE TABLE IF NOT EXISTS "recommendations" (
    "recommendation_id" SERIAL PRIMARY KEY,
    "product_id" INTEGER NOT NULL,
    "sku" VARCHAR(100),
    "recommended_quantity" INTEGER NOT NULL,
    "confidence" DECIMAL(3, 2) NOT NULL,
    "reason" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW()
);

-- Create insights table
CREATE TABLE IF NOT EXISTS "insights" (
    "insight_id" SERIAL PRIMARY KEY,
    "insight_type" VARCHAR(50) NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "description" TEXT NOT NULL,
    "value" DECIMAL(15, 4),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW()
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS "idx_kpis_name" ON "kpis"("kpi_name");
CREATE INDEX IF NOT EXISTS "idx_kpis_period" ON "kpis"("period");
CREATE INDEX IF NOT EXISTS "idx_forecasts_product" ON "forecasts"("product_id");
CREATE INDEX IF NOT EXISTS "idx_forecasts_date" ON "forecasts"("forecast_date");
CREATE INDEX IF NOT EXISTS "idx_recommendations_product" ON "recommendations"("product_id");
CREATE INDEX IF NOT EXISTS "idx_insights_type" ON "insights"("insight_type");
CREATE INDEX IF NOT EXISTS "idx_insights_created" ON "insights"("created_at");
