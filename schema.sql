PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    full_name TEXT NOT NULL,
    mobile TEXT,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    allowance_day INTEGER NOT NULL DEFAULT 1 CHECK (allowance_day BETWEEN 1 AND 31),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'bank' CHECK (type IN ('bank', 'cash', 'ewallet', 'credit', 'savings', 'other')),
    balance REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('income', 'expense')),
    icon TEXT NOT NULL DEFAULT 'tag',
    color TEXT NOT NULL DEFAULT '#6B7280',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(name, type)
);

CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    account_id INTEGER NOT NULL,
    category_id INTEGER,
    title TEXT NOT NULL,
    amount REAL NOT NULL CHECK (amount >= 0),
    amount_formula TEXT,
    merchant TEXT,
    type TEXT NOT NULL CHECK (type IN ('income', 'expense')),
    date TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
    FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_accounts_user_id
    ON accounts(user_id);

CREATE INDEX IF NOT EXISTS idx_transactions_user_date
    ON transactions(user_id, date DESC);

CREATE INDEX IF NOT EXISTS idx_transactions_account_id
    ON transactions(account_id);

CREATE INDEX IF NOT EXISTS idx_transactions_category_id
    ON transactions(category_id);

INSERT OR IGNORE INTO categories (name, type, icon, color) VALUES
    ('Salary', 'income', 'briefcase', '#10B981'),
    ('Freelance', 'income', 'laptop', '#3B82F6'),
    ('Business', 'income', 'building', '#8B5CF6'),
    ('Investment', 'income', 'chart-line', '#F59E0B'),
    ('Allowance', 'income', 'wallet', '#EC4899'),
    ('Gift', 'income', 'gift', '#14B8A6'),
    ('Other Income', 'income', 'circle-plus', '#6B7280'),
    ('Food and Dining', 'expense', 'utensils', '#EF4444'),
    ('Groceries', 'expense', 'cart-shopping', '#84CC16'),
    ('Transportation', 'expense', 'car', '#F97316'),
    ('Bills and Utilities', 'expense', 'file-invoice-dollar', '#6366F1'),
    ('Rent', 'expense', 'house', '#DC2626'),
    ('Shopping', 'expense', 'bag-shopping', '#A855F7'),
    ('Health and Medical', 'expense', 'heart-pulse', '#06B6D4'),
    ('Entertainment', 'expense', 'film', '#F43F5E'),
    ('Education', 'expense', 'graduation-cap', '#0EA5E9'),
    ('Savings', 'expense', 'piggy-bank', '#16A34A'),
    ('Debt Payment', 'expense', 'credit-card', '#D97706'),
    ('Travel', 'expense', 'plane', '#0284C7'),
    ('Other Expense', 'expense', 'circle-minus', '#6B7280');
