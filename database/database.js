import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(root, 'database');
export const uploadsDir = process.env.DATA_DIR ? path.join(dataDir, 'uploads') : path.join(root, 'public', 'uploads');
fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(uploadsDir, { recursive: true });
export const db = new Database(path.join(dataDir, 'bonitas.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS admins(id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS products(id INTEGER PRIMARY KEY, slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL, category TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', price_cents INTEGER NOT NULL CHECK(price_cents>=0), old_price_cents INTEGER, colors TEXT NOT NULL DEFAULT '[]', featured INTEGER NOT NULL DEFAULT 0, novelty INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1, sold_count INTEGER NOT NULL DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS product_images(id INTEGER PRIMARY KEY, product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE, url TEXT NOT NULL, is_primary INTEGER NOT NULL DEFAULT 0, sort_order INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS product_variants(id INTEGER PRIMARY KEY, product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE, size TEXT NOT NULL, color TEXT NOT NULL, stock INTEGER NOT NULL DEFAULT 0 CHECK(stock>=0), UNIQUE(product_id,size,color));
CREATE TABLE IF NOT EXISTS customers(id INTEGER PRIMARY KEY, name TEXT NOT NULL, phone TEXT NOT NULL, email TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS coupons(id INTEGER PRIMARY KEY, code TEXT NOT NULL UNIQUE, type TEXT NOT NULL CHECK(type IN ('percent','fixed')), value INTEGER NOT NULL CHECK(value>0), expires_at TEXT, max_uses INTEGER, uses INTEGER NOT NULL DEFAULT 0, min_value_cents INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS orders(id INTEGER PRIMARY KEY, order_number TEXT UNIQUE, customer_id INTEGER NOT NULL REFERENCES customers(id), fulfillment TEXT NOT NULL, address_json TEXT, payment_method TEXT NOT NULL, change_for_cents INTEGER, subtotal_cents INTEGER NOT NULL, discount_cents INTEGER NOT NULL DEFAULT 0, delivery_cents INTEGER NOT NULL DEFAULT 0, total_cents INTEGER NOT NULL, coupon_code TEXT, status TEXT NOT NULL DEFAULT 'Novo', notes TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, stock_deducted INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS order_items(id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE, product_id INTEGER NOT NULL, product_name TEXT NOT NULL, size TEXT NOT NULL, color TEXT NOT NULL, quantity INTEGER NOT NULL CHECK(quantity>0), unit_price_cents INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS order_status_history(id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE, status TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_products_active_category ON products(active,category);
CREATE INDEX IF NOT EXISTS idx_variants_product ON product_variants(product_id);
CREATE INDEX IF NOT EXISTS idx_orders_status_created ON orders(status,created_at);
CREATE INDEX IF NOT EXISTS idx_order_history_order ON order_status_history(order_id,created_at);
`);

const setting = db.prepare('INSERT OR IGNORE INTO settings(key,value) VALUES(?,?)');
[['store_name','BONITAS'],['whatsapp','558399923260'],['instagram','@bonitas_storemodafeminina'],['address','João Pessoa - PB'],['delivery_fee_cents','1000'],['low_stock_limit','3'],['opening_hours','Segunda a sábado, 9h às 18h'],['minimum_order_cents','0']].forEach(x=>setting.run(...x));
db.prepare("UPDATE settings SET value='558399923260' WHERE key='whatsapp' AND value='5583999999999'").run();
db.prepare("UPDATE settings SET value='@bonitas_storemodafeminina' WHERE key='instagram' AND value='@usebonitas'").run();

export function settings(){ return Object.fromEntries(db.prepare('SELECT key,value FROM settings').all().map(x=>[x.key,x.value])); }
