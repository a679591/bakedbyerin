-- One-time setup for the Orders list in the admin (run AFTER adding the "title" and
-- "item_count" fields to Orders under Content types):
--   npx wrangler d1 execute baked-by-erin --remote --file scripts/orders-admin-view.sql
-- * title_field  -> each order is listed by its name ("Order – Jane Doe – Fri, Nov 20")
-- * date_field   -> the list's date is the pickup/delivery date
-- * listColumns  -> extra columns: number of items and the order status
UPDATE _emdash_collections
SET title_field = 'title',
    date_field = 'pickup_date',
    admin_config = '{"listColumns":["item_count","order_status"]}',
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE slug = 'orders';
SELECT slug, title_field, date_field, admin_config FROM _emdash_collections WHERE slug = 'orders';
