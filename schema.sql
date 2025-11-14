-- BigQuery schema for Product Sets project
-- Project: cm-monitoring
-- Dataset: product_sets

-- ============================================================================
-- 1. Create Dataset
-- ============================================================================
CREATE SCHEMA IF NOT EXISTS `cm-monitoring.product_sets`
OPTIONS(
  location="US",
  description="Product sets data from Shoptet and ESO9"
);

-- ============================================================================
-- 2. Create products table
-- ============================================================================
CREATE TABLE IF NOT EXISTS `cm-monitoring.product_sets.products` (
  product_code STRING NOT NULL OPTIONS(description="Product code (primary key)"),
  product_id INT64 OPTIONS(description="Product ID from Shoptet feed"),
  name STRING OPTIONS(description="Product name"),
  url STRING OPTIONS(description="Product URL"),
  img_url STRING OPTIONS(description="Main product image URL"),
  short_description STRING OPTIONS(description="Short description (cleaned)"),
  description_html STRING OPTIONS(description="Full HTML description"),
  visibility STRING OPTIONS(description="Product visibility status"),
  availability STRING OPTIONS(description="Product availability status"),
  category_ids ARRAY<STRING> OPTIONS(description="Array of category IDs"),
  raw_xml STRING OPTIONS(description="Raw XML data for debugging"),
  updated_at TIMESTAMP NOT NULL OPTIONS(description="Last update timestamp")
)
OPTIONS(
  description="Products from Shoptet XML feed"
);

-- ============================================================================
-- 3. Create set_items table
-- ============================================================================
CREATE TABLE IF NOT EXISTS `cm-monitoring.product_sets.set_items` (
  set_code STRING NOT NULL OPTIONS(description="Set code (references products.product_code)"),
  item_code STRING NOT NULL OPTIONS(description="Item code in the set"),
  amount FLOAT64 OPTIONS(description="Quantity of item in the set"),
  updated_at TIMESTAMP NOT NULL OPTIONS(description="Last update timestamp")
)
OPTIONS(
  description="Set composition data from ESO9 XML feed"
);

-- ============================================================================
-- 4. Create product_sets_view
-- ============================================================================
CREATE OR REPLACE VIEW `cm-monitoring.product_sets.product_sets_view` AS
SELECT
  si.item_code AS product_code,
  si.set_code,
  p.name,
  p.url,
  p.img_url,
  p.short_description AS description
FROM
  `cm-monitoring.product_sets.set_items` si
JOIN
  `cm-monitoring.product_sets.products` p
ON
  si.set_code = p.product_code;

-- ============================================================================
-- 5. Indexes and optimizations (optional, for query performance)
-- ============================================================================

-- Note: BigQuery doesn't use traditional indexes like PostgreSQL/MySQL
-- Instead, we can use clustering and partitioning

-- Optional: Add clustering to products table (requires recreating table)
-- This improves query performance when filtering by product_code
/*
CREATE OR REPLACE TABLE `cm-monitoring.product_sets.products`
CLUSTER BY product_code AS
SELECT * FROM `cm-monitoring.product_sets.products`;
*/

-- Optional: Add clustering to set_items table
/*
CREATE OR REPLACE TABLE `cm-monitoring.product_sets.set_items`
CLUSTER BY set_code, item_code AS
SELECT * FROM `cm-monitoring.product_sets.set_items`;
*/

-- ============================================================================
-- 6. Sample queries for testing
-- ============================================================================

-- Get all sets containing a specific product
-- SELECT * FROM `cm-monitoring.product_sets.product_sets_view`
-- WHERE product_code = 'CHM045';

-- Get all products in a specific set
-- SELECT
--   si.item_code,
--   si.amount,
--   p.name,
--   p.url,
--   p.img_url
-- FROM `cm-monitoring.product_sets.set_items` si
-- JOIN `cm-monitoring.product_sets.products` p
-- ON si.item_code = p.product_code
-- WHERE si.set_code = 'BA195';

-- Count products and sets
-- SELECT
--   (SELECT COUNT(*) FROM `cm-monitoring.product_sets.products`) as products_count,
--   (SELECT COUNT(DISTINCT set_code) FROM `cm-monitoring.product_sets.set_items`) as sets_count,
--   (SELECT COUNT(*) FROM `cm-monitoring.product_sets.set_items`) as set_items_count;
