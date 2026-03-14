(function () {
  'use strict';

  const DB_STORAGE_KEY = 'badgetwise_db_v1';
  const SQLJS_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.8.0/';
  const SCHEMA_PATH = 'schema.sql';

  const FALLBACK_SCHEMA = `
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

CREATE INDEX IF NOT EXISTS idx_accounts_user_id ON accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_user_date ON transactions(user_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_account_id ON transactions(account_id);
CREATE INDEX IF NOT EXISTS idx_transactions_category_id ON transactions(category_id);
`;

  class BudgetDB {
    constructor(options = {}) {
      this.db = null;
      this.SQL = null;
      this.storageKey = options.storageKey || DB_STORAGE_KEY;
      this.schemaPath = options.schemaPath || SCHEMA_PATH;
      this.sqlJsPath = options.sqlJsPath || SQLJS_CDN;
    }

    async init() {
      const SQL = await initSqlJs({
        locateFile: (file) => `${this.sqlJsPath}${file}`
      });

      this.SQL = SQL;
      this.db = this.loadFromLocalStorage() || new SQL.Database();
      await this.applySchema();
      this.db.run('PRAGMA foreign_keys = ON;');
      this.saveToLocalStorage();
      return this;
    }

    async applySchema() {
      const script = await this.readSchemaScript();
      this.db.exec(script);

      const seeded = this.queryValue('SELECT COUNT(*) AS total FROM categories');
      if (!seeded || Number(seeded.total) === 0) {
        this.db.exec(`
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
        `);
      }
    }

    async readSchemaScript() {
      try {
        const response = await fetch(this.schemaPath, { cache: 'no-store' });
        if (!response.ok) {
          throw new Error(`Failed to load schema file: ${response.status}`);
        }
        return await response.text();
      } catch (error) {
        console.warn('[BudgetDB] Falling back to embedded schema:', error);
        return FALLBACK_SCHEMA;
      }
    }

    saveToLocalStorage() {
      const binary = this.db.export();
      const bytes = Array.from(binary, (b) => String.fromCharCode(b)).join('');
      localStorage.setItem(this.storageKey, btoa(bytes));
    }

    loadFromLocalStorage() {
      const saved = localStorage.getItem(this.storageKey);
      if (!saved) {
        return null;
      }

      try {
        const byteChars = atob(saved);
        const bytes = new Uint8Array(byteChars.length);
        for (let i = 0; i < byteChars.length; i += 1) {
          bytes[i] = byteChars.charCodeAt(i);
        }
        return new this.SQL.Database(bytes);
      } catch (error) {
        console.warn('[BudgetDB] Failed to parse local DB, creating a new one:', error);
        return null;
      }
    }

    resetDatabase() {
      this.db = new this.SQL.Database();
      this.db.exec(FALLBACK_SCHEMA);
      this.saveToLocalStorage();
    }

    exportBase64() {
      const binary = this.db.export();
      const bytes = Array.from(binary, (b) => String.fromCharCode(b)).join('');
      return btoa(bytes);
    }

    importBase64(serializedDb) {
      const byteChars = atob(serializedDb);
      const bytes = new Uint8Array(byteChars.length);
      for (let i = 0; i < byteChars.length; i += 1) {
        bytes[i] = byteChars.charCodeAt(i);
      }
      this.db = new this.SQL.Database(bytes);
      this.db.run('PRAGMA foreign_keys = ON;');
      this.saveToLocalStorage();
    }

    query(sql, params = []) {
      const statement = this.db.prepare(sql);
      statement.bind(params);

      const rows = [];
      while (statement.step()) {
        rows.push(statement.getAsObject());
      }

      statement.free();
      return rows;
    }

    queryValue(sql, params = []) {
      const rows = this.query(sql, params);
      return rows.length > 0 ? rows[0] : null;
    }

    execute(sql, params = []) {
      this.db.run(sql, params);
      this.saveToLocalStorage();
    }

    withTransaction(handler) {
      this.db.run('BEGIN TRANSACTION;');
      try {
        const result = handler();
        this.db.run('COMMIT;');
        this.saveToLocalStorage();
        return result;
      } catch (error) {
        this.db.run('ROLLBACK;');
        throw error;
      }
    }

    createUser({ username, full_name, mobile, email, password_hash, allowance_day = 1 }) {
      this.execute(
        `INSERT INTO users (username, full_name, mobile, email, password_hash, allowance_day)
         VALUES (?, ?, ?, ?, ?, ?);`,
        [username, full_name, mobile || null, email, password_hash, allowance_day]
      );
      return this.queryValue('SELECT * FROM users WHERE id = last_insert_rowid();');
    }

    getUserByIdentity(identity) {
      return this.queryValue(
        `SELECT * FROM users
         WHERE username = ? OR email = ?
         LIMIT 1;`,
        [identity, identity]
      );
    }

    getUserById(id) {
      return this.queryValue('SELECT * FROM users WHERE id = ?;', [id]);
    }

    updateUserAllowanceDay(userId, day) {
      this.execute('UPDATE users SET allowance_day = ? WHERE id = ?;', [day, userId]);
      return this.getUserById(userId);
    }

    listAccounts(userId) {
      return this.query(
        `SELECT *
         FROM accounts
         WHERE user_id = ?
         ORDER BY datetime(created_at) DESC;`,
        [userId]
      );
    }

    createAccount({ user_id, name, type = 'bank', balance = 0 }) {
      this.execute(
        `INSERT INTO accounts (user_id, name, type, balance)
         VALUES (?, ?, ?, ?);`,
        [user_id, name, type, Number(balance) || 0]
      );
      return this.queryValue('SELECT * FROM accounts WHERE id = last_insert_rowid();');
    }

    updateAccount(id, fields) {
      const current = this.queryValue('SELECT * FROM accounts WHERE id = ?;', [id]);
      if (!current) {
        throw new Error('Account not found');
      }

      const name = fields.name ?? current.name;
      const type = fields.type ?? current.type;
      const balance = fields.balance ?? current.balance;

      this.execute(
        `UPDATE accounts
         SET name = ?, type = ?, balance = ?
         WHERE id = ?;`,
        [name, type, Number(balance), id]
      );

      return this.queryValue('SELECT * FROM accounts WHERE id = ?;', [id]);
    }

    deleteAccount(id) {
      this.execute('DELETE FROM accounts WHERE id = ?;', [id]);
    }

    listCategories(type = 'all') {
      if (type === 'all') {
        return this.query('SELECT * FROM categories ORDER BY name ASC;');
      }

      return this.query(
        'SELECT * FROM categories WHERE type = ? ORDER BY name ASC;',
        [type]
      );
    }

    createCategory({ name, type, icon = 'tag', color = '#6B7280' }) {
      this.execute(
        `INSERT INTO categories (name, type, icon, color)
         VALUES (?, ?, ?, ?);`,
        [name, type, icon, color]
      );
      return this.queryValue('SELECT * FROM categories WHERE id = last_insert_rowid();');
    }

    listTransactions(userId, filters = {}) {
      const where = ['t.user_id = ?'];
      const params = [userId];

      if (filters.type && filters.type !== 'all') {
        where.push('t.type = ?');
        params.push(filters.type);
      }

      if (filters.category_id && filters.category_id !== 'all') {
        where.push('t.category_id = ?');
        params.push(Number(filters.category_id));
      }

      if (filters.month) {
        where.push("strftime('%Y-%m', t.date) = ?");
        params.push(filters.month);
      }

      return this.query(
        `SELECT
           t.*,
           a.name AS account_name,
           c.name AS category_name,
           c.icon AS category_icon,
           c.color AS category_color
         FROM transactions t
         INNER JOIN accounts a ON a.id = t.account_id
         LEFT JOIN categories c ON c.id = t.category_id
         WHERE ${where.join(' AND ')}
         ORDER BY date(t.date) DESC, t.id DESC;`,
        params
      );
    }

    createTransaction(payload) {
      return this.withTransaction(() => {
        this.db.run(
          `INSERT INTO transactions
           (user_id, account_id, category_id, title, amount, amount_formula, merchant, type, date)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);`,
          [
            payload.user_id,
            payload.account_id,
            payload.category_id || null,
            payload.title,
            Number(payload.amount),
            payload.amount_formula || null,
            payload.merchant || null,
            payload.type,
            payload.date
          ]
        );

        const transaction = this.queryValue('SELECT * FROM transactions WHERE id = last_insert_rowid();');
        this.applyAccountDelta(transaction.account_id, transaction.amount, transaction.type, 1);
        return transaction;
      });
    }

    updateTransaction(id, payload) {
      return this.withTransaction(() => {
        const existing = this.queryValue('SELECT * FROM transactions WHERE id = ?;', [id]);
        if (!existing) {
          throw new Error('Transaction not found');
        }

        this.applyAccountDelta(existing.account_id, existing.amount, existing.type, -1);

        const merged = {
          ...existing,
          ...payload,
          amount: payload.amount !== undefined ? Number(payload.amount) : Number(existing.amount)
        };

        this.db.run(
          `UPDATE transactions
           SET account_id = ?, category_id = ?, title = ?, amount = ?, amount_formula = ?, merchant = ?, type = ?, date = ?
           WHERE id = ?;`,
          [
            merged.account_id,
            merged.category_id || null,
            merged.title,
            merged.amount,
            merged.amount_formula || null,
            merged.merchant || null,
            merged.type,
            merged.date,
            id
          ]
        );

        this.applyAccountDelta(merged.account_id, merged.amount, merged.type, 1);
        return this.queryValue('SELECT * FROM transactions WHERE id = ?;', [id]);
      });
    }

    deleteTransaction(id) {
      this.withTransaction(() => {
        const existing = this.queryValue('SELECT * FROM transactions WHERE id = ?;', [id]);
        if (!existing) {
          return;
        }

        this.applyAccountDelta(existing.account_id, existing.amount, existing.type, -1);
        this.db.run('DELETE FROM transactions WHERE id = ?;', [id]);
      });
    }

    applyAccountDelta(accountId, amount, type, direction) {
      const normalizedAmount = Number(amount) * Number(direction);
      const signedDelta = type === 'income' ? normalizedAmount : -normalizedAmount;
      this.db.run(
        'UPDATE accounts SET balance = balance + ? WHERE id = ?;',
        [signedDelta, accountId]
      );
    }

    getDashboardTotals(userId, month = null) {
      const targetMonth = month || new Date().toISOString().slice(0, 7);

      const netWorth = this.queryValue(
        'SELECT COALESCE(SUM(balance), 0) AS net_worth FROM accounts WHERE user_id = ?;',
        [userId]
      );

      const monthly = this.queryValue(
        `SELECT
           COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0) AS income,
           COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0) AS expense
         FROM transactions
         WHERE user_id = ? AND strftime('%Y-%m', date) = ?;`,
        [userId, targetMonth]
      );

      return {
        month: targetMonth,
        netWorth: Number(netWorth.net_worth || 0),
        income: Number(monthly.income || 0),
        expense: Number(monthly.expense || 0)
      };
    }
  }

  window.BudgetDB = BudgetDB;
  window.createBudgetDB = async function createBudgetDB(options) {
    const instance = new BudgetDB(options);
    return instance.init();
  };
})();
